/**
 * Reduced-order (phenomenological) action-potential layer — Fidelity Level 1/2 support.
 *
 * Each cell's transmembrane potential is a parametric waveform anchored to its activation
 * time and its APD90. This is the "reaction-eikonal"-style decoupling used in fast ECG
 * models (activation from a propagation solver, Vm from a template): see Neic et al. 2017
 * and the ECGSIM approach (van Oosterom & Oostendorp 2004). It is NOT an ionic model: the
 * phases (0–4) are shape features, not computed currents. Level-3 ionic models are planned
 * for Phase 4.
 *
 * Rate dependence: APD90 = APDinf · ρ(DI), using the Mitchell–Schaeffer (2003) restitution
 * map ρ(DI) = ln[(1 − (1 − h)·e^(−DI/τ)) / h] / ln(1/h). h and τ were least-squares fitted
 * so the steady-state APD–CL relation reproduces the human in-vivo slope of ≈ 23 ms per
 * 100 ms cycle length (Franz et al. 1988) over CL 400–1000 ms. The fitted τ has no ionic
 * meaning. Dynamic (beat-to-beat) restitution and slow APD memory are NOT calibrated.
 */
import { CT } from "../core/model";

export const RESTITUTION = { h: 0.1, tau: 2880 };
/** Numerical safeguard (not data-derived): APD never falls below this fraction of APDref. */
export const APD_FLOOR_FRACTION = 0.45;

export function rho(di: number): number {
  const { h, tau } = RESTITUTION;
  const x = Math.max(0, di);
  return Math.log((1 - (1 - h) * Math.exp(-x / tau)) / h) / Math.log(1 / h);
}

/** APDinf such that steady-state APD at CL = 1000 ms equals apdRef. */
export function apdInfFromRef(apdRef: number): number {
  return apdRef / rho(1000 - apdRef);
}

export function apdFromDI(apdInf: number, apdRef: number, di: number): number {
  return Math.max(APD_FLOOR_FRACTION * apdRef, apdInf * rho(di));
}

/**
 * Two-component restitution (Phase 2, replaces the single map for dynamic behaviour).
 *
 * Franz et al. 1988 (J Clin Invest 82:972, doi:10.1172/JCI113706) report that in humans
 * (a) steady-state APD rises ≈ 23 ms per 100 ms of cycle length, (b) after a rate step the
 * first APD changes abruptly but full adaptation takes minutes, and (c) the extrastimulus
 * restitution curve rises steeply at short coupling and then plateaus. The single fitted MS map
 * reproduces (a) only; used dynamically it gave unphysiologically short APDs for premature
 * beats (≈ 135 ms at DI 100 ms). Here:
 *   APD = APDref · S(CL_mem) · (1 − A·exp(−DI/τf))
 * S = steady-state scale from the fitted map (keeps (a)); CL_mem = per-cell exponentially
 * weighted cycle length (memory); the fast term gives the steep initial rise of (c).
 * A, τf and the memory weight are NOMINAL (shape-matched, not fitted): see SCIENTIFIC_LIMITATIONS.
 * Memory adapts within ≈ 4–8 beats, much faster than the minutes reported in humans.
 */
export const DYNAMIC_RESTITUTION = { amplitude: 0.35, tau: 50, memoryWeight: 0.25 };
const SS_LUT_MIN = 150;
const SS_LUT_STEP = 10;
const SS_LUT: Float32Array = (() => {
  const n = Math.round((3000 - SS_LUT_MIN) / SS_LUT_STEP) + 1;
  const lut = new Float32Array(n);
  const inf = apdInfFromRef(300);
  for (let k = 0; k < n; k++) lut[k] = steadyStateApd(inf, 300, SS_LUT_MIN + k * SS_LUT_STEP) / 300;
  return lut;
})();
/** Steady-state APD / APDref at cycle length cl (from the fitted map; APDref is defined at CL 1000). */
export function steadyStateScale(cl: number): number {
  const f = (Math.min(3000, Math.max(SS_LUT_MIN, cl)) - SS_LUT_MIN) / SS_LUT_STEP;
  const k = Math.min(SS_LUT.length - 2, Math.floor(f));
  return SS_LUT[k] + (SS_LUT[k + 1] - SS_LUT[k]) * (f - k);
}
export function apdDynamic(apdRef: number, clMem: number, di: number): number {
  const { amplitude, tau } = DYNAMIC_RESTITUTION;
  const a = apdRef * steadyStateScale(clMem) * (1 - amplitude * Math.exp(-Math.max(0, di) / tau));
  return Math.max(APD_FLOOR_FRACTION * apdRef, a);
}

/** Steady-state APD at a given cycle length (fixed-point iteration). */
export function steadyStateApd(apdInf: number, apdRef: number, cl: number): number {
  let a = Math.min(apdRef, 0.6 * cl);
  for (let i = 0; i < 60; i++) {
    const next = apdFromDI(apdInf, apdRef, cl - a);
    if (Math.abs(next - a) < 1e-4) return next;
    a = 0.5 * a + 0.5 * next;
  }
  return a;
}

export interface Shape {
  vRest: number;
  vPeak: number;
  upTau: number; // logistic upstroke time constant (ms) — includes spatial-discretisation smoothing
  upDelay: number; // ms from activation to 50 % upstroke
  notch: number; // phase-1 notch depth (fraction of amplitude)
  plateau: number; // early plateau level (fraction of amplitude)
  plateauSlope: number; // fractional decline of the plateau over one APD
  repolWidth: number; // phase-3 logistic width as a fraction of APD
}

export const SHAPES: Record<number, Shape> = {
  [CT.ATRIAL]: { vRest: -80, vPeak: 25, upTau: 0.8, upDelay: 2.5, notch: 0.08, plateau: 0.62, plateauSlope: 0.3, repolWidth: 0.12 },
  [CT.HIS]: { vRest: -88, vPeak: 38, upTau: 0.5, upDelay: 1.5, notch: 0.25, plateau: 0.78, plateauSlope: 0.15, repolWidth: 0.06 },
  [CT.PURKINJE]: { vRest: -88, vPeak: 40, upTau: 0.5, upDelay: 1.5, notch: 0.25, plateau: 0.78, plateauSlope: 0.15, repolWidth: 0.06 },
  [CT.VENTRICULAR]: { vRest: -85, vPeak: 35, upTau: 0.9, upDelay: 2.8, notch: 0.05, plateau: 0.86, plateauSlope: 0.14, repolWidth: 0.055 },
};

/** Nodal cells (displayed only; SA/AV nodal mass contributes nothing to the ECG in this model). */
export const NODAL = {
  san: { mdp: -62, threshold: -42, peak: 12, upDuration: 10, apd: 150 },
  avn: { mdp: -65, threshold: -45, peak: 5, upDuration: 18, apd: 200 },
};

/** Tabulated logistic 1/(1+e^(−x)) with linear interpolation (hot path of the ECG loop). */
const SIG_MIN = -24;
const SIG_MAX = 24;
const SIG_STEPS = 6144;
const SIG_SCALE = SIG_STEPS / (SIG_MAX - SIG_MIN);
const SIG = new Float64Array(SIG_STEPS + 2);
for (let i = 0; i <= SIG_STEPS + 1; i++) SIG[i] = 1 / (1 + Math.exp(-(SIG_MIN + i / SIG_SCALE)));
export function sigmoid(x: number): number {
  if (x <= SIG_MIN) return 0;
  if (x >= SIG_MAX) return 1;
  const f = (x - SIG_MIN) * SIG_SCALE;
  const i = f | 0;
  return SIG[i] + (SIG[i + 1] - SIG[i]) * (f - i);
}

/** Per-activation constants for fast evaluation of working-cell waveforms. */
export function repolMidpoint(s: Shape, apd: number): number {
  // A(APD) = 0.10 (90 % repolarisation). Ignoring the notch & spike, A ≈ P(APD)·R(APD).
  const pEnd = s.plateau * (1 - s.plateauSlope);
  const w = s.repolWidth * apd;
  const r = Math.min(0.999, 0.1 / pEnd);
  return apd - w * Math.log(1 / r - 1);
}

/**
 * Normalised activation A(τ) in [0, 1] for working/conduction cells (V = vRest + A·(vPeak − vRest)).
 * τ = t − tActivation (ms). `notchScale` modulates the phase-1 notch (epicardium > endocardium).
 */
export function workingA(s: Shape, tau: number, apd: number, t50: number, notchScale = 1): number {
  if (tau < 0) return 0;
  const up = tau > 12 ? 1 : sigmoid((tau - s.upDelay) / s.upTau);
  let p = s.plateau - s.plateau * s.plateauSlope * Math.min(tau / apd, 1.2);
  if (tau < 25) p += (1 - s.plateau) * Math.exp(-tau / 2.5);
  if (tau < 40 && s.notch > 0) {
    const z = (tau - 9) / 5;
    p -= s.notch * notchScale * Math.exp(-z * z);
  }
  const w = s.repolWidth * apd;
  const r = sigmoid((t50 - tau) / w);
  return up * p * r;
}

/** Notch scale for ventricular cells as a function of transmural position (0 endo … 1 epi). */
export const ventricularNotchScale = (e: number): number => 0.6 + 3.4 * e;

/**
 * Nodal waveform with phase-4 diastolic depolarisation for display.
 * `cycle` = time to the next activation (or current cycle estimate) for the phase-4 ramp.
 */
export function nodalV(kind: "san" | "avn", tau: number, apd: number, cycle: number): number {
  const n = NODAL[kind];
  if (tau < 0) return n.mdp;
  // Phase 0: slow Ca-dependent upstroke from threshold to peak
  const upFrac = Math.min(1, tau / n.upDuration);
  const up = n.threshold + (n.peak - n.threshold) * (0.5 - 0.5 * Math.cos(Math.PI * upFrac));
  // Phase 3: repolarisation to the maximum diastolic potential
  const w = 0.13 * apd;
  const t50 = apd - w * Math.log(9);
  const r = 1 / (1 + Math.exp((tau - t50) / w));
  let v = n.mdp + (up - n.mdp) * r;
  // Phase 4: diastolic depolarisation towards threshold (SA node: reaches threshold at next firing)
  const t4 = tau - apd;
  if (t4 > 0) {
    const span = Math.max(1, cycle - apd);
    const target = kind === "san" ? n.threshold : n.mdp + 6;
    v += (target - n.mdp) * Math.min(1, t4 / span) * (1 - r);
  }
  return v;
}

/** Phase labels (0–4) for working cells, by time since activation. */
export function workingPhase(tau: number, apd: number, s: Shape): 0 | 1 | 2 | 3 | 4 {
  if (tau < 0 || tau > apd + 3 * s.repolWidth * apd) return 4;
  if (tau < s.upDelay + 3 * s.upTau) return 0;
  if (tau < 15) return 1;
  if (tau < repolMidpoint(s, apd) - 1.2 * s.repolWidth * apd) return 2;
  return 3;
}
