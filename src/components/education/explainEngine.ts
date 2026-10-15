/**
 * Explanation engine: turns a parameter change into a mechanistic explanation that is
 * tied to the ACTUAL model output (measured before vs after the change), plus warnings
 * for non-physiological parameter combinations.
 */
import { META_BY_PATH, PARAM_META, getParam, type SimParams } from "../../simulation/core/params";
import { deriveAutonomic } from "../../simulation/core/derive";
import type { CardiacModel } from "../../simulation/core/model";
import type { BeatMeasurement } from "../../simulation/ecg-forward/measurements";
import type { WaveInfo } from "../../simulation/core/engine";

export interface ParamChange {
  id: number;
  path: string;
  from: number | boolean | string;
  to: number | boolean | string;
  at: number; // simulation time the change took effect
}

export interface Effect {
  label: string;
  before: number;
  after: number;
  unit: string;
  source: "ECG" | "model";
}

export interface Explanation {
  change: ParamChange;
  title: string;
  structure: string;
  mechanism: string;
  prediction: string;
  limitations: string;
  evidence: string;
  /** Measured consequences (null until enough beats after the change have been simulated). */
  effects: Effect[] | null;
  pendingBeats: number;
}

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

function summarise(beats: BeatMeasurement[], waves: Map<number, WaveInfo>) {
  const w = beats.map((b) => (b.truth ? waves.get(b.truth.waveId) : undefined));
  return {
    rr: avg(beats.map((b) => b.rr)),
    pr: avg(beats.map((b) => b.pr)),
    qrs: avg(beats.map((b) => b.qrs)),
    qt: avg(beats.map((b) => b.qt)),
    qtc: avg(beats.map((b) => b.qtcBazett)),
    axis: avg(beats.map((b) => b.axisQRS)),
    ah: avg(w.map((x) => (x && Number.isFinite(x.tAvnOut) ? x.tAvnOut - x.tAvnIn : null))),
    hv: avg(w.map((x) => (x && Number.isFinite(x.tHisProximal) ? x.tFirstVent - x.tHisProximal : null))),
    atrialAct: avg(w.map((x) => (x && Number.isFinite(x.tLastAtrial) ? x.tLastAtrial - x.tFirstAtrial : null))),
    ventAct: avg(w.map((x) => (x && Number.isFinite(x.tLastVent) ? x.tLastVent - x.tFirstVent : null))),
    repol: avg(w.map((x) => (x && Number.isFinite(x.tVentRepolEnd) ? x.tVentRepolEnd - x.tFirstVent : null))),
  };
}

export function explain(change: ParamChange, beats: BeatMeasurement[], waves: Map<number, WaveInfo>): Explanation {
  const meta = META_BY_PATH[change.path];
  const before = beats.filter((b) => b.qrsOn < change.at - 50 && b.tEnd !== null && b.tEnd < change.at).slice(-3);
  // skip the first beat after the change (transition), use up to 3 subsequent complete beats
  const afterAll = beats.filter((b) => b.qrsOn > change.at + 50 && b.tEnd !== null);
  const after = afterAll.slice(1, 4);
  let effects: Effect[] | null = null;
  if (before.length > 0 && after.length > 0) {
    const a = summarise(before, waves);
    const b = summarise(after, waves);
    const rows: [string, keyof typeof a, string, "ECG" | "model"][] = [
      ["RR interval", "rr", "ms", "ECG"],
      ["PR interval", "pr", "ms", "ECG"],
      ["QRS duration", "qrs", "ms", "ECG"],
      ["QT interval", "qt", "ms", "ECG"],
      ["QTc (Bazett)", "qtc", "ms", "ECG"],
      ["Frontal QRS axis", "axis", "°", "ECG"],
      ["AV nodal conduction (AH)", "ah", "ms", "model"],
      ["His → first ventricular activation (HV)", "hv", "ms", "model"],
      ["Total atrial activation time", "atrialAct", "ms", "model"],
      ["Total ventricular activation time", "ventAct", "ms", "model"],
      ["First activation → last repolarisation", "repol", "ms", "model"],
    ];
    effects = [];
    for (const [label, key, unit, source] of rows) {
      const x = a[key];
      const y = b[key];
      if (x === null || y === null) continue;
      const tol = unit === "°" ? 4 : 2.5;
      if (Math.abs(y - x) >= tol) effects.push({ label, before: x, after: y, unit, source });
    }
  }
  const fmt = (v: number | boolean | string) => (typeof v === "boolean" ? (v ? "on" : "off") : typeof v === "string" ? v : `${+v.toFixed(3)}`);
  return {
    change,
    title: meta ? `${meta.label}: ${fmt(change.from)} → ${fmt(change.to)} ${meta.unit}` : `${change.path}: ${fmt(change.from)} → ${fmt(change.to)}`,
    structure: meta?.structure ?? "",
    mechanism: meta?.mechanism ?? "",
    prediction: meta?.prediction ?? "",
    limitations:
      meta?.evidence === "nominal"
        ? "Parameter value is nominal (not fitted to data); interpret direction of change, not magnitude."
        : meta?.evidence === "calibrated"
          ? "Default calibrated to an emergent quantity; other values are extrapolation within the reduced-order model."
          : "Default anchored to published human data; the model is still reduced-order.",
    evidence: meta?.source ?? "",
    effects,
    pendingBeats: Math.max(0, 2 - afterAll.length),
  };
}

export interface Warning {
  level: "info" | "warn";
  text: string;
}

/** Warnings for out-of-range or non-physiological parameter combinations. */
export function paramWarnings(_model: CardiacModel | null, p: SimParams): Warning[] {
  const out: Warning[] = [];
  for (const m of PARAM_META) {
    if (!m.physiologic) continue;
    const v = getParam(p, m.path) as number;
    if (v < m.physiologic[0] || v > m.physiologic[1])
      out.push({ level: "warn", text: `${m.label} = ${v} ${m.unit} is outside the usual adult range (${m.physiologic[0]}–${m.physiologic[1]} ${m.unit}).` });
  }
  {
    const d = deriveAutonomic(p);
    const cl = d.sinusCycle;
    if (d.avn.erp + d.avn.ahMin > cl)
      out.push({ level: "warn", text: `AV nodal ERP + AH (${(d.avn.erp + d.avn.ahMin).toFixed(0)} ms) exceeds the sinus cycle (${cl.toFixed(0)} ms): some atrial impulses will not conduct.` });
    const vApd = p.ventricles.apd;
    if (vApd > 0.6 * cl) out.push({ level: "info", text: `Ventricular APD is a large fraction of the cycle length (${((vApd / cl) * 100).toFixed(0)} %); T and next P may overlap.` });
    if (d.sinusRateBpm > 180) out.push({ level: "warn", text: `Effective sinus rate ${d.sinusRateBpm.toFixed(0)} bpm exceeds typical maximal sinus rates.` });
    if (d.sinusRateBpm < 35) out.push({ level: "warn", text: `Effective sinus rate ${d.sinusRateBpm.toFixed(0)} bpm is extremely low; escape rhythms may take over.` });
  }
  if (p.ventricles.anisotropyRatio > 4) out.push({ level: "info", text: "Anisotropy ratio > 4 is high for healthy ventricular myocardium." });
  if (p.sinus.vagalTone > 0.8 && p.sinus.sympatheticTone > 0.8)
    out.push({ level: "info", text: "Simultaneous high vagal and sympathetic tone: effects are combined multiplicatively (no interaction model)." });
  return out;
}
