/**
 * Simulation host: owns the Simulator, checkpoints and the parameter timeline.
 * Runs inside a Web Worker (simWorker.ts) or, as a fallback, on the main thread.
 * Simulation time is decoupled from display time: the host simulates ahead of the
 * display clock in chunks; parameter changes are applied at an exact simulation time by
 * restoring the last checkpoint, deterministically replaying to that time, then switching.
 */
import { buildCardiacModel } from "../tissue/buildModel";
import { Simulator, type SimSnapshot } from "../core/engine";
import { computeLeadField } from "../ecg-forward/leadField";
import { measureBeats } from "../ecg-forward/measurements";
import { buildSurfaces } from "../tissue/surfaces";
import type { SimParams } from "../core/params";
import type { FromWorker, ModelMeta, ToWorker } from "./protocol";

const CHUNK_MS = 500;
const CHECKPOINT_EVERY_MS = 1000;
const MAX_CHECKPOINTS = 200;

export class SimHost {
  private sim: Simulator | null = null;
  private W: Float32Array | null = null;
  private checkpoints: SimSnapshot[] = [];
  private epoch = 0;
  private target = 0;
  private busy = false;
  private loopToken = 0;
  constructor(private post: (m: FromWorker, transfer?: Transferable[]) => void) {}

  handle(msg: ToWorker): void {
    try {
      switch (msg.type) {
        case "init":
          this.init(msg.params, msg.dt);
          break;
        case "restart":
          this.epoch = msg.epoch;
          this.start(msg.params, msg.dt);
          break;
        case "extend":
          if (msg.epoch !== this.epoch) return;
          this.target = Math.max(this.target, msg.until);
          this.pump();
          break;
        case "setParams":
          this.epoch = msg.epoch;
          this.applyAt(msg.params, msg.at);
          break;
        case "compare":
          this.compare(msg.a, msg.b, msg.duration, msg.requestId);
          break;
      }
    } catch (e) {
      this.post({ type: "error", message: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) });
    }
  }

  private init(params: SimParams, dt: number): void {
    const t0 = performance.now();
    const model = buildCardiacModel();
    this.W = computeLeadField(model);
    const buildMs = performance.now() - t0;
    const meta: ModelMeta = {
      n: model.n,
      pos: model.pos,
      cellType: model.cellType,
      region: model.region,
      transmural: model.transmural,
      apicobasal: model.apicobasal,
      conductionPaths: model.conductionPaths,
      probes: model.probes,
      counts: model.counts,
      san: model.san,
      avn: model.avn,
      hisProximal: model.hisProximal,
      hisDistal: model.hisDistal,
      ventEscape: model.ventEscape,
      dt,
      frame: { baseCenter: model.frame.baseCenter, axis: model.frame.axis, septalDir: model.frame.septalDir, anteriorDir: model.frame.anteriorDir },
      ectopicSites: model.ectopicSites,
      substrates: model.substrates,
    };
    this.post({ type: "ready", meta, buildMs });
    this.start(params, dt);
    // anatomical surfaces for the 3-D view (visual only) — sent after the simulation has started
    setTimeout(() => {
      const t1 = performance.now();
      const surfaces = buildSurfaces(model);
      this.post(
        { type: "surfaces", surfaces, ms: performance.now() - t1 },
        surfaces.flatMap((s) => [s.positions.buffer, s.indices.buffer, s.vNodes.buffer, s.vWeights.buffer, s.vRegion.buffer]),
      );
    }, 50);
  }

  private start(params: SimParams, dt: number): void {
    this.loopToken++;
    this.busy = false;
    const model = buildCardiacModel();
    this.sim = new Simulator(model, params, this.W ?? undefined, dt);
    this.checkpoints = [this.sim.snapshot()];
    this.target = 0;
  }

  /** Simulate in chunks until the target time; yields between chunks so new messages are seen. */
  private pump(): void {
    if (this.busy || !this.sim) return;
    this.busy = true;
    const token = ++this.loopToken;
    const step = () => {
      if (token !== this.loopToken) return; // superseded by a newer loop
      const sim = this.sim!;
      if (sim.time > this.target) {
        this.busy = false;
        return;
      }
      const epoch = this.epoch;
      const t0 = performance.now();
      const until = sim.time + CHUNK_MS - sim.dt;
      sim.run(until);
      const out = sim.drain();
      if (Math.floor(sim.time / CHECKPOINT_EVERY_MS) > Math.floor((sim.time - CHUNK_MS) / CHECKPOINT_EVERY_MS)) {
        this.checkpoints.push(sim.snapshot());
        if (this.checkpoints.length > MAX_CHECKPOINTS) this.checkpoints.splice(1, 1);
      }
      this.post({ type: "chunk", epoch, out, simTime: sim.time, computeMs: performance.now() - t0 }, [
        out.recT.buffer,
        out.recNode.buffer,
        out.recApd.buffer,
        out.recWave.buffer,
        out.ecg.buffer,
      ]);
      setTimeout(step, 0);
    };
    step();
  }

  private applyAt(params: SimParams, at: number): void {
    const sim = this.sim;
    if (!sim) return;
    const dt = sim.dt;
    const cutIdx = Math.max(1, Math.ceil(at / dt));
    const runUntil = (cutIdx - 1) * dt;
    // latest checkpoint at or before the cut
    let cp = this.checkpoints[0];
    for (const c of this.checkpoints) if (c.time <= cutIdx * dt) cp = c;
    this.checkpoints = this.checkpoints.filter((c) => c.time <= cp.time);
    sim.restore(cp);
    sim.run(runUntil);
    sim.drain(); // replay is identical to data the UI already has
    sim.setParams(params);
    this.post({
      type: "truncate",
      epoch: this.epoch,
      keepRecordsUntil: runUntil,
      keepSamplesBelow: cutIdx,
      waves: [...sim.waves.values()].map((w) => ({ ...w })),
    });
    this.target = Math.max(this.target, at + 4000);
    this.loopToken++;
    this.busy = false;
    this.pump();
  }

  private compare(a: SimParams, b: SimParams, duration: number, requestId: number): void {
    const model = buildCardiacModel();
    const dt = this.sim?.dt ?? 2;
    const runOne = (p: SimParams) => {
      const s = new Simulator(model, p, this.W ?? undefined, dt);
      s.run(duration);
      const o = s.drain();
      return { ecg: o.ecg, beats: measureBeats(o.ecg, dt, 0, o.waves), recT: o.recT, recNode: o.recNode, recApd: o.recApd, recWave: o.recWave, waves: o.waves };
    };
    const ra = runOne(a);
    const rb = runOne(b);
    this.post({ type: "compareResult", requestId, dt, a: ra, b: rb }, [ra.ecg.buffer, rb.ecg.buffer]);
  }
}
