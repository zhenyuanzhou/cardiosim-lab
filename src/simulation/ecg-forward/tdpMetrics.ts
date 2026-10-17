/**
 * Quantitative torsades criteria, measured on a simulated ECG, so that the mechanism is compared
 * against the literature instead of judged by eye. Used by tests/physiology/scenarios.test.ts.
 *
 * Targets (see SCIENTIFIC_LIMITATIONS.md for the full argument):
 *   rate        180–250 /min, i.e. CL 240–333 ms          (Marriott 13th ed. ch. 17)
 *   continuity  the deflections are "not characteristic of either QRS complexes or T waves": the
 *               tracing never returns to an isoelectric baseline, so the fraction of the run spent
 *               near baseline must be small (< 15 %)        (Marriott ch. 17; Fig. 17.15)
 *   envelope    amplitude waxes and wanes: ≥ 2 nodes (dips below 50 % of the run maximum) per 5 s,
 *               and a max/min ratio > 3                     (the defining "spindle" appearance)
 *   rotation    the frontal axis sweeps > 180° across the run (points twisting about the baseline)
 *   width       each activation is broad: mean ventricular activation span > 100 ms, so successive
 *               complexes merge into a continuous undulation
 */
import { N_CHANNELS } from "./leadField";
import type { SimOutput } from "../core/engine";

export interface TdpMetrics {
  cl: number;
  rate: number;
  beats: number;
  baselineFraction: number;
  nodes: number;
  nodesPer5s: number;
  envelopeRatio: number;
  axisSpan: number;
  meanSpan: number;
  duration: number;
  /** Local extrema of lead II per beat: real torsades complexes are smooth (≈ 1–3), not fragmented. */
  extremaPerBeat: number;
}

/** Peak-to-peak envelope of lead II over a sliding window, and its minima ("nodes" of the spindle). */
function envelope(ecg: Float32Array, dt: number, i0: number, i1: number, win = 120): { env: number[]; times: number[] } {
  const w = Math.round(win / dt);
  const env: number[] = [];
  const times: number[] = [];
  for (let i = i0; i < i1 - w; i += Math.max(1, Math.round(w / 4))) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = i; k < i + w; k++) {
      const v = ecg[k * N_CHANNELS + 1];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    env.push(hi - lo);
    times.push(i * dt);
  }
  return { env, times };
}

/** End of the captured run: the last activation before a gap longer than `gap` ms. */
export function runWindow(o: SimOutput, t0: number, t1: number, gap = 600): [number, number] {
  const ts = o.waves.filter((w) => Number.isFinite(w.tFirstVent) && w.tFirstVent >= t0 && w.tFirstVent <= t1).map((w) => w.tFirstVent).sort((a, b) => a - b);
  if (ts.length < 2) return [t0, t1];
  let end = ts[0];
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] - end > gap) break;
    end = ts[i];
  }
  return [ts[0], end + 150];
}

export function tdpMetrics(o: SimOutput, dt: number, t0: number, t1: number): TdpMetrics {
  const i0 = Math.round(t0 / dt);
  const i1 = Math.min(Math.round(t1 / dt), Math.floor(o.ecg.length / N_CHANNELS) - 1);

  // ---- beats: ventricular activations of the arrhythmia, merged within 80 ms
  const raw = o.waves.filter((w) => Number.isFinite(w.tFirstVent) && w.tFirstVent >= t0 && w.tFirstVent <= t1).sort((a, b) => a.tFirstVent - b.tFirstVent);
  const beats: { t: number; span: number }[] = [];
  for (const w of raw) {
    const prev = beats[beats.length - 1];
    if (prev && w.tFirstVent - prev.t < 80) prev.span = Math.max(prev.span, w.tLastVent - prev.t);
    else beats.push({ t: w.tFirstVent, span: w.tLastVent - w.tFirstVent });
  }
  const ints = beats.slice(1).map((b, i) => b.t - beats[i].t);
  const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : NaN);
  const cl = med(ints);

  // ---- continuity: "the tracing never returns to the isoelectric line". Judged LOCALLY, in 400 ms
  // windows, because the eye compares a flat stretch with the deflections next to it — a global
  // threshold would score the low-amplitude node of a spindle as flat baseline.
  const lead2 = (i: number) => o.ecg[i * N_CHANNELS + 1];
  const vals: number[] = [];
  for (let i = i0; i < i1; i += 3) vals.push(lead2(i));
  vals.sort((a, b) => a - b);
  const mid = vals[vals.length >> 1];
  let p2p = 0;
  for (let i = i0; i < i1; i++) p2p = Math.max(p2p, Math.abs(lead2(i) - mid));
  p2p *= 2;
  const wLoc = Math.round(400 / dt);
  let quiet = 0;
  let counted = 0;
  for (let i = i0 + 1; i < i1 - 1; i++) {
    const a = Math.max(i0 + 1, i - (wLoc >> 1));
    const b = Math.min(i1 - 1, i + (wLoc >> 1));
    let lo3 = Infinity;
    let hi3 = -Infinity;
    let dLoc = 0;
    for (let k = a; k < b; k += 2) {
      const v = lead2(k);
      if (v < lo3) lo3 = v;
      if (v > hi3) hi3 = v;
      const d = Math.abs(lead2(k + 1) - lead2(k - 1));
      if (d > dLoc) dLoc = d;
    }
    const locP2p = hi3 - lo3;
    const v = lead2(i);
    const d = Math.abs(lead2(i + 1) - lead2(i - 1));
    counted++;
    if (Math.abs(v - mid) < 0.1 * locP2p && d < 0.06 * dLoc) quiet++;
  }
  const dMax = p2p; // retained for the extrema test below

  // ---- envelope nodes
  const trim = Math.round(200 / dt);
  const { env: envRaw } = envelope(o.ecg, dt, i0 + trim, i1 - trim);
  // smooth the envelope before looking for spindle nodes, so that beat-to-beat wobble is not counted
  const sm = Math.max(1, Math.round(400 / (30 * dt)));
  const env = envRaw.map((_, k) => {
    let a = 0;
    let n = 0;
    for (let q = Math.max(0, k - sm); q <= Math.min(envRaw.length - 1, k + sm); q++) {
      a += envRaw[q];
      n++;
    }
    return a / n;
  });
  const envMax = Math.max(...env);
  let nodes = 0;
  for (let k = 1; k < env.length - 1; k++) if (env[k] < 0.5 * envMax && env[k] <= env[k - 1] && env[k] < env[k + 1]) nodes++;
  const envMin = Math.min(...env.filter((x) => x > 0));

  // ---- frontal axis per beat, from the heart vector at the peak of each activation
  const axes: number[] = [];
  for (const b of beats) {
    let best = -1;
    let ax = 0;
    for (let t = b.t; t < b.t + Math.max(60, b.span); t += dt) {
      const i = Math.round(t / dt) * N_CHANNELS;
      const mag = Math.hypot(o.ecg[i + 12], o.ecg[i + 13]);
      if (mag > best) {
        best = mag;
        ax = (Math.atan2(o.ecg[i + 13], o.ecg[i + 12]) * 180) / Math.PI;
      }
    }
    axes.push(ax);
  }
  // cumulative unwrapped sweep
  let span = 0;
  let lo = 0;
  let hi = 0;
  let cum = 0;
  for (let k = 1; k < axes.length; k++) {
    let d = axes[k] - axes[k - 1];
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    cum += d;
    lo = Math.min(lo, cum);
    hi = Math.max(hi, cum);
  }
  span = hi - lo;

  return {
    cl,
    rate: 60000 / cl,
    beats: beats.length,
    baselineFraction: quiet / Math.max(1, counted),
    nodes,
    nodesPer5s: (nodes * 5000) / Math.max(1, t1 - t0),
    envelopeRatio: envMax / Math.max(1e-6, envMin),
    axisSpan: span,
    meanSpan: beats.reduce((a, b) => a + b.span, 0) / Math.max(1, beats.length),
    extremaPerBeat: (() => {
      let n = 0;
      for (let i = i0 + 1; i < i1 - 1; i++) {
        const a = o.ecg[(i - 1) * N_CHANNELS + 1];
        const b = o.ecg[i * N_CHANNELS + 1];
        const c = o.ecg[(i + 1) * N_CHANNELS + 1];
        if ((b - a) * (c - b) < 0 && Math.abs(b - mid) > 0.1 * dMax) n++;
      }
      return n / Math.max(1, beats.length);
    })(),
    duration: beats.length ? beats[beats.length - 1].t - beats[0].t : 0,
  };
}

export function formatMetrics(m: TdpMetrics): string {
  const ok = (b: boolean) => (b ? "ok " : "NO ");
  return (
    `CL ${m.cl.toFixed(0)} ms (${m.rate.toFixed(0)}/min) ${ok(m.rate >= 180 && m.rate <= 250)}| ` +
    `baseline ${(100 * m.baselineFraction).toFixed(0)} % ${ok(m.baselineFraction < 0.15)}| ` +
    `nodes/5s ${m.nodesPer5s.toFixed(1)} ${ok(m.nodesPer5s >= 1 && m.nodesPer5s <= 5)}| ` +
    `env ratio ${m.envelopeRatio.toFixed(1)} ${ok(m.envelopeRatio > 3)}| ` +
    `axis sweep ${m.axisSpan.toFixed(0)}° ${ok(m.axisSpan > 180)}| ` +
    `span ${m.meanSpan.toFixed(0)} ms ${ok(m.meanSpan > 100)}| extrema/beat ${m.extremaPerBeat.toFixed(1)} ${ok(m.extremaPerBeat <= 3)}| beats ${m.beats}`
  );
}
