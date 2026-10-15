/**
 * Signal-derived ECG measurements (no access to the simulator's internal state).
 *
 * Global fiducials are detected from the simulated 12-lead signals with simple,
 * documented rules (these are algorithm settings, not physiological claims):
 *  - QRS detection: spatial slope D(t) = Σ|dx/dt| over 8 independent leads
 *    (I, II, V1–V6); candidates where D > 30 % of its maximum in the analysed window.
 *  - QRS onset/offset: D falls below 4 % of the beat's peak slope (searching outward).
 *  - P wave: in the 350 ms before QRS onset; spatial magnitude above 5 % of its peak.
 *  - T end: tangent method (steepest descending slope after the T peak extrapolated to
 *    the isoelectric line) in each lead with a T amplitude ≥ 25 % of the largest; the
 *    latest lead-specific T end is taken (global QT).
 *  - Axis: net area of I and aVF combined with the hexaxial (Einthoven) relation.
 * Model "ground truth" (first/last activation, last repolarisation) is reported alongside
 * so that the ECG ↔ activation correspondence can be inspected and validated.
 */
import type { WaveInfo } from "../core/engine";
import { N_CHANNELS } from "./leadField";

export interface BeatMeasurement {
  index: number;
  qrsOn: number;
  qrsOff: number;
  qrsPeak: number;
  pOn: number | null;
  pOff: number | null;
  tPeak: number | null;
  tEnd: number | null;
  rr: number | null;
  hr: number | null;
  pr: number | null;
  qrs: number;
  qt: number | null;
  qtcBazett: number | null;
  qtcFridericia: number | null;
  axisQRS: number;
  axisP: number | null;
  axisT: number | null;
  /** Model-internal timing of the wave that produced this QRS (if matched). */
  truth: {
    waveId: number;
    pOn: number | null;
    qrsOn: number;
    qrsOff: number;
    repolEnd: number;
    hisToV: number | null;
    ah: number | null;
  } | null;
}

const SLOPE_LEADS = [0, 1, 6, 7, 8, 9, 10, 11];

/**
 * @param ecg interleaved channels (N_CHANNELS per sample)
 * @param dt  sample interval (ms)
 * @param i0  absolute sample index of ecg[0]
 * @param waves wave summaries (optional) for ground-truth matching
 */
export function measureBeats(ecg: Float32Array, dt: number, i0: number, waves: WaveInfo[] = []): BeatMeasurement[] {
  const n = Math.floor(ecg.length / N_CHANNELS);
  if (n < 10) return [];
  const x = (s: number, l: number) => ecg[s * N_CHANNELS + l];
  const D = new Float32Array(n);
  const G = new Float32Array(n);
  for (let s = 1; s < n - 1; s++) {
    let d = 0;
    let g = 0;
    for (const l of SLOPE_LEADS) {
      d += Math.abs(x(s + 1, l) - x(s - 1, l)) / (2 * dt);
      g += x(s, l) * x(s, l);
    }
    D[s] = d;
    G[s] = Math.sqrt(g);
  }
  let dMax = 0;
  for (let s = 0; s < n; s++) dMax = Math.max(dMax, D[s]);
  if (dMax <= 1e-6) return [];

  // ---- QRS candidates --------------------------------------------------------------
  const thr = 0.3 * dMax;
  const runs: [number, number][] = [];
  let s = 0;
  while (s < n) {
    if (D[s] > thr) {
      const a = s;
      while (s < n && D[s] > thr) s++;
      const last = runs[runs.length - 1];
      if (last && (a - last[1]) * dt < 80) last[1] = s;
      else runs.push([a, s]);
    } else s++;
  }
  const beats: BeatMeasurement[] = [];
  const toT = (k: number) => (i0 + k) * dt;
  let prevTEndIdx = 0;
  for (const [a, b] of runs) {
    let p = a;
    for (let k = a; k < b; k++) if (D[k] > D[p]) p = k;
    const peak = D[p];
    const lowOn = 0.04 * peak;
    let on = p;
    while (on > 1 && !(D[on] < lowOn && D[on - 1] < lowOn)) on--;
    let off = p;
    while (off < n - 2 && !(D[off] < lowOn && D[off + 1] < lowOn && D[off + 2] < lowOn)) off++;
    // Skip complexes truncated by the window edges
    if (on <= 2 || off >= n - 3) continue;

    // ---- P wave -------------------------------------------------------------------
    let pOn: number | null = null;
    let pOff: number | null = null;
    const pw0 = Math.max(prevTEndIdx + 1, on - Math.round(450 / dt));
    const pw1 = on - Math.round(10 / dt);
    let gP = 0;
    let gPi = -1;
    for (let k = pw0; k < pw1; k++)
      if (G[k] > gP) {
        gP = G[k];
        gPi = k;
      }
    if (gPi > 0 && gP > 0.03) {
      // baseline = minimum magnitude between window start and P peak (removes a T-wave tail)
      let gB = gP;
      for (let k = pw0; k <= gPi; k++) gB = Math.min(gB, G[k]);
      let k = gPi;
      while (k > pw0 && G[k] > gB + 0.05 * (gP - gB)) k--;
      pOn = k;
      // P offset: slope-based (atrial repolarisation keeps G above zero in the PR segment)
      let dP = 0;
      for (let q = pOn; q < pw1; q++) dP = Math.max(dP, D[q]);
      let q = gPi;
      while (q < pw1 && D[q] > 0.08 * dP) q++;
      pOff = q;
    }

    // ---- T wave -----------------------------------------------------------------------
    let tEndIdx: number | null = null;
    let tPeakIdx: number | null = null;
    const tw0 = off + Math.round(60 / dt);
    // T peak is searched up to 500 ms after the J point, and never within 100 ms of the next QRS
    let tw1 = Math.min(n - 2, off + Math.round(500 / dt));
    const nextRun = runs.find((r) => r[0] > b);
    if (nextRun) tw1 = Math.min(tw1, nextRun[0] - Math.round(100 / dt));
    const descentLimit = Math.round(220 / dt);
    if (tw1 - tw0 > 20 / dt) {
      const amps: { l: number; amp: number; pk: number }[] = [];
      for (let l = 0; l < 12; l++) {
        let pk = tw0;
        for (let k = tw0; k < tw1; k++) if (Math.abs(x(k, l)) > Math.abs(x(pk, l))) pk = k;
        amps.push({ l, amp: Math.abs(x(pk, l)), pk });
      }
      const maxAmp = Math.max(...amps.map((a) => a.amp));
      if (maxAmp > 0.03) {
        let latest = -1;
        let pkBest = -1;
        for (const { l, amp, pk } of amps) {
          if (amp < 0.25 * maxAmp) continue;
          const sign = Math.sign(x(pk, l));
          // steepest descent towards baseline after the peak
          let ks = -1;
          let best = 0;
          const kMax = Math.min(n - 2, pk + descentLimit, nextRun ? nextRun[0] - 1 : n - 2);
          for (let k = pk + 1; k < kMax; k++) {
            const sl = (x(k + 1, l) - x(k - 1, l)) / (2 * dt);
            if (-sign * sl > best) {
              best = -sign * sl;
              ks = k;
            }
          }
          if (ks < 0 || best <= 0) continue;
          const slope = (x(ks + 1, l) - x(ks - 1, l)) / (2 * dt);
          const tIntersect = ks * dt - x(ks, l) / slope; // in ms relative to window start
          const idx = Math.round(tIntersect / dt);
          if (idx > latest && idx < pk + descentLimit + 100 / dt) {
            latest = idx;
          }
          if (amp === maxAmp) pkBest = pk;
        }
        if (latest > 0) {
          tEndIdx = latest;
          tPeakIdx = pkBest > 0 ? pkBest : null;
          prevTEndIdx = latest;
        }
      }
    }

    const area = (l: number, k0: number, k1: number) => {
      let sum = 0;
      for (let k = k0; k <= k1; k++) sum += x(k, l);
      return sum * dt;
    };
    const axisOf = (k0: number, k1: number) => {
      const aI = area(0, k0, k1);
      const aF = area(5, k0, k1);
      return (Math.atan2(aF / 1.5, aI / Math.sqrt(3)) * 180) / Math.PI;
    };
    const m: BeatMeasurement = {
      index: beats.length,
      qrsOn: toT(on),
      qrsOff: toT(off),
      qrsPeak: toT(p),
      pOn: pOn !== null ? toT(pOn) : null,
      pOff: pOff !== null ? toT(pOff) : null,
      tPeak: tPeakIdx !== null ? toT(tPeakIdx) : null,
      tEnd: tEndIdx !== null ? toT(tEndIdx) : null,
      rr: null,
      hr: null,
      pr: pOn !== null ? (on - pOn) * dt : null,
      qrs: (off - on) * dt,
      qt: tEndIdx !== null ? (tEndIdx - on) * dt : null,
      qtcBazett: null,
      qtcFridericia: null,
      axisQRS: axisOf(on, off),
      axisP: pOn !== null && pOff !== null && pOff > pOn ? axisOf(pOn, pOff) : null,
      axisT: tEndIdx !== null ? axisOf(off + Math.round(40 / dt), Math.min(n - 1, tEndIdx)) : null,
      truth: null,
    };
    beats.push(m);
  }
  for (let k = 1; k < beats.length; k++) {
    const rr = beats[k].qrsOn - beats[k - 1].qrsOn;
    beats[k].rr = rr;
    beats[k].hr = 60000 / rr;
    if (beats[k].qt !== null) {
      beats[k].qtcBazett = beats[k].qt! / Math.sqrt(rr / 1000);
      beats[k].qtcFridericia = beats[k].qt! / Math.cbrt(rr / 1000);
    }
  }
  // ---- ground truth matching ----------------------------------------------------------
  for (const b of beats) {
    let best: WaveInfo | null = null;
    let bd = Infinity;
    for (const w of waves) {
      if (!Number.isFinite(w.tFirstVent)) continue;
      const d = Math.abs(w.tFirstVent - b.qrsOn);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    if (best && bd < 40) {
      b.truth = {
        waveId: best.id,
        pOn: Number.isFinite(best.tFirstAtrial) ? best.tFirstAtrial : null,
        qrsOn: best.tFirstVent,
        qrsOff: best.tLastVent,
        repolEnd: best.tVentRepolEnd,
        hisToV: Number.isFinite(best.tHisProximal) ? best.tFirstVent - best.tHisProximal : null,
        ah: Number.isFinite(best.tAvnOut) ? best.tAvnOut - best.tAvnIn : null,
      };
    }
  }
  return beats;
}
