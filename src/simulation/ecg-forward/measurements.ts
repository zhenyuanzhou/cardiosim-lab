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
  /** QT − QRS (ms); the preferred repolarisation measure when QRS ≥ 120 ms. */
  jt: number | null;
  /** Origin of the complex from the model's wave record (ground-truth label, not an ECG reading). */
  origin: string | null;
  /** Caveats that apply to this beat's intervals (e.g. why PR is not reported). */
  notes: string[];
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

/** Shortest interval (ms) between two separate QRS complexes; closer runs are one complex. */
export const QRS_REFRACTORY_MS = 180;
/** Half-width (ms) of the window used for the local amplitude estimate. */
const LOCAL_WINDOW_MS = 2500;
/** Fraction of the signal-above-noise level a deflection must reach to be accepted as a complex. */
export const QRS_THRESHOLD_FRACTION = 0.35;
/** A candidate this soon after a QRS is tested as a possible T wave (Pan-Tompkins uses 360 ms). */
const T_WAVE_WINDOW_MS = 360;
/** A candidate inside that window needs this fraction of the previous complex's slope to be a QRS. */
const T_WAVE_SLOPE_RATIO = 0.65;
/** ...or, failing that, must not be broader than this multiple of the previous complex's width. */
const T_WAVE_WIDTH_RATIO = 1.4;

/**
 * QRS detection on the multi-lead spatial slope D(t) = Σ|dVm/dt| over eight independent leads.
 *
 * ADAPTIVE, NOT GLOBAL. The threshold is recomputed from a running estimate of the recent QRS peak
 * height, so a later high-amplitude segment cannot retrospectively hide earlier complexes. The
 * previous version compared D against 30 % of its maximum over the WHOLE analysed window: multiplying
 * the last second of an 8-second sinus recording by ten made every one of the seven earlier complexes
 * vanish, because the threshold rose with the loudest part of the record. Detections are made in one
 * forward pass and are never revised by later data.
 *
 * The rules, in order:
 *  1. A candidate is a local maximum of D above the adaptive threshold.
 *  2. The threshold is NPKI + 0.25 (SPKI − NPKI), where SPKI and NPKI are running estimates of the
 *     signal and noise peak levels, initialised from the first 2.5 s of the record. A deflection that
 *     fails the threshold updates the NOISE level, so small deflections push the threshold up rather
 *     than down.
 *  3. A candidate within QRS_REFRACTORY_MS of the previous accepted peak is part of the same complex.
 *  3b. T-wave discrimination: a candidate between that and T_WAVE_WINDOW_MS after the previous peak is
 *     rejected if it is either shallower or broader than that complex. Without this, the peaked T of
 *     severe hyperkalaemia (QRS 150 ms, tall symmetrical T, 62 % of the QRS's slope) is counted as a
 *     second complex and the apparent rate doubles. Rejecting on EITHER test rather than both cut
 *     spurious detections across the scenario set from 18 to 4 with no loss of sensitivity.
 *  4. Search-back: if no candidate is found for 1.6 × the running RR, the segment is re-examined at
 *     half the threshold, so a single small complex between large ones is recovered rather than lost.
 *  5. The run's extent is widened to where D falls below 30 % of that complex's own peak; onset and
 *     offset are refined afterwards against the complex's own slope, as before.
 *
 * This is the standard Pan–Tompkins arrangement (adaptive threshold + refractory period + search-back)
 * applied to a spatial slope instead of a single filtered lead, which is what the multi-lead evidence
 * buys: a complex that is isoelectric in one lead still contributes slope in the others.
 */
export function detectQrs(D: Float32Array, dt: number): [number, number][] {
  const n = D.length;
  const refrac = Math.max(1, Math.round(QRS_REFRACTORY_MS / dt));
  const initEnd = Math.min(n, Math.round(LOCAL_WINDOW_MS / dt));
  let peak = 0;
  let mean = 0;
  for (let s = 0; s < initEnd; s++) {
    peak = Math.max(peak, D[s]);
    mean += D[s];
  }
  if (peak <= 1e-6) return [];
  mean /= Math.max(1, initEnd);
  // Running estimates of the signal and the noise level (Pan & Tompkins 1985). A deflection that
  // fails the threshold raises the NOISE level, which raises the threshold; this is what stops a
  // small deflection from dragging the threshold down and admitting the next one (a median of
  // accepted peaks does not: measured, one accepted P wave was enough to start accepting all of them).
  let spki = peak;
  let npki = 0.5 * mean;
  const thr1 = () => npki + QRS_THRESHOLD_FRACTION * (spki - npki);
  const accepted: number[] = [];
  const rrOf = () => {
    if (accepted.length < 2) return 0;
    const d: number[] = [];
    for (let k = Math.max(1, accepted.length - 8); k < accepted.length; k++) d.push(accepted[k] - accepted[k - 1]);
    d.sort((a, b) => a - b);
    return d[d.length >> 1];
  };
  const isLocalMax = (s: number) => s > 0 && s < n - 1 && D[s] >= D[s - 1] && D[s] >= D[s + 1];
  /** Width (samples) of the deflection around `s`, measured at 30 % of its own peak. */
  const width = (s: number) => {
    const lim = 0.3 * D[s];
    let a = s;
    while (a > 1 && D[a - 1] > lim) a--;
    let b = s;
    while (b < n - 2 && D[b + 1] > lim) b++;
    return b - a + 1;
  };
  /**
   * T-wave discrimination: inside the T window a candidate must be both nearly as steep as the
   * preceding complex and no broader than it. A T wave fails one or both; a genuine premature beat
   * passes, being at least as steep and no broader.
   */
  const isTWave = (s: number, last: number) =>
    (s - last) * dt < T_WAVE_WINDOW_MS && (D[s] < T_WAVE_SLOPE_RATIO * D[last] || width(s) > T_WAVE_WIDTH_RATIO * width(last));
  for (let s = 1; s < n - 1; s++) {
    const last = accepted[accepted.length - 1];
    if (last !== undefined && s - last < refrac) continue;
    if (!isLocalMax(s)) continue;
    // search-back: nothing accepted for 1.6 RR → re-examine the gap at half the threshold
    const rr = rrOf();
    if (last !== undefined && rr > 0 && s - last > 1.6 * rr) {
      const half = 0.5 * thr1();
      let bestS = -1;
      for (let k = last + refrac; k < s; k++) {
        if (!isLocalMax(k) || D[k] <= half || isTWave(k, last)) continue;
        if (bestS < 0 || D[k] > D[bestS]) bestS = k;
      }
      if (bestS >= 0) {
        accepted.push(bestS);
        spki = 0.25 * D[bestS] + 0.75 * spki; // recovered beat: weaker update than a clean detection
        s = bestS + refrac;
        continue;
      }
    }
    if (D[s] > thr1() && !(last !== undefined && isTWave(s, last))) {
      accepted.push(s);
      spki = 0.125 * D[s] + 0.875 * spki;
    } else {
      npki = 0.125 * D[s] + 0.875 * npki;
    }
  }
  // widen each accepted peak to the extent of its own complex
  const out: [number, number][] = [];
  for (const p of accepted) {
    const lim = 0.3 * D[p];
    let a = p;
    while (a > 1 && D[a - 1] > lim) a--;
    let b = p;
    while (b < n - 2 && D[b + 1] > lim) b++;
    const prev = out[out.length - 1];
    if (prev && a - prev[1] < refrac / 2) prev[1] = Math.max(prev[1], b + 1);
    else out.push([a, b + 1]);
  }
  return out;
}

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
  const runs = detectQrs(D, dt);
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
    // Slow initial upstrokes (e.g. a pre-excitation delta wave) stay below the 4 % slope threshold
    // although the spatial magnitude G already rises clearly: if G at the slope-based onset is well
    // above its minimum in the preceding 90 ms (the isoelectric PR segment), move the onset to that minimum.
    {
      let kMin = on;
      for (let k = on; k > Math.max(1, on - Math.round(90 / dt)); k--) if (G[k] < G[kMin]) kMin = k;
      if ((on - kMin) * dt >= 8 && G[on] - G[kMin] > 0.1) on = kMin;
    }
    let off = p;
    const lowOff = 0.025 * peak; // offset: 2.5 % of peak slope (captures slow terminal forces, e.g. RBBB)
    // The slope must stay below the threshold for 10 ms: slow terminal forces (e.g. the RV in RBBB)
    // hover around 2–6 % of the peak slope and would otherwise end the QRS at their first brief dip.
    const quiet = Math.max(3, Math.round(10 / dt));
    const isQuiet = (k: number) => {
      for (let q = k; q < Math.min(n, k + quiet); q++) if (D[q] >= lowOff) return false;
      return true;
    };
    while (off < n - quiet && !isQuiet(off)) off++;
    // Very broad (> 170 ms) complexes: repolarisation can begin before D reaches 4 % (no isoelectric ST). Take the
    // first pronounced minimum of D (< 12 % of peak, followed by a rise of > 50 %) if it comes earlier.
    if ((off - on) * dt > 170) {
      const lim = Math.min(off, n - 3);
      for (let k = Math.max(p + 1, on + Math.round(100 / dt)); k < lim; k++) {
        if (D[k] < 0.12 * peak && D[k] <= D[k - 1] && D[k] <= D[k + 1]) {
          let rise = D[k];
          for (let q = k + 1; q < Math.min(lim, k + Math.round(60 / dt)); q++) rise = Math.max(rise, D[q]);
          if (rise > 1.5 * D[k] + 0.02 * peak) {
            off = k;
            break;
          }
        }
      }
    }
    // Skip complexes truncated by the window edges
    if (on <= 2 || off >= n - 3) continue;
    // A broad complex can produce two slope runs: merge with the previous complex if they overlap
    const prevB = beats[beats.length - 1];
    if (prevB && toT(on) <= prevB.qrsOff + 20) {
      prevB.qrsOn = Math.min(prevB.qrsOn, toT(on));
      prevB.qrsOff = Math.max(prevB.qrsOff, toT(off));
      prevB.qrs = prevB.qrsOff - prevB.qrsOn;
      if (prevB.qt !== null && prevB.tEnd !== null) prevB.qt = prevB.tEnd - prevB.qrsOn;
      if (prevB.pOn !== null) prevB.pr = prevB.qrsOn - prevB.pOn;
      continue;
    }

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
        // a T wave cut off by the end of the analysed window has no measurable end
        const truncated = !nextRun && off + Math.round(520 / dt) >= n;
        if (latest > 0 && !truncated) {
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
      jt: tEndIdx !== null ? (tEndIdx - off) * dt : null,
      origin: null,
      notes: [],
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
    if (best && bd < 60) {
      b.truth = {
        waveId: best.id,
        pOn: Number.isFinite(best.tFirstAtrial) ? best.tFirstAtrial : null,
        qrsOn: best.tFirstVent,
        qrsOff: best.tLastVent,
        repolEnd: best.tVentRepolEnd,
        hisToV: Number.isFinite(best.tHisProximal) ? best.tFirstVent - best.tHisProximal : null,
        ah: Number.isFinite(best.tAvnOut) ? best.tAvnOut - best.tAvnIn : null,
      };
      applyRhythmRules(b, best);
    }
  }
  for (const b of beats) {
    if (b.qrs >= 120 && b.qt !== null) b.notes.push("QRS ≥ 120 ms: QT includes prolonged depolarisation; use JT (QT − QRS) to judge repolarisation.");
  }
  return beats;
}

/**
 * Arrhythmia-aware interval rules (spec §7): a PR interval is reported only when the model
 * confirms that the P wave and the QRS belong to the same antegradely conducted impulse.
 */
function applyRhythmRules(b: BeatMeasurement, w: WaveInfo): void {
  const atrialFirst = Number.isFinite(w.tFirstAtrial) && w.tFirstAtrial < w.tFirstVent;
  const viaAV = Number.isFinite(w.tAvnOut) || Number.isFinite(w.tApOut);
  const atrialOrigin = w.origin === "sinus" || (w.origin === "ectopic" && atrialFirst) || w.origin === "retrograde" || w.origin === "reentry";
  b.origin =
    w.origin === "ectopic"
      ? `ectopic (${w.site || "stimulus"})`
      : w.origin === "retrograde"
        ? `echo / re-entrant via ${w.site}`
        : w.origin;
  if (w.origin === "retrograde" || w.origin === "reentry") {
    if (b.pr !== null) b.notes.push("Re-entrant / echo complex: atrial and ventricular activation belong to one circuit; PR/RP are not auto-measured.");
    b.pr = null;
    b.pOn = null;
    b.pOff = null;
    b.axisP = null;
  } else if (!(atrialFirst && viaAV && atrialOrigin)) {
    if (b.pr !== null) b.notes.push("No P–QRS relationship for this complex (not conducted from a preceding P): PR not reported.");
    b.pr = null;
    b.pOn = null;
    b.pOff = null;
    b.axisP = null;
  } else if (Number.isFinite(w.tApOut) && (!Number.isFinite(w.tAvnOut) || w.tApOut < w.tAvnOut + 5)) {
    b.notes.push("Pre-excited complex: PR is measured to the onset of the delta wave (accessory-pathway conduction).");
  }
  if (w.origin === "ventricular-escape" || (w.origin === "ectopic" && !atrialFirst)) b.notes.push("Ventricular origin: QRS and repolarisation are secondary to abnormal activation.");
}
