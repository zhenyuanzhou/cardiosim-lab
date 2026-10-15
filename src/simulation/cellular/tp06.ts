/**
 * ten Tusscher & Panfilov 2006 human ventricular myocyte model (TP06).
 *
 * Source of the equations: the gotran-generated CellML translation distributed with cbcbeat
 * (`tentusscher_panfilov_2006_epi_cell.py`, `..._M_cell.py`), itself generated from the
 * CellML repository version of ten Tusscher KHWJ, Panfilov AV. Am J Physiol Heart Circ Physiol
 * 2006;291:H1088–H1100. Epicardial and M-cell parameter sets differ only in g_Ks (0.392 vs 0.098).
 *
 * Endocardial variant: g_to = 0.073 and the slower s-gate
 *   s_inf = 1/(1+exp((V+28)/5)),  tau_s = 1000·exp(−(V+67)²/1000) + 8
 * as published by ten Tusscher et al. (2004/2006). NOTE: these endocardial formulas were entered
 * from the published model description, not copied from a machine-readable file; they are flagged
 * in docs/SCIENTIFIC_LIMITATIONS.md.
 *
 * Integration: Rush–Larsen for gating variables, forward Euler for concentrations and V,
 * dt = 0.02 ms. Units: mV, ms, pA/pF, mM.
 *
 * Role in CardioSim: a single-cell "ionic lab". Tissue propagation still uses the reduced-order
 * model; ionic results can be mapped onto it (APD and CV scaling) — a documented approximation.
 */

export type TP06Cell = "epi" | "mid" | "endo";

export interface TP06Mods {
  gKr: number; // multiplier
  gKs: number;
  gNa: number;
  gCaL: number;
  gK1: number;
  gto: number;
  Ko: number; // mM
  Cao: number; // mM
  Nao: number; // mM
}

export const TP06_DEFAULT_MODS: TP06Mods = { gKr: 1, gKs: 1, gNa: 1, gCaL: 1, gK1: 1, gto: 1, Ko: 5.4, Cao: 2, Nao: 140 };

const C = {
  P_kna: 0.03,
  g_K1: 5.405,
  g_Kr: 0.153,
  g_Na: 14.838,
  g_bna: 0.00029,
  g_CaL: 3.98e-5,
  g_bca: 0.000592,
  K_mNa: 40,
  K_mk: 1,
  P_NaK: 2.724,
  K_NaCa: 1000,
  K_sat: 0.1,
  Km_Ca: 1.38,
  Km_Nai: 87.5,
  alpha: 2.5,
  gamma: 0.35,
  K_pCa: 0.0005,
  g_pCa: 0.1238,
  g_pK: 0.0146,
  Buf_c: 0.2,
  Buf_sr: 10,
  Buf_ss: 0.4,
  EC: 1.5,
  K_buf_c: 0.001,
  K_buf_sr: 0.3,
  K_buf_ss: 0.00025,
  K_up: 0.00025,
  V_leak: 0.00036,
  V_rel: 0.102,
  V_sr: 0.001094,
  V_ss: 5.468e-5,
  V_xfer: 0.0038,
  Vmax_up: 0.006375,
  k1_prime: 0.15,
  k2_prime: 0.045,
  k3: 0.06,
  k4: 0.005,
  max_sr: 2.5,
  min_sr: 1,
  Cm: 0.185,
  F: 96485.3415,
  R: 8314.472,
  T: 310,
  V_c: 0.016404,
};

// state indices
const V = 0, XR1 = 1, XR2 = 2, XS = 3, M = 4, H = 5, J = 6, D = 7, F = 8, F2 = 9, FCASS = 10, S = 11, R = 12, CAI = 13, RP = 14, CASR = 15, CASS = 16, NAI = 17, KI = 18;
export const TP06_NSTATE = 19;

const INIT: Record<TP06Cell, number[]> = {
  epi: [-85.23, 0.00621, 0.4712, 0.0095, 0.00172, 0.7444, 0.7045, 3.373e-5, 0.7888, 0.9755, 0.9953, 0.999998, 2.42e-8, 0.000126, 0.9073, 3.64, 0.00036, 8.604, 136.89],
  mid: [-85.423, 0.0165, 0.473, 0.0174, 0.00165, 0.749, 0.6788, 3.288e-5, 0.7026, 0.9526, 0.9942, 0.999998, 2.347e-8, 0.000153, 0.8978, 4.272, 0.00042, 10.132, 138.52],
  endo: [-86.709, 0.00448, 0.476, 0.0087, 0.00155, 0.7573, 0.7225, 3.164e-5, 0.8009, 0.9778, 0.9953, 0.3212, 2.235e-8, 0.000155, 0.9068, 3.715, 0.00036, 10.355, 138.4],
};

export interface Currents {
  iNa: number;
  iCaL: number;
  ito: number;
  iKr: number;
  iKs: number;
  iK1: number;
  iNaCa: number;
  iNaK: number;
}

export class TP06 {
  readonly y = new Float64Array(TP06_NSTATE);
  readonly cell: TP06Cell;
  mods: TP06Mods;
  private gKs0: number;
  private gto0: number;
  readonly cur: Currents = { iNa: 0, iCaL: 0, ito: 0, iKr: 0, iKs: 0, iK1: 0, iNaCa: 0, iNaK: 0 };

  constructor(cell: TP06Cell, mods: TP06Mods = TP06_DEFAULT_MODS) {
    this.cell = cell;
    this.mods = { ...mods };
    this.gKs0 = cell === "mid" ? 0.098 : 0.392;
    this.gto0 = cell === "endo" ? 0.073 : 0.294;
    this.y.set(INIT[cell]);
  }

  /** Advance by dt (ms) with an applied stimulus current iStim (pA/pF, negative = depolarising). */
  step(dt: number, iStim: number): number {
    const y = this.y;
    const md = this.mods;
    const { R: Rg, T, F: Fc } = C;
    const RTF = (Rg * T) / Fc;
    const v = y[V];
    const Nai = y[NAI], Ki = y[KI], Cai = y[CAI], Cass = y[CASS], CaSR = y[CASR];
    const Ko = md.Ko, Nao = md.Nao, Cao = md.Cao;
    const E_Na = RTF * Math.log(Nao / Nai);
    const E_K = RTF * Math.log(Ko / Ki);
    const E_Ks = RTF * Math.log((Nao * C.P_kna + Ko) / (Ki + C.P_kna * Nai));
    const E_Ca = 0.5 * RTF * Math.log(Cao / Cai);
    // IK1
    const aK1 = 0.1 / (1 + 6.14421235333e-6 * Math.exp(-0.06 * E_K + 0.06 * v));
    const bK1 = (3.06060402008 * Math.exp(-0.0002 * E_K + 0.0002 * v) + 0.367879441171 * Math.exp(-0.1 * E_K + 0.1 * v)) / (1 + Math.exp(-0.5 * v + 0.5 * E_K));
    const xK1 = aK1 / (aK1 + bK1);
    const sqKo = Math.sqrt(Ko / 5.4);
    const iK1 = C.g_K1 * md.gK1 * sqKo * (v - E_K) * xK1;
    // IKr
    const iKr = C.g_Kr * md.gKr * sqKo * (v - E_K) * y[XR1] * y[XR2];
    // IKs
    const iKs = this.gKs0 * md.gKs * y[XS] * y[XS] * (v - E_Ks);
    // INa
    const iNa = C.g_Na * md.gNa * y[M] ** 3 * y[H] * y[J] * (v - E_Na);
    const ibNa = C.g_bna * (v - E_Na);
    // ICaL
    const e2 = Math.exp((2 * (v - 15)) / RTF);
    const iCaL = (md.gCaL * C.g_CaL * 4 * (v - 15) * (Fc / RTF) * (0.25 * Cass * e2 - Cao) * y[D] * y[F] * y[F2] * y[FCASS]) / (e2 - 1);
    const ibCa = C.g_bca * (v - E_Ca);
    // Ito
    const ito = this.gto0 * md.gto * y[R] * y[S] * (v - E_K);
    // pumps / exchangers
    const iNaK = (C.P_NaK * Ko * Nai) / ((Ko + C.K_mk) * (Nai + C.K_mNa) * (1 + 0.1245 * Math.exp((-0.1 * v) / RTF) + 0.0353 * Math.exp(-v / RTF)));
    const iNaCa =
      (C.K_NaCa * (Math.exp((C.gamma * v) / RTF) * Nai ** 3 * Cao - Math.exp(((C.gamma - 1) * v) / RTF) * Nao ** 3 * Cai * C.alpha)) /
      ((C.Km_Nai ** 3 + Nao ** 3) * (C.Km_Ca + Cao) * (1 + C.K_sat * Math.exp(((C.gamma - 1) * v) / RTF)));
    const ipCa = (C.g_pCa * Cai) / (Cai + C.K_pCa);
    const ipK = (C.g_pK * (v - E_K)) / (1 + 65.4052157419 * Math.exp(-0.167224080268 * v));
    // calcium handling
    const iup = C.Vmax_up / (1 + (C.K_up * C.K_up) / (Cai * Cai));
    const ileak = C.V_leak * (CaSR - Cai);
    const ixfer = C.V_xfer * (Cass - Cai);
    const kcasr = C.max_sr - (C.max_sr - C.min_sr) / (1 + (C.EC / CaSR) ** 2);
    const k1 = C.k1_prime / kcasr;
    const k2 = C.k2_prime * kcasr;
    const O = (k1 * Cass * Cass * y[RP]) / (C.k3 + k1 * Cass * Cass);
    const irel = C.V_rel * O * (CaSR - Cass);
    const bufc = 1 / (1 + (C.Buf_c * C.K_buf_c) / (Cai + C.K_buf_c) ** 2);
    const bufsr = 1 / (1 + (C.Buf_sr * C.K_buf_sr) / (CaSR + C.K_buf_sr) ** 2);
    const bufss = 1 / (1 + (C.Buf_ss * C.K_buf_ss) / (Cass + C.K_buf_ss) ** 2);

    const iion = iK1 + ito + iKr + iKs + iCaL + iNaK + iNa + ibNa + iNaCa + ibCa + ipK + ipCa;
    const cur = this.cur;
    cur.iNa = iNa;
    cur.iCaL = iCaL;
    cur.ito = ito;
    cur.iKr = iKr;
    cur.iKs = iKs;
    cur.iK1 = iK1;
    cur.iNaCa = iNaCa;
    cur.iNaK = iNaK;

    // concentrations (forward Euler)
    const dCai = bufc * ((-(ibCa + ipCa - 2 * iNaCa) * C.Cm) / (2 * C.V_c * Fc) + (C.V_sr / C.V_c) * (ileak - iup) + ixfer);
    const dCaSR = bufsr * (iup - irel - ileak);
    const dCass = bufss * ((-iCaL * C.Cm) / (2 * C.V_ss * Fc) + (C.V_sr / C.V_ss) * irel - (C.V_c / C.V_ss) * ixfer);
    const dRp = -k2 * Cass * y[RP] + C.k4 * (1 - y[RP]);
    const dNai = (-(iNa + ibNa + 3 * iNaK + 3 * iNaCa) * C.Cm) / (C.V_c * Fc);
    const dKi = (-(iK1 + ito + iKr + iKs - 2 * iNaK + ipK + iStim) * C.Cm) / (C.V_c * Fc);
    y[CAI] += dt * dCai;
    y[CASR] += dt * dCaSR;
    y[CASS] += dt * dCass;
    y[RP] += dt * dRp;
    y[NAI] += dt * dNai;
    y[KI] += dt * dKi;

    // gates (Rush–Larsen)
    const rl = (i: number, inf: number, tau: number) => (y[i] = inf - (inf - y[i]) * Math.exp(-dt / tau));
    {
      const minf = 1 / (1 + Math.exp((-56.86 - v) / 9.03)) ** 2;
      const am = 1 / (1 + Math.exp((-60 - v) / 5));
      const bm = 0.1 / (1 + Math.exp((v + 35) / 5)) + 0.1 / (1 + Math.exp((v - 50) / 200));
      rl(M, minf, am * bm);
      const hinf = 1 / (1 + Math.exp((v + 71.55) / 7.43)) ** 2;
      let ah = 0, bh: number, aj = 0, bj: number;
      if (v < -40) {
        ah = 0.057 * Math.exp(-(v + 80) / 6.8);
        bh = 2.7 * Math.exp(0.079 * v) + 3.1e5 * Math.exp(0.3485 * v);
        aj = ((-2.5428e4 * Math.exp(0.2444 * v) - 6.948e-6 * Math.exp(-0.04391 * v)) * (v + 37.78)) / (1 + Math.exp(0.311 * (v + 79.23)));
        bj = (0.02424 * Math.exp(-0.01052 * v)) / (1 + Math.exp(-0.1378 * (v + 40.14)));
      } else {
        bh = 0.77 / (0.13 * (1 + Math.exp(-(v + 10.66) / 11.1)));
        bj = (0.6 * Math.exp(0.057 * v)) / (1 + Math.exp(-0.1 * (v + 32)));
      }
      rl(H, hinf, 1 / (ah + bh));
      rl(J, hinf, 1 / (aj + bj));
    }
    {
      const xr1inf = 1 / (1 + Math.exp((-26 - v) / 7));
      const axr1 = 450 / (1 + Math.exp((-45 - v) / 10));
      const bxr1 = 6 / (1 + Math.exp((v + 30) / 11.5));
      rl(XR1, xr1inf, axr1 * bxr1);
      const xr2inf = 1 / (1 + Math.exp((v + 88) / 24));
      const axr2 = 3 / (1 + Math.exp((-60 - v) / 20));
      const bxr2 = 1.12 / (1 + Math.exp((v - 60) / 20));
      rl(XR2, xr2inf, axr2 * bxr2);
      const xsinf = 1 / (1 + Math.exp((-5 - v) / 14));
      const axs = 1400 / Math.sqrt(1 + Math.exp((5 - v) / 6));
      const bxs = 1 / (1 + Math.exp((v - 35) / 15));
      rl(XS, xsinf, axs * bxs + 80);
    }
    {
      const dinf = 1 / (1 + Math.exp((-8 - v) / 7.5));
      const ad = 1.4 / (1 + Math.exp((-35 - v) / 13)) + 0.25;
      const bd = 1.4 / (1 + Math.exp((v + 5) / 5));
      const gd = 1 / (1 + Math.exp((50 - v) / 20));
      rl(D, dinf, ad * bd + gd);
      const finf = 1 / (1 + Math.exp((v + 20) / 7));
      const tf = 1102.5 * Math.exp(-((v + 27) ** 2) / 225) + 200 / (1 + Math.exp((13 - v) / 10)) + 180 / (1 + Math.exp((v + 30) / 10)) + 20;
      rl(F, finf, tf);
      const f2inf = 0.67 / (1 + Math.exp((v + 35) / 7)) + 0.33;
      const tf2 = 562 * Math.exp(-((v + 27) ** 2) / 240) + 31 / (1 + Math.exp((25 - v) / 10)) + 80 / (1 + Math.exp((v + 30) / 10));
      rl(F2, f2inf, tf2);
      const fcinf = 0.6 / (1 + (Cass / 0.05) ** 2) + 0.4;
      const tfc = 80 / (1 + (Cass / 0.05) ** 2) + 2;
      rl(FCASS, fcinf, tfc);
    }
    {
      const rinf = 1 / (1 + Math.exp((20 - v) / 6));
      const tr = 9.5 * Math.exp(-((v + 40) ** 2) / 1800) + 0.8;
      rl(R, rinf, tr);
      if (this.cell === "endo") {
        rl(S, 1 / (1 + Math.exp((v + 28) / 5)), 1000 * Math.exp(-((v + 67) ** 2) / 1000) + 8);
      } else {
        rl(S, 1 / (1 + Math.exp((v + 20) / 5)), 85 * Math.exp(-((v + 45) ** 2) / 320) + 5 / (1 + Math.exp((v - 20) / 5)) + 3);
      }
    }
    y[V] = v - dt * (iion + iStim);
    return y[V];
  }
}

export interface PacedResult {
  cell: TP06Cell;
  cl: number;
  /** Last beat, sampled every `sampleDt` ms from the stimulus. */
  v: Float32Array;
  sampleDt: number;
  apd90: number;
  vRest: number;
  vPeak: number;
  dvdtMax: number;
  /** Early afterdepolarisation detected in the last beat (secondary depolarisation during repolarisation). */
  ead: boolean;
  /** 1:1 response (every stimulus elicited an AP) in the last 3 beats. */
  captured: boolean;
  /** Na⁺ availability at rest (h·j) — used for CV scaling. */
  naAvailability: number;
}

/**
 * Pace a single cell at cycle length `cl` for `beats` beats (stimulus −52 pA/pF, 1 ms) and
 * measure the last beat. Default 20 beats reaches approximate (not full) steady state.
 */
export function pace(cell: TP06Cell, mods: TP06Mods, cl = 1000, beats = 20, dt = 0.02, sampleDt = 1): PacedResult {
  const c = new TP06(cell, mods);
  const nPer = Math.round(cl / dt);
  const nStim = Math.round(1 / dt);
  const v = new Float32Array(Math.round(cl / sampleDt));
  const every = Math.round(sampleDt / dt);
  let captured = true;
  let vRest = c.y[0];
  let naAvail = 0;
  for (let b = 0; b < beats; b++) {
    const last = b === beats - 1;
    let peak = -100;
    if (last) {
      vRest = c.y[0];
      naAvail = c.y[H] * c.y[J];
    }
    let dvdtMax = 0;
    for (let k = 0; k < nPer; k++) {
      const v0 = c.y[0];
      const v1 = c.step(dt, k < nStim ? -52 : 0);
      peak = Math.max(peak, v1);
      if (last) {
        dvdtMax = Math.max(dvdtMax, (v1 - v0) / dt);
        if (k % every === 0) v[k / every] = v1;
      }
    }
    if (b >= beats - 3 && peak < 0) captured = false;
    if (last) {
      const vP = Math.max(...v);
      const thr = vP - 0.9 * (vP - vRest);
      let iPk = 0;
      for (let i = 0; i < v.length; i++) if (v[i] === vP) iPk = i;
      let apdEnd = -1;
      for (let i = iPk; i < v.length; i++)
        if (v[i] < thr) {
          apdEnd = i;
          break;
        }
      // EAD: after the plateau started falling, a rise of > 2 mV while V > −60 mV
      let ead = false;
      let vmin = Infinity;
      for (let i = iPk + 20; i < (apdEnd > 0 ? apdEnd : v.length); i++) {
        if (v[i] < vmin) vmin = v[i];
        if (v[i] > vmin + 2 && v[i] > -60 && vmin < 10) {
          ead = true;
          break;
        }
      }
      return { cell, cl, v, sampleDt, apd90: apdEnd > 0 ? apdEnd * sampleDt : NaN, vRest, vPeak: vP, dvdtMax, ead, captured, naAvailability: naAvail };
    }
  }
  throw new Error("unreachable");
}
