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
import { cloneParams, type SimParams } from "./params";
import { derive, type Derived } from "./derive";
import { EV_AUTO, EV_EXCITE, EventQueue, type QueueSnapshot } from "./eventQueue";
import { Rng } from "./rng";
import { SHAPES, apdFromDI, repolMidpoint, steadyStateApd, ventricularNotchScale, workingA } from "../cellular/actionPotential";
import { N_CHANNELS, N_COLS, columnsToChannels, computeLeadField } from "../ecg-forward/leadField";

export type WaveOrigin = "sinus" | "junctional" | "ventricular-escape" | "ectopic";

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
  avnLastExit: number;
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

const NEVER = -1e9;

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
  avnLastExit = NEVER;
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
    this.active = new Int32Array(n);
    this.inActive = new Uint8Array(n);
    this.notchScale = new Float32Array(n);
    for (let i = 0; i < n; i++) this.notchScale[i] = model.cellType[i] === CT.VENTRICULAR ? ventricularNotchScale(model.transmural[i]) : 1;
    this.rng = new Rng(params.seed);
    this.reset();
  }

  /** Initial state approximates steady state at the sinus cycle length. */
  reset(): void {
    const n = this.model.n;
    const cl = this.d.sinusCycle;
    for (let i = 0; i < n; i++) {
      const ss = steadyStateApd(this.d.apdInf[i], this.d.apdRef[i], cl);
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
    this.avnLastExit = -cl + 100;
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
  }

  /** Apply new parameters from the current simulation time onward. */
  setParams(p: SimParams): void {
    const old = this.d;
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
      else this.onExcite(ev.time, ev.node, ev.src, ev.wave);
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

  private onExcite(t: number, node: number, src: number, wave: number): void {
    const m = this.model;
    if (node === m.avn) {
      this.onAvNode(t, src, wave);
      return;
    }
    if (t - this.lastAct[node] < this.erp[node]) return; // refractory → conduction block here
    if (wave < 0) {
      // externally injected stimulus
      wave = ++this.waveCounter;
      this.waves.set(wave, newWave(wave, "ectopic", node, t));
    }
    this.activate(node, t, wave, false);
  }

  /** Lumped AV node: directional, recovery-dependent conduction (Sun et al. 1995, recovery term). */
  private onAvNode(t: number, src: number, wave: number): void {
    const m = this.model;
    const a = this.d.avn;
    const antegrade = src >= 0 && m.cellType[src] === CT.ATRIAL;
    if (!antegrade && !a.retrograde) return;
    const R = t - this.avnLastExit;
    const w = this.waves.get(wave);
    if (R < a.erp) {
      if (w && antegrade && !w.avnBlocked && Number.isNaN(w.tAvnOut)) {
        w.avnBlocked = true;
        w.tAvnIn = t;
        w.avnRecovery = R;
        this.touched.add(wave);
      }
      return;
    }
    const delay = a.ahMin + a.amplitude * Math.exp(-(R - a.erp) / a.tau);
    const exit = t + delay;
    this.avnLastExit = exit;
    // Record nodal "activation" for display (AP of compact node starts at entry)
    this.activateRecordOnly(m.avn, t, wave);
    if (w) {
      w.tAvnIn = t;
      w.tAvnOut = exit;
      w.avnRecovery = R;
      this.touched.add(wave);
    }
    if (antegrade) this.queue.push(exit, m.hisProximal, m.avn, wave, EV_EXCITE);
    else for (const i of m.avnAtrialInputs) this.queue.push(exit, i, m.avn, wave, EV_EXCITE);
  }

  private activateRecordOnly(node: number, t: number, wave: number): void {
    const di = t - (this.lastAct[node] + this.apd[node]);
    this.prevAct[node] = this.lastAct[node];
    this.lastAct[node] = t;
    this.apd[node] = apdFromDI(this.d.apdInf[node], this.d.apdRef[node], di);
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
    const apd = apdFromDI(d.apdInf[node], d.apdRef[node], di);
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
    void spontaneous;

    // Propagate to neighbours
    const ra = this.params.restitution.cvAmplitude;
    const rt = this.params.restitution.cvTau;
    for (let q = m.adjStart[node]; q < m.adjStart[node + 1]; q++) {
      const j = m.adjNode[q];
      let delay = d.edgeDelay[q];
      const arrival0 = t + delay;
      if (j !== m.avn) {
        // skip neighbours that will certainly still be refractory on arrival
        if (arrival0 - this.lastAct[j] < this.erp[j]) continue;
        if (d.edgeRestitutes[q] && ra > 0) {
          const dij = arrival0 - (this.lastAct[j] + this.apd[j]);
          const f = 1 - ra * Math.exp(-Math.max(0, dij) / rt);
          delay /= Math.max(0.05, f);
        }
      } else if (m.adjKind[q] === EK.AVN_OUT && node !== m.hisProximal) {
        continue;
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
      avnLastExit: this.avnLastExit,
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
    this.avnLastExit = s.avnLastExit;
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
