/**
 * Event-driven cardiac activation engine with an on-line ECG forward model.
 *
 * Fidelity: Level 1 (conduction network: SA node, AV node, His–Purkinje) coupled to a
 * Level 2 spatial tissue graph (voxelised atria and ventricles, anisotropic delays,
 * refractoriness, CV/APD restitution). Activation spreads as a discrete event
 * cellular automaton (graph eikonal with refractoriness); each activation fixes the
 * node's APD from its diastolic interval; Vm(t) follows the reduced-order waveform;
 * the ECG is the lead-field sum over Vm. One simulation clock drives everything.
 *
 * What it can represent: activation sequence, conduction delay/block, refractoriness,
 * wavefront collision, overdrive reset of latent pacemakers, rate-dependent AV nodal
 * conduction, rate-dependent APD.  What it cannot: source–sink effects, wavefront
 * curvature, electrotonic modulation of APD (only a smoothing proxy), ionic currents,
 * EADs/DADs (Phase 4), mechanical/volume-conductor dynamics.
 */
import { CT, EK, type CardiacModel } from "./model";
import { cloneParams, isAtrialSite, type SimParams } from "./params";
import { derive, type Derived } from "./derive";
import { EV_AUTO, EV_EXCITE, EventQueue, type QueueSnapshot } from "./eventQueue";
import { Rng } from "./rng";
import { DYNAMIC_RESTITUTION, SHAPES, apdDynamic, repolMidpoint, steadyStateScale, ventricularNotchScale, workingA } from "../cellular/actionPotential";
import { N_CHANNELS, N_COLS, columnsToChannels, computeLeadField } from "../ecg-forward/leadField";

export type WaveOrigin = "sinus" | "junctional" | "ventricular-escape" | "ectopic" | "retrograde" | "reentry";

export interface WaveInfo {
  id: number;
  origin: WaveOrigin;
  originNode: number;
  t0: number;
  tFirstAtrial: number;
  tLastAtrial: number;
  atrialCount: number;
  tAvnIn: number;
  tAvnOut: number;
  avnBlocked: boolean;
  avnRecovery: number; // H-to-A recovery time used by the AV node model (ms)
  tHisProximal: number;
  tHisDistal: number;
  tFirstLBB: number;
  tFirstRBB: number;
  tFirstPurkinjeLV: number;
  tFirstPurkinjeRV: number;
  tFirstVent: number;
  tLastVent: number;
  ventCount: number;
  firstVentNode: number;
  lastVentNode: number;
  tVentRepolEnd: number;
  tAtrialRepolEnd: number;
  tSanActivation: number;
  /** Named ectopic site (ectopic waves) or link id (retrograde waves). */
  site: string;
  /** Wave from which a retrograde / re-entrant wave arose (−1 if none). */
  parent: number;
  /** AV pathway that delivered the earliest antegrade exit (avn-fast / avn-slow), if any. */
  avnPath: string;
  /** Accessory-pathway antegrade exit time (pre-excitation), NaN if none. */
  tApOut: number;
  /** True when the impulse was blocked below the His bundle. */
  infraHisBlocked: boolean;
  /** True if the SA discharge failed to exit (SA exit block). */
  saExitBlocked: boolean;
}

const newWave = (id: number, origin: WaveOrigin, node: number, t0: number): WaveInfo => ({
  id,
  origin,
  originNode: node,
  t0,
  tFirstAtrial: NaN,
  tLastAtrial: NaN,
  atrialCount: 0,
  tAvnIn: NaN,
  tAvnOut: NaN,
  avnBlocked: false,
  avnRecovery: NaN,
  tHisProximal: NaN,
  tHisDistal: NaN,
  tFirstLBB: NaN,
  tFirstRBB: NaN,
  tFirstPurkinjeLV: NaN,
  tFirstPurkinjeRV: NaN,
  tFirstVent: NaN,
  tLastVent: NaN,
  ventCount: 0,
  firstVentNode: -1,
  lastVentNode: -1,
  tVentRepolEnd: NaN,
  tAtrialRepolEnd: NaN,
  tSanActivation: NaN,
  site: "",
  parent: -1,
  avnPath: "",
  tApOut: NaN,
  infraHisBlocked: false,
  saExitBlocked: false,
});

export interface SimSnapshot {
  time: number;
  queue: QueueSnapshot;
  lastAct: Float64Array;
  prevAct: Float64Array;
  apd: Float32Array;
  erp: Float32Array;
  lastWave: Int32Array;
  t50: Float32Array;
  clMem: Float32Array;
  linkLastExit: Float64Array;
  linkLastEntry: Float64Array;
  linkDir: Int8Array;
  linkTransit: Int32Array;
  counters: { ectopy: number; san: number; his: number; focusEpoch: number };
  childOf: [number, number][];
  waveCounter: number;
  active: Int32Array;
  rng: number;
  params: SimParams;
  waves: [number, WaveInfo][];
  recCount: number;
  sampleCount: number;
}

export interface SimOutput {
  /** Activation records produced since the previous drain. */
  recT: Float64Array;
  recNode: Int32Array;
  recApd: Float32Array;
  recWave: Int32Array;
  /** ECG samples produced since the previous drain: [sample][15 channels] (12 leads + heart vector). */
  ecg: Float32Array;
  ecgStartIndex: number;
  sampleCount: number;
  /** Wave summaries touched since the previous drain. */
  waves: WaveInfo[];
}


export class Simulator {
  readonly model: CardiacModel;
  readonly dt: number;
  params: SimParams;
  d: Derived;
  readonly W: Float32Array;

  // state
  lastAct: Float64Array;
  prevAct: Float64Array;
  apd: Float32Array;
  erp: Float32Array;
  t50: Float32Array;
  lastWave: Int32Array;
  /** Per-cell cycle-length memory (ms) for APD adaptation. */
  clMem: Float32Array;
  /** Lumped-link state (model.links order). */
  linkLastExit: Float64Array;
  linkLastEntry: Float64Array;
  linkDir: Int8Array;
  linkTransit: Int32Array;
  readonly linkOf: Int16Array;
  readonly upperMask: Uint8Array;
  counters = { ectopy: 0, san: 0, his: 0, focusEpoch: 0 };
  /** Re-entry bookkeeping: wave → wave id used for its re-excitations. */
  childOf = new Map<number, number>();
  waveCounter = 0;
  queue = new EventQueue();
  rng: Rng;
  /** Time of the next ECG sample to compute. */
  time = 0;
  sampleCount = 0;
  private active: Int32Array;
  private activeLen = 0;
  private inActive: Uint8Array;
  waves = new Map<number, WaveInfo>();
  private touched = new Set<number>();

  // output buffers (drained by the caller)
  private recT: number[] = [];
  private recNode: number[] = [];
  private recApd: number[] = [];
  private recWave: number[] = [];
  private ecgBuf: number[] = [];
  private ecgStart = 0;
  recCount = 0;

  private el = new Float64Array(N_COLS);
  private leadTmp = new Float32Array(N_CHANNELS);
  private notchScale: Float32Array;
  private ev = { time: 0, node: 0, src: 0, wave: 0, kind: 0, stamp: 0 };

  constructor(model: CardiacModel, params: SimParams, W?: Float32Array, dt = 2) {
    this.model = model;
    this.dt = dt;
    this.params = cloneParams(params);
    this.d = derive(model, this.params);
    this.W = W ?? computeLeadField(model);
    const n = model.n;
    this.lastAct = new Float64Array(n);
    this.prevAct = new Float64Array(n);
    this.apd = new Float32Array(n);
    this.erp = new Float32Array(n);
    this.t50 = new Float32Array(n);
    this.lastWave = new Int32Array(n);
    this.clMem = new Float32Array(n).fill(1000);
    this.active = new Int32Array(n);
    this.inActive = new Uint8Array(n);
    this.notchScale = new Float32Array(n);
    for (let i = 0; i < n; i++) this.notchScale[i] = model.cellType[i] === CT.VENTRICULAR ? ventricularNotchScale(model.transmural[i]) : 1;
    const L = model.links.length;
    this.linkLastExit = new Float64Array(L);
    this.linkLastEntry = new Float64Array(L);
    this.linkDir = new Int8Array(L);
    this.linkTransit = new Int32Array(L);
    this.linkOf = new Int16Array(n).fill(-1);
    this.upperMask = new Uint8Array(n);
    model.links.forEach((l, li) => {
      this.linkOf[l.node] = li;
      for (const u of l.upper) this.upperMask[u] |= 1 << li;
    });
    this.rng = new Rng(params.seed);
    this.reset();
  }

  /** The AV-nodal fast pathway is link 0 (kept for API compatibility). */
  get avnLastExit(): number {
    return this.linkLastExit[0];
  }

  /** Initial state approximates steady state at the sinus cycle length. */
  reset(): void {
    const n = this.model.n;
    const cl = this.d.sinusCycle;
    for (let i = 0; i < n; i++) {
      const ss = this.d.apdRef[i] * steadyStateScale(cl);
      this.clMem[i] = cl;
      this.apd[i] = ss;
      this.erp[i] = ss * this.d.erpRatio[i];
      // as if activated one cycle before t = 0, at a typical sinus-beat activation time for the cell type
      const ct = this.model.cellType[i];
      const typicalAT = ct === CT.VENTRICULAR ? 200 : ct === CT.ATRIAL ? 80 : ct === CT.SAN ? 40 : 150;
      this.lastAct[i] = -cl + typicalAT;
      this.prevAct[i] = this.lastAct[i] - cl;
      this.lastWave[i] = -1;
      this.inActive[i] = 0;
    }
    this.activeLen = 0;
    this.linkLastExit.fill(-cl + 100);
    this.linkLastEntry.fill(-cl + 40);
    this.linkDir.fill(0);
    this.linkTransit.fill(0);
    this.counters = { ectopy: 0, san: 0, his: 0, focusEpoch: 0 };
    this.childOf.clear();
    this.waveCounter = 0;
    this.queue.clear();
    this.waves.clear();
    this.touched.clear();
    this.rng = new Rng(this.params.seed);
    this.time = 0;
    this.sampleCount = 0;
    this.recT = [];
    this.recNode = [];
    this.recApd = [];
    this.recWave = [];
    this.ecgBuf = [];
    this.ecgStart = 0;
    this.recCount = 0;
    const m = this.model;
    // Pacemakers: SA node fires first at 40 ms; latent pacemakers are armed.
    this.lastAct[m.san] = 40 - cl;
    this.queue.push(40, m.san, -1, -1, EV_AUTO, this.lastAct[m.san]);
    this.queue.push(this.lastAct[m.hisProximal] + this.d.junctionalCycle, m.hisProximal, -1, -1, EV_AUTO, this.lastAct[m.hisProximal]);
    this.queue.push(this.lastAct[m.ventEscape] + this.d.ventricularEscapeCycle, m.ventEscape, -1, -1, EV_AUTO, this.lastAct[m.ventEscape]);
    this.armFocus(Math.max(100, this.params.ectopy.coupling));
  }

  /** Schedule the next tick of a protected automatic focus ("focus" ectopy pattern). */
  private armFocus(at: number): void {
    const e = this.params.ectopy;
    if (e.site === "none" || e.pattern !== "focus") return;
    const node = this.model.ectopicSites[e.site];
    if (node === undefined) return;
    this.queue.push(at, node, -5, -1, EV_EXCITE, this.counters.focusEpoch);
  }

  /** Apply new parameters from the current simulation time onward. */
  setParams(p: SimParams): void {
    const old = this.d;
    const oldParams = this.params;
    this.params = cloneParams(p);
    this.d = derive(this.model, this.params);
    const m = this.model;
    // Re-arm pacemakers whose cycle length changed (pending automaticity events become stale).
    const rearm = (node: number, oldCl: number, newCl: number) => {
      if (Math.abs(oldCl - newCl) < 1e-9) return;
      const due = Math.max(this.time, this.lastAct[node] + newCl);
      this.lastAct[node] += 0; // keep timestamp; schedule fresh check with a unique stamp
      this.queue.push(due, node, -2, -1, EV_AUTO, this.lastAct[node]);
    };
    rearm(m.san, old.sinusCycle, this.d.sinusCycle);
    rearm(m.hisProximal, old.junctionalCycle, this.d.junctionalCycle);
    rearm(m.ventEscape, old.ventricularEscapeCycle, this.d.ventricularEscapeCycle);
    const eo = JSON.stringify(oldParams.ectopy);
    if (eo !== JSON.stringify(this.params.ectopy)) {
      this.counters.focusEpoch++;
      this.counters.ectopy = 0;
      this.armFocus(this.time + Math.max(100, this.params.ectopy.coupling));
    }
  }

  /** Inject an excitation (e.g. programmed stimulus) at `node` and time `t` (Phase 2 hook). */
  stimulate(node: number, t: number): void {
    this.queue.push(t, node, -3, -1, EV_EXCITE, 0);
  }

  run(until: number): void {
    while (this.time <= until) {
      this.processEvents(this.time);
      this.sample(this.time);
      this.time += this.dt;
    }
  }

  private processEvents(T: number): void {
    const q = this.queue;
    const ev = this.ev;
    while (q.peekTime() <= T) {
      q.pop(ev);
      if (ev.kind === EV_AUTO) this.onAutomaticity(ev.time, ev.node, ev.stamp, ev.src);
      else this.onExcite(ev.time, ev.node, ev.src, ev.wave, ev.stamp);
    }
  }

  private cycleOf(node: number): number {
    const m = this.model;
    if (node === m.san) return this.d.sinusCycle;
    if (node === m.hisProximal) return this.d.junctionalCycle;
    return this.d.ventricularEscapeCycle;
  }

  private onAutomaticity(t: number, node: number, stamp: number, src: number): void {
    if (this.lastAct[node] !== stamp) return; // reset by an earlier activation → stale
    if (node === this.model.san && this.params.rhythm.sinusArrest) {
      // automaticity suppressed: keep a dormant check so that releasing the arrest resumes firing
      this.queue.push(t + this.cycleOf(node), node, -1, -1, EV_AUTO, stamp);
      return;
    }
    const due = this.lastAct[node] + this.cycleOf(node);
    if (src === -2 && t < due - 1e-9) {
      // re-armed after a parameter change but not yet due
      this.queue.push(due, node, -2, -1, EV_AUTO, stamp);
      return;
    }
    if (t < due - 1e-9) return;
    const m = this.model;
    const origin: WaveOrigin = node === m.san ? "sinus" : node === m.hisProximal ? "junctional" : "ventricular-escape";
    const id = ++this.waveCounter;
    const w = newWave(id, origin, node, t);
    this.waves.set(id, w);
    this.activate(node, t, id, true);
  }

  private onExcite(t: number, node: number, src: number, wave: number, stamp = 0): void {
    const li = this.linkOf[node];
    if (li >= 0) {
      this.onLink(t, li, src, wave);
      return;
    }
    // exits of a link that has since been extinguished by collision are void
    if (src >= 0 && this.linkOf[src] >= 0 && stamp !== this.linkTransit[this.linkOf[src]]) return;
    if (src === -5) {
      // protected automatic focus: next tick is independent of capture (no overdrive reset)
      if (stamp !== this.counters.focusEpoch) return;
      this.armFocus(t + 60000 / Math.max(1, this.params.ectopy.rate));
    }
    if (t - this.lastAct[node] < this.erp[node]) return; // refractory → conduction block here
    if (wave < 0) {
      // externally injected stimulus or ectopic focus
      wave = ++this.waveCounter;
      const w = newWave(wave, "ectopic", node, t);
      w.site = src === -4 || src === -5 ? this.params.ectopy.site : "stimulus";
      this.waves.set(wave, w);
    } else if (this.lastWave[node] === wave && src >= 0) {
      // the same wave re-excites tissue it already activated → a re-entrant cycle has completed
      wave = this.childWave(wave, node, t, "reentry");
    }
    this.activate(node, t, wave, false);
  }

  private childWave(parent: number, node: number, t: number, origin: WaveOrigin, site = ""): number {
    const c = this.childOf.get(parent);
    if (c !== undefined) return c;
    const id = ++this.waveCounter;
    const w = newWave(id, origin, node, t);
    w.parent = parent;
    w.site = site;
    this.waves.set(id, w);
    this.childOf.set(parent, id);
    return id;
  }

  /**
   * Lumped directional link (AV-nodal fast or slow pathway, accessory pathway).
   * Delay = base + amplitude·exp(−(R − ERP)/τ) (Sun et al. 1995 recovery term for nodal tissue;
   * amplitude 0 = non-decremental). R is measured from the previous exit (fast pathway, as in
   * Phase 1) or from the previous invasion (slow and accessory pathways). An impulse arriving
   * from the opposite end while one is in transit collides and both are extinguished.
   */
  private onLink(t: number, li: number, src: number, wave: number): void {
    const m = this.model;
    const L = this.d.links[li];
    if (!L.enabled) return;
    const link = m.links[li];
    const ante = src >= 0 && ((this.upperMask[src] >> li) & 1) === 1;
    if (ante ? !L.ante : L.retro === "blocked") return;
    const dir = ante ? 1 : -1;
    if (this.linkLastExit[li] > t && this.linkDir[li] !== dir) {
      // collision inside the pathway
      this.linkTransit[li]++;
      this.linkLastExit[li] = t;
      return;
    }
    const R = L.recoveryFrom === "exit" ? t - this.linkLastExit[li] : t - this.linkLastEntry[li];
    const erp = ante ? L.anteErp : L.retroErp;
    const w = this.waves.get(wave);
    const isAvn = link.id === "avn-fast" || link.id === "avn-slow";
    if (R < erp) {
      if (ante && L.concealment > 0 && R >= 0.6 * erp && this.linkLastExit[li] <= t) {
        // concealed conduction: partial penetration pushes the recovery reference forward
        const phi = (R - 0.6 * erp) / (0.4 * erp);
        if (L.recoveryFrom === "exit") this.linkLastExit[li] += L.concealment * phi * (t - this.linkLastExit[li]);
        else this.linkLastEntry[li] += L.concealment * phi * (t - this.linkLastEntry[li]);
      }
      if (w && ante && isAvn && !w.avnBlocked && Number.isNaN(w.tAvnOut)) {
        w.avnBlocked = true;
        w.tAvnIn = t;
        w.avnRecovery = R;
        this.touched.add(wave);
      }
      return;
    }
    const delay = (ante ? L.anteBase : L.retroBase) + L.amplitude * Math.exp(-(R - erp) / L.tau);
    this.linkLastEntry[li] = t;
    this.linkDir[li] = dir;
    const transit = ++this.linkTransit[li];
    if (!ante && L.retro === "concealed") {
      // concealed conduction: penetrates (and leaves the node refractory) without reaching the atria
      this.linkLastExit[li] = t + 0.5 * delay;
      return;
    }
    const exit = t + delay;
    this.linkLastExit[li] = exit;
    this.activateRecordOnly(link.node, t, wave);
    let outWave = wave;
    if (w && ante && isAvn && (Number.isNaN(w.tAvnOut) || exit < w.tAvnOut)) {
      w.tAvnIn = t;
      w.tAvnOut = exit;
      w.avnRecovery = R;
      w.avnBlocked = false;
      w.avnPath = link.id;
      this.touched.add(wave);
    } else if (w && ante && !isAvn) {
      w.tApOut = Number.isNaN(w.tApOut) ? exit : Math.min(w.tApOut, exit);
      this.touched.add(wave);
    }
    if (!ante && wave >= 0) {
      outWave = this.childWave(wave, link.node, exit, "retrograde", link.id);
    }
    for (const i of ante ? link.lower : link.upper) this.queue.push(exit, i, link.node, outWave, EV_EXCITE, transit);
  }

  /** Per-cell cycle-length memory for APD adaptation (call after prevAct has been set). */
  private updateMemory(node: number, t: number): void {
    const c = t - this.prevAct[node];
    if (c > 0) this.clMem[node] += DYNAMIC_RESTITUTION.memoryWeight * (Math.min(3000, Math.max(150, c)) - this.clMem[node]);
  }

  private activateRecordOnly(node: number, t: number, wave: number): void {
    const di = t - (this.lastAct[node] + this.apd[node]);
    this.prevAct[node] = this.lastAct[node];
    this.lastAct[node] = t;
    this.updateMemory(node, t);
    this.apd[node] = apdDynamic(this.d.apdRef[node], this.clMem[node], di);
    this.erp[node] = this.apd[node] * this.d.erpRatio[node];
    this.lastWave[node] = wave;
    this.record(node, t, wave);
  }

  private record(node: number, t: number, wave: number): void {
    this.recT.push(t);
    this.recNode.push(node);
    this.recApd.push(this.apd[node]);
    this.recWave.push(wave);
    this.recCount++;
  }

  private activate(node: number, t: number, wave: number, spontaneous: boolean): void {
    const m = this.model;
    const d = this.d;
    const ct = m.cellType[node];
    const di = t - (this.lastAct[node] + this.apd[node]);
    this.prevAct[node] = this.lastAct[node];
    this.lastAct[node] = t;
    this.updateMemory(node, t);
    const apd = apdDynamic(d.apdRef[node], this.clMem[node], di);
    this.apd[node] = apd;
    this.erp[node] = apd * d.erpRatio[node];
    this.lastWave[node] = wave;
    const s = SHAPES[ct];
    if (s) this.t50[node] = repolMidpoint(s, apd);
    if (!this.inActive[node] && (ct === CT.VENTRICULAR || ct === CT.ATRIAL)) {
      this.inActive[node] = 1;
      this.active[this.activeLen++] = node;
    }
    this.record(node, t, wave);
    this.updateWave(node, t, wave, apd);

    // Latent / dominant pacemakers: arm next automaticity check (overdrive reset)
    if (node === m.san || node === m.hisProximal || node === m.ventEscape) {
      this.queue.push(t + this.cycleOf(node), node, -1, -1, EV_AUTO, t);
    }
    const w = this.waves.get(wave);
    if (node === m.san && spontaneous) {
      const k = this.params.rhythm.saExitBlockEvery;
      if (k >= 2 && ++this.counters.san % k === 0) {
        if (w) w.saExitBlocked = true;
        return; // the node fires but the impulse does not exit
      }
    }
    let infraBlock = false;
    if (node === m.hisDistal) {
      const hp = this.params.hisPurkinje;
      const antegrade = !w || Number.isNaN(w.tFirstVent);
      if (hp.infraHisComplete) infraBlock = true;
      else if (antegrade && hp.infraHisBlockEvery >= 2 && ++this.counters.his % hp.infraHisBlockEvery === 0) infraBlock = true;
      if (infraBlock && w && antegrade) {
        w.infraHisBlocked = true;
        this.touched.add(wave);
      }
    }
    const infraComplete = this.params.hisPurkinje.infraHisComplete;

    // Propagate to neighbours
    const ra = this.params.restitution.cvAmplitude;
    const rt = this.params.restitution.cvTau;
    for (let q = m.adjStart[node]; q < m.adjStart[node + 1]; q++) {
      const j = m.adjNode[q];
      let delay = d.edgeDelay[q];
      if (delay === Infinity) continue; // blocked conduction-system segment
      if (node === m.hisDistal && infraBlock && m.adjKind[q] !== EK.HIS) continue;
      if (j === m.hisDistal && infraComplete && m.adjKind[q] !== EK.HIS) continue;
      if (this.linkOf[j] >= 0) {
        this.queue.push(t, j, node, wave, EV_EXCITE);
        continue;
      }
      const arrival0 = t + delay;
      {
        // skip neighbours that will certainly still be refractory on arrival
        if (arrival0 - this.lastAct[j] < this.erp[j]) continue;
        if (d.edgeRestitutes[q] && ra > 0) {
          const dij = arrival0 - (this.lastAct[j] + this.apd[j]);
          const f = 1 - ra * Math.exp(-Math.max(0, dij) / rt);
          delay /= Math.max(0.05, f);
        }
      }
      this.queue.push(t + delay, j, node, wave, EV_EXCITE);
    }
  }

  private updateWave(node: number, t: number, wave: number, apd: number): void {
    const w = this.waves.get(wave);
    if (!w) return;
    const m = this.model;
    const ct = m.cellType[node];
    const reg = m.region[node];
    this.touched.add(wave);
    const first = (v: number) => (Number.isNaN(v) ? t : Math.min(v, t));
    switch (ct) {
      case CT.SAN:
        w.tSanActivation = first(w.tSanActivation);
        break;
      case CT.ATRIAL:
        if (Number.isNaN(w.tFirstAtrial)) this.onReferenceBeat(w, t, true);
        w.tFirstAtrial = first(w.tFirstAtrial);
        w.tLastAtrial = Number.isNaN(w.tLastAtrial) ? t : Math.max(w.tLastAtrial, t);
        w.atrialCount++;
        w.tAtrialRepolEnd = Number.isNaN(w.tAtrialRepolEnd) ? t + apd : Math.max(w.tAtrialRepolEnd, t + apd);
        break;
      case CT.HIS:
        if (node === m.hisProximal) w.tHisProximal = first(w.tHisProximal);
        if (node === m.hisDistal) w.tHisDistal = first(w.tHisDistal);
        break;
      case CT.PURKINJE:
        if (reg === 7 /*LBB*/) w.tFirstLBB = first(w.tFirstLBB);
        else if (reg === 8 /*RBB*/) w.tFirstRBB = first(w.tFirstRBB);
        else if (reg === 12) w.tFirstPurkinjeLV = first(w.tFirstPurkinjeLV);
        else if (reg === 13) w.tFirstPurkinjeRV = first(w.tFirstPurkinjeRV);
        break;
      case CT.VENTRICULAR:
        if (Number.isNaN(w.tFirstVent)) this.onReferenceBeat(w, t, false);
        if (Number.isNaN(w.tFirstVent) || t < w.tFirstVent) {
          w.tFirstVent = t;
          w.firstVentNode = node;
        }
        if (Number.isNaN(w.tLastVent) || t >= w.tLastVent) {
          w.tLastVent = t;
          w.lastVentNode = node;
        }
        w.ventCount++;
        w.tVentRepolEnd = Number.isNaN(w.tVentRepolEnd) ? t + apd : Math.max(w.tVentRepolEnd, t + apd);
        break;
    }
  }

  /**
   * Coupled ectopy: after a non-ectopic beat reaches the focus' chamber, schedule ectopic
   * stimuli at the coupling interval according to the selected pattern (deterministic).
   */
  private onReferenceBeat(w: WaveInfo, t: number, atrial: boolean): void {
    const e = this.params.ectopy;
    if (e.site === "none" || e.pattern === "focus") return;
    if (w.origin !== "sinus" && w.origin !== "junctional" && w.origin !== "ventricular-escape") return;
    if (isAtrialSite(e.site) !== atrial) return;
    const node = this.model.ectopicSites[e.site];
    if (node === undefined) return;
    const c = ++this.counters.ectopy;
    let n = 0;
    switch (e.pattern) {
      case "bigeminy":
        n = 1;
        break;
      case "trigeminy":
        n = c % 2 === 0 ? 1 : 0;
        break;
      case "single":
        n = c % Math.max(1, e.every) === 0 ? 1 : 0;
        break;
      case "once":
        n = c === Math.max(1, e.every) ? 1 : 0;
        break;
      case "couplet":
        n = c % Math.max(1, e.every) === 0 ? 2 : 0;
        break;
      case "run":
        n = c % Math.max(1, e.every) === 0 ? e.runLength : 0;
        break;
    }
    for (let k = 1; k <= n; k++) this.queue.push(t + k * e.coupling, node, -4, -1, EV_EXCITE, 0);
  }

  /** Compute one ECG sample at time T from the current membrane-potential field. */
  private sample(T: number): void {
    const el = this.el;
    el.fill(0);
    const W = this.W;
    const m = this.model;
    let k = 0;
    for (let a = 0; a < this.activeLen; a++) {
      const i = this.active[a];
      const tau = T - this.lastAct[i];
      const apd = this.apd[i];
      const s = SHAPES[m.cellType[i]];
      if (tau > apd + 6 * s.repolWidth * apd) {
        this.inActive[i] = 0; // returned to rest: drop from the active set
        continue;
      }
      this.active[k++] = i;
      if (tau < 0) continue;
      const x = workingA(s, tau, apd, this.t50[i], this.notchScale[i]) * (s.vPeak - s.vRest);
      if (x === 0) continue;
      const o = i * N_COLS;
      for (let e = 0; e < N_COLS; e++) el[e] += W[o + e] * x;
    }
    this.activeLen = k;
    columnsToChannels(el, this.params.forward.limbGain, this.params.forward.precordialGain, this.leadTmp);
    if (this.ecgBuf.length === 0) this.ecgStart = this.sampleCount;
    for (let l = 0; l < N_CHANNELS; l++) this.ecgBuf.push(this.leadTmp[l]);
    this.sampleCount++;
  }

  drain(): SimOutput {
    const out: SimOutput = {
      recT: Float64Array.from(this.recT),
      recNode: Int32Array.from(this.recNode),
      recApd: Float32Array.from(this.recApd),
      recWave: Int32Array.from(this.recWave),
      ecg: Float32Array.from(this.ecgBuf),
      ecgStartIndex: this.ecgBuf.length ? this.ecgStart : this.sampleCount,
      sampleCount: this.sampleCount,
      waves: [...this.touched].map((id) => ({ ...this.waves.get(id)! })),
    };
    this.recT = [];
    this.recNode = [];
    this.recApd = [];
    this.recWave = [];
    this.ecgBuf = [];
    this.touched.clear();
    // forget waves that are long finished
    for (const [id, w] of this.waves) if (w.t0 < this.time - 20000) this.waves.delete(id);
    for (const [p] of this.childOf) if (!this.waves.has(p)) this.childOf.delete(p);
    return out;
  }

  snapshot(): SimSnapshot {
    return {
      time: this.time,
      queue: this.queue.snapshot(),
      lastAct: this.lastAct.slice(),
      prevAct: this.prevAct.slice(),
      apd: this.apd.slice(),
      erp: this.erp.slice(),
      lastWave: this.lastWave.slice(),
      t50: this.t50.slice(),
      clMem: this.clMem.slice(),
      linkLastExit: this.linkLastExit.slice(),
      linkLastEntry: this.linkLastEntry.slice(),
      linkDir: this.linkDir.slice(),
      linkTransit: this.linkTransit.slice(),
      counters: { ...this.counters },
      childOf: [...this.childOf],
      waveCounter: this.waveCounter,
      active: this.active.slice(0, this.activeLen),
      rng: this.rng.state,
      params: cloneParams(this.params),
      waves: [...this.waves].map(([k, v]) => [k, { ...v }]),
      recCount: this.recCount,
      sampleCount: this.sampleCount,
    };
  }

  restore(s: SimSnapshot): void {
    this.time = s.time;
    this.queue.restore(s.queue);
    this.lastAct.set(s.lastAct);
    this.prevAct.set(s.prevAct);
    this.apd.set(s.apd);
    this.erp.set(s.erp);
    this.lastWave.set(s.lastWave);
    this.t50.set(s.t50);
    this.clMem.set(s.clMem);
    this.linkLastExit.set(s.linkLastExit);
    this.linkLastEntry.set(s.linkLastEntry);
    this.linkDir.set(s.linkDir);
    this.linkTransit.set(s.linkTransit);
    this.counters = { ...s.counters };
    this.childOf = new Map(s.childOf);
    this.waveCounter = s.waveCounter;
    this.inActive.fill(0);
    this.active.set(s.active);
    this.activeLen = s.active.length;
    for (let a = 0; a < this.activeLen; a++) this.inActive[this.active[a]] = 1;
    this.rng.state = s.rng;
    this.params = cloneParams(s.params);
    this.d = derive(this.model, this.params);
    this.waves = new Map(s.waves.map(([k, v]) => [k, { ...v }]));
    this.recCount = s.recCount;
    this.sampleCount = s.sampleCount;
    this.recT = [];
    this.recNode = [];
    this.recApd = [];
    this.recWave = [];
    this.ecgBuf = [];
    this.touched.clear();
  }
}
