/**
 * UI-thread side of the simulation: receives chunks from the worker, keeps the shared
 * history (activation records, ECG samples, wave summaries) and answers "what is the
 * state of cell i at simulation time t" for every view. All views read from this single
 * store, so heart animation, action potentials and ECG are always drawn from the same data.
 */
import type { SimParams } from "../core/params";
import type { WaveInfo } from "../core/engine";
import { N_CHANNELS } from "../ecg-forward/leadField";
import { measureBeats, type BeatMeasurement } from "../ecg-forward/measurements";
import type { FromWorker, ModelMeta, ToWorker } from "./protocol";
import type { SurfaceMesh } from "../tissue/surfaces";
import SimWorker from "./simWorker?worker&inline";
import { SimHost } from "./simHost";

const RETAIN_MS = 120_000;

export class SimData {
  dt: number;
  /** ECG history: absolute sample index s is stored at (s - sampleOffset). */
  ecg = new Float32Array(N_CHANNELS * 20000);
  sampleOffset = 0;
  sampleEnd = 0; // absolute index one past the last sample
  recT = new Float64Array(1 << 18);
  recNode = new Int32Array(1 << 18);
  recApd = new Float32Array(1 << 18);
  recWave = new Int32Array(1 << 18);
  nRec = 0;
  nodeActs: number[][];
  waves = new Map<number, WaveInfo>();
  simTime = 0;
  version = 0;
  beats: BeatMeasurement[] = [];
  private beatsVersion = -1;

  constructor(n: number, dt: number) {
    this.dt = dt;
    this.nodeActs = Array.from({ length: n }, () => []);
  }

  get tStart(): number {
    return this.sampleOffset * this.dt;
  }
  get tEnd(): number {
    return (this.sampleEnd - 1) * this.dt;
  }

  sample(absIdx: number, ch: number): number {
    const k = absIdx - this.sampleOffset;
    if (k < 0 || absIdx >= this.sampleEnd) return NaN;
    return this.ecg[k * N_CHANNELS + ch];
  }

  /** Lead value at time t (linear interpolation). */
  at(t: number, ch: number): number {
    const f = t / this.dt;
    const i = Math.floor(f);
    const a = this.sample(i, ch);
    const b = this.sample(i + 1, ch);
    if (Number.isNaN(b)) return a;
    return a + (b - a) * (f - i);
  }

  append(o: {
    recT: Float64Array;
    recNode: Int32Array;
    recApd: Float32Array;
    recWave: Int32Array;
    ecg: Float32Array;
    ecgStartIndex: number;
    waves: WaveInfo[];
  }, simTime: number): void {
    // records
    const need = this.nRec + o.recT.length;
    if (need > this.recT.length) {
      let cap = this.recT.length;
      while (cap < need) cap *= 2;
      const g = <T extends Float64Array | Int32Array | Float32Array>(a: T): T => {
        const b = new (a.constructor as { new (n: number): T })(cap);
        b.set(a.subarray(0, this.nRec) as never);
        return b;
      };
      this.recT = g(this.recT);
      this.recNode = g(this.recNode);
      this.recApd = g(this.recApd);
      this.recWave = g(this.recWave);
    }
    for (let k = 0; k < o.recT.length; k++) {
      const r = this.nRec++;
      this.recT[r] = o.recT[k];
      this.recNode[r] = o.recNode[k];
      this.recApd[r] = o.recApd[k];
      this.recWave[r] = o.recWave[k];
      this.nodeActs[o.recNode[k]].push(r);
    }
    // ecg
    const ns = o.ecg.length / N_CHANNELS;
    if (ns > 0) {
      if (this.sampleEnd === this.sampleOffset) this.sampleOffset = o.ecgStartIndex;
      const startK = o.ecgStartIndex - this.sampleOffset;
      const endK = startK + ns;
      if (endK * N_CHANNELS > this.ecg.length) {
        let cap = this.ecg.length;
        while (cap < endK * N_CHANNELS) cap *= 2;
        const b = new Float32Array(cap);
        b.set(this.ecg.subarray(0, (this.sampleEnd - this.sampleOffset) * N_CHANNELS));
        this.ecg = b;
      }
      this.ecg.set(o.ecg, startK * N_CHANNELS);
      this.sampleEnd = o.ecgStartIndex + ns;
    }
    for (const w of o.waves) this.waves.set(w.id, w);
    this.simTime = simTime;
    this.version++;
  }

  truncate(keepRecordsUntil: number, keepSamplesBelow: number, waves: WaveInfo[]): void {
    while (this.nRec > 0 && this.recT[this.nRec - 1] > keepRecordsUntil) {
      this.nRec--;
      this.nodeActs[this.recNode[this.nRec]].pop();
    }
    this.sampleEnd = Math.max(this.sampleOffset, Math.min(this.sampleEnd, keepSamplesBelow));
    const ids = new Set(waves.map((w) => w.id));
    for (const [id, w] of this.waves) if (!ids.has(id) && w.t0 > keepRecordsUntil) this.waves.delete(id);
    for (const w of waves) this.waves.set(w.id, w);
    this.simTime = keepSamplesBelow * this.dt;
    this.version++;
  }

  /** Drop history older than RETAIN_MS behind `t` (keeps memory bounded on long runs). */
  trim(t: number): void {
    const cutT = t - RETAIN_MS;
    if (cutT <= this.tStart + 60_000) return;
    const cutIdx = Math.floor(cutT / this.dt);
    const k = cutIdx - this.sampleOffset;
    this.ecg.copyWithin(0, k * N_CHANNELS, (this.sampleEnd - this.sampleOffset) * N_CHANNELS);
    this.sampleOffset = cutIdx;
    let first = 0;
    while (first < this.nRec && this.recT[first] < cutT - 2000) first++;
    this.recT.copyWithin(0, first, this.nRec);
    this.recNode.copyWithin(0, first, this.nRec);
    this.recApd.copyWithin(0, first, this.nRec);
    this.recWave.copyWithin(0, first, this.nRec);
    this.nRec -= first;
    for (const a of this.nodeActs) a.length = 0;
    for (let r = 0; r < this.nRec; r++) this.nodeActs[this.recNode[r]].push(r);
    for (const [id, w] of this.waves) if (w.t0 < cutT - 5000) this.waves.delete(id);
    this.version++;
  }

  /** Index (into rec arrays) of the latest activation of `node` at or before t, or -1. */
  lastActIndex(node: number, t: number): number {
    const a = this.nodeActs[node];
    let lo = 0;
    let hi = a.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.recT[a[mid]] <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans < 0 ? -1 : a[ans];
  }

  /** All activations of a node within [t0, t1] (record indices), plus one before t0. */
  activationsIn(node: number, t0: number, t1: number): number[] {
    const a = this.nodeActs[node];
    const out: number[] = [];
    for (let k = 0; k < a.length; k++) {
      const t = this.recT[a[k]];
      if (t > t1) break;
      if (t >= t0) {
        if (out.length === 0 && k > 0) out.push(a[k - 1]);
        out.push(a[k]);
      }
    }
    if (out.length === 0) {
      // last activation before the window still determines Vm in it
      let k = a.length - 1;
      while (k >= 0 && this.recT[a[k]] > t1) k--;
      if (k >= 0) out.push(a[k]);
    }
    return out;
  }

  wavesSorted(): WaveInfo[] {
    return [...this.waves.values()].sort((a, b) => a.t0 - b.t0);
  }

  /** Signal-derived beat measurements over the retained history (cached per version). */
  measure(): BeatMeasurement[] {
    if (this.beatsVersion === this.version) return this.beats;
    const ns = this.sampleEnd - this.sampleOffset;
    this.beats = ns > 50 ? measureBeats(this.ecg.subarray(0, ns * N_CHANNELS), this.dt, this.sampleOffset, [...this.waves.values()]) : [];
    this.beatsVersion = this.version;
    return this.beats;
  }
}

export type ClientEvent =
  | { type: "ready"; meta: ModelMeta; buildMs: number }
  | { type: "surfaces" }
  | { type: "data" }
  | { type: "error"; message: string }
  | { type: "compare"; result: Extract<FromWorker, { type: "compareResult" }> };

export class SimClient {
  meta: ModelMeta | null = null;
  data: SimData | null = null;
  surfaces: SurfaceMesh[] | null = null;
  epoch = 0;
  lastComputeMs = 0;
  usingWorker = true;
  private post: (m: ToWorker) => void;
  private listeners = new Set<(e: ClientEvent) => void>();
  private pendingExtend = 0;
  private requestId = 0;
  private compareWaiters = new Map<number, (r: Extract<FromWorker, { type: "compareResult" }>) => void>();
  private dt = 2;

  private worker: Worker | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private initArgs: { params: SimParams; dt: number } | null = null;

  constructor() {
    let worker: Worker | null = null;
    try {
      worker = new SimWorker();
    } catch {
      worker = null;
    }
    if (worker) {
      this.worker = worker;
      worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
      worker.onerror = () => this.useMainThread();
      this.post = (m) => worker!.postMessage(m);
    } else {
      this.post = () => undefined;
      this.useMainThread();
    }
  }

  /** Fallback: run the simulation host on the UI thread (e.g. when workers are blocked). */
  private fallbackActive = false;
  private useMainThread(): void {
    if (this.fallbackActive) return;
    this.fallbackActive = true;
    this.worker?.terminate();
    this.worker = null;
    this.usingWorker = false;
    const host = new SimHost((m) => setTimeout(() => this.onMessage(m), 0));
    this.post = (m) => setTimeout(() => host.handle(m), 0);
    if (this.initArgs) {
      this.post({ type: "init", params: this.initArgs.params, dt: this.initArgs.dt });
    }
  }

  on(fn: (e: ClientEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: ClientEvent): void {
    for (const l of this.listeners) l(e);
  }

  private initialised = false;
  init(params: SimParams, dt = 2): void {
    if (this.initialised) return;
    this.initialised = true;
    this.dt = dt;
    this.initArgs = { params, dt };
    this.post({ type: "init", params, dt });
    // If the worker never answers (blocked by the environment), fall back to the UI thread.
    if (this.usingWorker) this.readyTimer = setTimeout(() => !this.meta && this.useMainThread(), 5000);
  }

  restart(params: SimParams, dt = this.dt): void {
    this.epoch++;
    this.dt = dt;
    if (this.meta) this.data = new SimData(this.meta.n, dt);
    this.pendingExtend = 0;
    this.post({ type: "restart", params, dt, epoch: this.epoch });
    this.ensureAhead(0);
    this.emit({ type: "data" });
  }

  setParams(params: SimParams, at: number): void {
    this.epoch++;
    this.pendingExtend = 0;
    this.post({ type: "setParams", params, at, epoch: this.epoch });
  }

  /** Ask the worker to keep the simulation at least `lead` ms ahead of the display. */
  ensureAhead(displayTime: number, lead = 6000): void {
    const want = displayTime + lead;
    const have = this.data ? this.data.simTime : 0;
    if (want > have && want > this.pendingExtend) {
      this.pendingExtend = want + 4000;
      this.post({ type: "extend", until: this.pendingExtend, epoch: this.epoch });
    }
  }

  compare(a: SimParams, b: SimParams, duration: number): Promise<Extract<FromWorker, { type: "compareResult" }>> {
    const id = ++this.requestId;
    return new Promise((res) => {
      this.compareWaiters.set(id, res);
      this.post({ type: "compare", a, b, duration, requestId: id });
    });
  }

  private onMessage(m: FromWorker): void {
    switch (m.type) {
      case "ready":
        if (this.readyTimer) clearTimeout(this.readyTimer);
        if (this.meta) return; // late duplicate after a fallback
        this.meta = m.meta;
        this.data = new SimData(m.meta.n, m.meta.dt);
        this.emit({ type: "ready", meta: m.meta, buildMs: m.buildMs });
        this.post({ type: "extend", until: 8000, epoch: this.epoch });
        this.pendingExtend = 8000;
        break;
      case "surfaces":
        this.surfaces = m.surfaces;
        this.emit({ type: "surfaces" });
        break;
      case "chunk":
        if (m.epoch !== this.epoch || !this.data) return;
        this.data.append(m.out, m.simTime);
        this.lastComputeMs = m.computeMs;
        this.emit({ type: "data" });
        break;
      case "truncate":
        if (m.epoch !== this.epoch || !this.data) return;
        this.data.truncate(m.keepRecordsUntil, m.keepSamplesBelow, m.waves);
        this.emit({ type: "data" });
        break;
      case "compareResult": {
        const w = this.compareWaiters.get(m.requestId);
        if (w) {
          this.compareWaiters.delete(m.requestId);
          w(m);
        }
        this.emit({ type: "compare", result: m });
        break;
      }
      case "error":
        this.emit({ type: "error", message: m.message });
        break;
    }
  }
}
