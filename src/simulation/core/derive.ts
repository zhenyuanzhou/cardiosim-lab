/**
 * Parameter-dependent quantities derived from (model, params). Recomputed whenever
 * parameters change; cheap relative to the simulation itself.
 */
import { CT, EK, type CardiacModel } from "./model";
import type { SimParams } from "./params";
import { NODAL, apdInfFromRef } from "../cellular/actionPotential";

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
  avn: { ahMin: number; amplitude: number; tau: number; erp: number; retrograde: boolean };
  hisTotalLength: number;
}

export function derive(model: CardiacModel, p: SimParams): Derived {
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
          d = L / hp.lbbCv;
          break;
        case EK.RBB:
          d = L / hp.rbbCv;
          break;
        case EK.LAF:
          d = L / hp.lafCv;
          break;
        case EK.LPF:
          d = L / hp.lpfCv;
          break;
        case EK.PURKINJE:
          d = L / hp.purkinjeCv;
          break;
        case EK.PMJ:
          d = hp.pmjDelay;
          break;
      }
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
  const apdInf = new Float32Array(n);
  for (let i = 0; i < n; i++) apdInf[i] = apdInfFromRef(apdRef[i]);

  const auto = deriveAutonomic(p);
  return {
    ...auto,
    edgeDelay,
    edgeRestitutes,
    apdRef,
    apdInf,
    erpRatio,
    hisTotalLength: hisLen,
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
