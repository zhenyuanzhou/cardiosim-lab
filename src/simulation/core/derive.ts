/**
 * Parameter-dependent quantities derived from (model, params). Recomputed whenever
 * parameters change; cheap relative to the simulation itself.
 */
import { CT, EK, type CardiacModel } from "./model";
import type { RetroMode, SimParams } from "./params";
import { NODAL, apdInfFromRef } from "../cellular/actionPotential";
import { calciumApdShift, potassiumEffect } from "../cellular/electrolytes";
import { ischaemiaModifiers } from "./ischaemia";
import { Rng } from "./rng";

/** Nominal autonomic sensitivity coefficients (NOT data-derived; see params metadata). */
export const AUTONOMIC = {
  sinusVagal: 0.85,
  sinusSympathetic: 0.9,
  avnVagal: 0.5,
  avnSympathetic: 0.4,
  /** Reference tone at which AV-nodal parameters are specified (= defaults). */
  refVagal: 0.5,
  refSympathetic: 0.1,
};

export interface Derived {
  /** Base conduction delay (ms) for each CSR adjacency entry at full excitability. */
  edgeDelay: Float32Array;
  /** Whether CV restitution applies to the adjacency entry. */
  edgeRestitutes: Uint8Array;
  apdRef: Float32Array;
  apdInf: Float32Array;
  erpRatio: Float32Array;
  sinusRateBpm: number;
  sinusCycle: number;
  junctionalCycle: number;
  ventricularEscapeCycle: number;
  avn: { ahMin: number; amplitude: number; tau: number; erp: number; retrograde: RetroMode; retroTime: number; retroErp: number };
  hisTotalLength: number;
  /** Per lumped link (same order as model.links). */
  links: LinkParams[];
  /** Per-node AP amplitude factor (regional ischaemia; 1 elsewhere). */
  apAmp: Float32Array;
  /** Per-node resting-potential shift (mV; display only — a uniform DC offset does not reach the AC-coupled ECG). */
  restShift: Float32Array;
  /** Per-node ischaemic weight 0…1 (null when no ischaemia). */
  ischaemia: Float32Array | null;
}

/**
 * Parameters of a lumped directional link. Delay = base + amplitude·exp(−(R − ERP)/τ), where
 * R is the recovery time measured from the previous exit ("exit") or the previous invasion ("entry").
 */
export interface LinkParams {
  enabled: boolean;
  ante: boolean;
  retro: RetroMode;
  anteBase: number;
  retroBase: number;
  amplitude: number;
  tau: number;
  anteErp: number;
  retroErp: number;
  recoveryFrom: "exit" | "entry";
  concealment: number;
}

export function deriveLinks(model: CardiacModel, p: SimParams, avn: Derived["avn"]): LinkParams[] {
  const off: LinkParams = { enabled: false, ante: false, retro: "blocked", anteBase: 0, retroBase: 0, amplitude: 0, tau: 1, anteErp: 0, retroErp: 0, recoveryFrom: "entry", concealment: 0 };
  const cb = p.avNode.completeBlock;
  return model.links.map((l) => {
    if (l.id === "avn-fast")
      return { enabled: !cb, ante: true, retro: avn.retrograde, anteBase: avn.ahMin, retroBase: avn.retroTime, amplitude: avn.amplitude, tau: avn.tau, anteErp: avn.erp, retroErp: avn.retroErp, recoveryFrom: "exit", concealment: p.avNode.concealment };
    if (l.id === "avn-slow") {
      if (!p.avNode.dualPathway || cb) return off;
      const f = avn.ahMin / Math.max(1e-6, p.avNode.ahMin); // same autonomic scaling as the fast pathway
      return { enabled: true, ante: true, retro: "blocked", anteBase: p.avNode.slowAhMin * f, retroBase: p.avNode.slowAhMin * f, amplitude: avn.amplitude, tau: avn.tau, anteErp: p.avNode.slowErp * f, retroErp: p.avNode.slowErp * f, recoveryFrom: "entry", concealment: p.avNode.concealment };
    }
    if (l.id === p.accessory.site) {
      const a = p.accessory;
      return { enabled: true, ante: a.antegrade, retro: "conducted", anteBase: a.conductionTime, retroBase: a.conductionTime, amplitude: 0, tau: 1, anteErp: a.anteErp, retroErp: a.retroErp, recoveryFrom: "entry", concealment: 0 };
    }
    return off;
  });
}

/** Node masks of the optional arrhythmia substrates for a parameter set (also used by the renderer). */
export function substrateMasks(model: { n: number; substrates: Record<string, ArrayLike<number>> }, p: SimParams) {
  const blocked = new Uint8Array(model.n);
  const cti = new Uint8Array(model.n);
  const isthmus = new Uint8Array(model.n);
  const border = new Uint8Array(model.n);
  const S = model.substrates ?? {};
  const mark = (arr: Uint8Array, key: string) => {
    const l = S[key];
    if (l) for (let k = 0; k < l.length; k++) arr[l[k]] = 1;
  };
  if (p.atria.flutterSubstrate) {
    for (const k of ["tvCap", "svc", "ivc", "intercaval"]) mark(blocked, k);
    mark(cti, "cti");
  }
  if (p.ventricles.scar) {
    mark(blocked, "scarCore");
    mark(blocked, "scarPurkinje");
    mark(isthmus, "scarIsthmus");
    mark(border, "scarBorder");
  }
  return { blocked, cti, isthmus, border };
}

export function derive(model: CardiacModel, p: SimParams): Derived {
  const sub = substrateMasks(model, p);
  const n = model.n;
  const m = model.adjNode.length;
  const edgeDelay = new Float32Array(m);
  const edgeRestitutes = new Uint8Array(m);
  const P = model.pos;
  const F = model.fiber;

  // His length (for distributing the His conduction time)
  let hisLen = 0;
  for (let i = 0; i < n; i++)
    for (let q = model.adjStart[i]; q < model.adjStart[i + 1]; q++) if (model.adjKind[q] === EK.HIS) hisLen += model.adjLen[q];
  hisLen /= 2;

  const vL = p.ventricles.cvLongitudinal;
  const vT = vL / p.ventricles.anisotropyRatio;
  const hp = p.hisPurkinje;
  // extracellular potassium (TP06): conduction in all Na⁺-dependent tissue; regional ischaemia
  const kEff = potassiumEffect(p.electrolytes.serumPotassium);
  const kCv = kEff.cvScale;
  const isch = ischaemiaModifiers(model as unknown as Parameters<typeof ischaemiaModifiers>[0], p);
  for (let i = 0; i < n; i++) {
    for (let q = model.adjStart[i]; q < model.adjStart[i + 1]; q++) {
      const j = model.adjNode[q];
      const L = model.adjLen[q];
      let d = 0;
      let rest = 1;
      switch (model.adjKind[q]) {
        case EK.VENT: {
          const dx = P[3 * j] - P[3 * i];
          const dy = P[3 * j + 1] - P[3 * i + 1];
          const dz = P[3 * j + 2] - P[3 * i + 2];
          let fx = F[3 * i] + F[3 * j];
          let fy = F[3 * i + 1] + F[3 * j + 1];
          let fz = F[3 * i + 2] + F[3 * j + 2];
          const fn = Math.hypot(fx, fy, fz) || 1;
          fx /= fn;
          fy /= fn;
          fz /= fn;
          const along = dx * fx + dy * fy + dz * fz;
          const across2 = Math.max(0, dx * dx + dy * dy + dz * dz - along * along);
          d = Math.sqrt((along * along) / (vL * vL) + across2 / (vT * vT));
          break;
        }
        case EK.ATRIAL:
          d = L / p.atria.cv;
          break;
        case EK.ATRIAL_FAST:
          d = L / (p.atria.cv * p.atria.fastPathFactor);
          break;
        case EK.SAN_EXIT:
          d = p.sinus.exitDelay;
          rest = 0;
          break;
        case EK.AVN_IN:
        case EK.AVN_OUT:
          d = 0; // AV nodal delay is computed dynamically by the AV node model
          rest = 0;
          break;
        case EK.HIS:
          d = hisLen > 0 ? (L / hisLen) * hp.hisDelay : 0;
          break;
        case EK.LBB:
        case EK.LSF:
          d = hp.lbbBlock ? Infinity : L / hp.lbbCv;
          break;
        case EK.RBB:
          d = hp.rbbBlock ? Infinity : L / hp.rbbCv;
          break;
        case EK.LAF:
          d = hp.lbbBlock || hp.lafBlock ? Infinity : L / hp.lafCv;
          break;
        case EK.LPF:
          d = hp.lbbBlock || hp.lpfBlock ? Infinity : L / hp.lpfCv;
          break;
        case EK.PURKINJE:
          d = L / hp.purkinjeCv;
          break;
        case EK.PMJ:
          // orthograde (Purkinje → muscle) vs retrograde (muscle → Purkinje) junction delay
          d = model.cellType[i] === CT.VENTRICULAR ? (hp.pmjRetroDelay >= 200 ? Infinity : hp.pmjRetroDelay) : hp.pmjDelay;
          break;
      }
      if (kCv !== 1) {
        const k = model.adjKind[q];
        if (k === EK.VENT || k === EK.ATRIAL || k === EK.ATRIAL_FAST || k === EK.HIS || k === EK.LBB || k === EK.RBB || k === EK.LAF || k === EK.LPF || k === EK.LSF || k === EK.PURKINJE) d /= kCv;
      }
      if (isch.field && model.adjKind[q] === EK.VENT) d /= 0.5 * (isch.cv[i] + isch.cv[j]);
      if (sub.blocked[i] || sub.blocked[j]) d = Infinity;
      else if (sub.cti[i] && sub.cti[j]) d /= p.atria.ctiCvFactor;
      else if (sub.isthmus[i] && sub.isthmus[j]) d /= p.ventricles.isthmusCvFactor;
      else if ((sub.border[i] || sub.isthmus[i]) && (sub.border[j] || sub.isthmus[j])) d /= p.ventricles.borderCvFactor;
      edgeDelay[q] = d;
      edgeRestitutes[q] = rest;
    }
  }

  // ---- APD maps ----------------------------------------------------------------
  const apdRef = new Float32Array(n);
  const erpRatio = new Float32Array(n);
  const v = p.ventricles;
  for (let i = 0; i < n; i++) {
    switch (model.cellType[i]) {
      case CT.VENTRICULAR:
        apdRef[i] = v.apd + v.transmuralGradient * (0.5 - model.transmural[i]) + v.apicobasalGradient * (model.apicobasal[i] - 0.5);
        erpRatio[i] = v.erpRatio;
        break;
      case CT.ATRIAL:
        apdRef[i] = p.atria.apd;
        erpRatio[i] = p.atria.erpRatio;
        break;
      case CT.HIS:
      case CT.PURKINJE:
        apdRef[i] = hp.apd;
        erpRatio[i] = v.erpRatio;
        break;
      case CT.SAN:
        apdRef[i] = NODAL.san.apd;
        erpRatio[i] = 0.9;
        break;
      case CT.AVN:
        apdRef[i] = NODAL.avn.apd;
        erpRatio[i] = 1;
        break;
    }
  }
  smoothVentricularApd(model, apdRef, v.electrotonicSmoothing);
  // Serum calcium: additive shift from the measured human QT–calcium slope (see electrolytes.ts).
  // Applied after smoothing because it is a uniform offset, not a spatial gradient.
  const caShift = calciumApdShift(p.electrolytes.serumCalcium);
  if (caShift !== 0) for (let i = 0; i < n; i++) if (model.cellType[i] === CT.VENTRICULAR) apdRef[i] = Math.max(60, apdRef[i] + caShift);
  // potassium (TP06 APD scale, ventricles) and regional ischaemia (TP06 under phase-1a conditions)
  for (let i = 0; i < n; i++) if (model.cellType[i] === CT.VENTRICULAR) apdRef[i] *= kEff.apdScale * isch.apd[i];
  // substrate-specific repolarisation
  for (let i = 0; i < n; i++) {
    if (sub.cti[i]) apdRef[i] *= p.atria.ctiApdFactor;
    if (sub.isthmus[i] || sub.border[i]) apdRef[i] *= p.ventricles.isthmusApdFactor;
  }
  if (p.atria.heterogeneity > 0) applyAtrialHeterogeneity(model, apdRef, p.atria.heterogeneity, p.seed, CT.ATRIAL);
  if (v.heterogeneity > 0) applyAtrialHeterogeneity(model, apdRef, v.heterogeneity, p.seed ^ 0x5bf03635, CT.VENTRICULAR);
  const apdInf = new Float32Array(n);
  for (let i = 0; i < n; i++) apdInf[i] = apdInfFromRef(apdRef[i]);

  const auto = deriveAutonomic(p);
  return {
    ...auto,
    links: deriveLinks(model, p, auto.avn),
    edgeDelay,
    edgeRestitutes,
    apdRef,
    apdInf,
    erpRatio,
    hisTotalLength: hisLen,
    apAmp: isch.amp,
    restShift: isch.rest,
    ischaemia: isch.field,
  };
}

/** Pacemaker and AV-nodal quantities after autonomic modulation (no model needed). */
export function deriveAutonomic(p: SimParams) {
  const A = AUTONOMIC;
  const vag = p.sinus.vagalTone;
  const sym = p.sinus.sympatheticTone;
  const sinusRateBpm = p.sinus.intrinsicRate * Math.exp(A.sinusSympathetic * sym - A.sinusVagal * vag);
  const avnFactor = Math.exp(A.avnVagal * (vag - A.refVagal) - A.avnSympathetic * (sym - A.refSympathetic));
  return {
    sinusRateBpm,
    sinusCycle: 60000 / sinusRateBpm,
    junctionalCycle: 60000 / p.escape.junctionalRate,
    ventricularEscapeCycle: 60000 / p.escape.ventricularRate,
    avn: {
      ahMin: p.avNode.ahMin * avnFactor,
      amplitude: p.avNode.recoveryAmplitude * avnFactor,
      tau: p.avNode.recoveryTau,
      erp: p.avNode.erp * avnFactor,
      retrograde: p.avNode.retrograde,
      retroTime: p.avNode.retroTime * avnFactor,
      retroErp: p.avNode.retroErp * avnFactor,
    },
  };
}

/**
 * Approximate Gaussian smoothing of the ventricular APD map by repeated neighbour
 * averaging (each pass adds ≈ 0.35 h² of variance per axis on a 26-neighbour grid).
 */
function smoothVentricularApd(model: CardiacModel, apd: Float32Array, sigma: number): void {
  if (sigma <= 0) return;
  const h = model.gridSpacing;
  const passes = Math.max(0, Math.round((sigma * sigma) / (0.35 * h * h)));
  const tmp = new Float32Array(apd.length);
  for (let it = 0; it < passes; it++) {
    tmp.set(apd);
    for (let i = 0; i < model.n; i++) {
      if (model.cellType[i] !== CT.VENTRICULAR) continue;
      let s = 0;
      let c = 0;
      for (let q = model.adjStart[i]; q < model.adjStart[i + 1]; q++) {
        if (model.adjKind[q] !== EK.VENT) continue;
        s += tmp[model.adjNode[q]];
        c++;
      }
      if (c > 0) apd[i] = 0.5 * tmp[i] + (0.5 * s) / c;
    }
  }
}

/**
 * Spatially smoothed, seeded random dispersion of APD within one cell type (relative SD = h).
 * Smoothing over neighbours of the same type gives a correlation length of a few millimetres;
 * the field is re-normalised to SD = h. Used for the atria (AF substrate) and, with a different
 * seed, for the ventricles (polymorphic VT / VF substrate).
 */
function applyAtrialHeterogeneity(model: CardiacModel, apd: Float32Array, h: number, seed: number, type: number): void {
  const n = model.n;
  const rng = new Rng((seed * 2654435761) >>> 0 || 7);
  let z = new Float32Array(n);
  for (let i = 0; i < n; i++) if (model.cellType[i] === type) z[i] = rng.next() * 2 - 1;
  for (let pass = 0; pass < 3; pass++) {
    const nz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (model.cellType[i] !== type) continue;
      let s = z[i];
      let c = 1;
      for (let q = model.adjStart[i]; q < model.adjStart[i + 1]; q++) {
        const j = model.adjNode[q];
        if (model.cellType[j] !== type) continue;
        s += z[j];
        c++;
      }
      nz[i] = s / c;
    }
    z = nz;
  }
  let m = 0, m2 = 0, k = 0;
  for (let i = 0; i < n; i++) if (model.cellType[i] === type) { m += z[i]; m2 += z[i] * z[i]; k++; }
  m /= k;
  const sd = Math.sqrt(Math.max(1e-9, m2 / k - m * m));
  for (let i = 0; i < n; i++) if (model.cellType[i] === type) apd[i] *= Math.max(0.4, 1 + (h * (z[i] - m)) / sd);
}
