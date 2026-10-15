/**
 * Rhythm-level (multi-beat) analysis, used where single-beat intervals are not meaningful
 * (spec §7: no single RR in AF, no PR without a P–QRS relation, flutter-wave rate).
 *
 * Atrial activity is read from the model's activation records at several atrial sites (the
 * surface ECG alone cannot separate f waves from QRS/T in this reduced-order model); ventricular
 * RR intervals come from the ECG-detected QRS onsets.
 */
export interface RhythmSummary {
  /** Median atrial cycle length (ms) across the sampled atrial sites, NaN if < 3 intervals. */
  atrialCL: number;
  atrialRate: number;
  /** Coefficient of variation of atrial intervals (pooled). */
  atrialCV: number;
  rrMean: number;
  rrCV: number;
  ventRate: number;
  /** Atrial : ventricular rate ratio. */
  conduction: number;
  kind: "sinus-range" | "regular-atrial-tachyarrhythmia" | "fibrillatory" | "unknown";
  label: string;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const cv = (xs: number[]) => {
  if (xs.length < 2) return NaN;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
  return Math.sqrt(v) / m;
};

/**
 * @param atrialTimes activation times per sampled atrial site (ms)
 * @param qrsOnsets   ECG-detected QRS onsets (ms) in the analysis window
 */
export function summariseRhythm(atrialTimes: number[][], qrsOnsets: number[]): RhythmSummary {
  const ints: number[] = [];
  const perSite: number[] = [];
  for (const ts of atrialTimes) {
    const iv = ts.slice(1).map((t, i) => t - ts[i]).filter((x) => x > 30);
    if (iv.length) perSite.push(median(iv));
    ints.push(...iv);
  }
  const atrialCL = perSite.length && ints.length >= 3 ? median(perSite) : NaN;
  const rr = qrsOnsets.slice(1).map((t, i) => t - qrsOnsets[i]);
  const rrMean = rr.length ? rr.reduce((a, b) => a + b, 0) / rr.length : NaN;
  const out: RhythmSummary = {
    atrialCL,
    atrialRate: 60000 / atrialCL,
    atrialCV: cv(ints),
    rrMean,
    rrCV: cv(rr),
    ventRate: 60000 / rrMean,
    conduction: rrMean / atrialCL,
    kind: "unknown",
    label: "",
  };
  // Classification thresholds are display rules of this app (atrial CL < 250 ms ≈ rate > 240/min),
  // not diagnostic criteria.
  if (!Number.isFinite(atrialCL)) out.label = "Atrial activity not determined";
  else if (atrialCL >= 250) {
    out.kind = "sinus-range";
    out.label = "";
  } else if (out.atrialCV < 0.06) {
    out.kind = "regular-atrial-tachyarrhythmia";
    out.label = `Regular atrial activity at ${Math.round(out.atrialRate)}/min (CL ${Math.round(atrialCL)} ms) — flutter-wave rate; ventricular response ≈ ${Number.isFinite(out.conduction) ? `${out.conduction.toFixed(1)}:1` : "—"}. PR is not defined.`;
  } else {
    out.kind = "fibrillatory";
    out.label = `Irregular, rapid atrial activity (median CL ${Math.round(atrialCL)} ms, CV ${(out.atrialCV * 100).toFixed(0)} %); ventricular response irregular (RR CV ${Number.isFinite(out.rrCV) ? (out.rrCV * 100).toFixed(0) : "—"} %), mean ${Number.isFinite(out.ventRate) ? Math.round(out.ventRate) : "—"}/min. A single RR or PR is not meaningful.`;
  }
  return out;
}
