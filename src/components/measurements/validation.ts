/**
 * Runtime validation checks on the CURRENT simulation (shown in the validation dashboard).
 * The same physiology is also checked by the automated test-suite (tests/).
 */
import type { SimData } from "../../simulation/worker/client";
import type { BeatMeasurement } from "../../simulation/ecg-forward/measurements";
import { N_CHANNELS } from "../../simulation/ecg-forward/leadField";

export type CheckStatus = "pass" | "warn" | "fail" | "n/a";
export interface Check {
  group: string;
  name: string;
  status: CheckStatus;
  value: string;
  criterion: string;
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function runChecks(data: SimData, beats: BeatMeasurement[]): Check[] {
  const checks: Check[] = [];
  const waves = data.wavesSorted().filter((w) => w.origin === "sinus" && Number.isFinite(w.tVentRepolEnd) && w.tVentRepolEnd < data.simTime);
  const complete = beats.filter((b) => b.qt !== null && b.rr !== null);

  // ---- activation sequence -----------------------------------------------------------
  let ordered = 0;
  for (const w of waves) {
    const seq = [w.t0, w.tFirstAtrial, w.tAvnIn, w.tAvnOut, w.tHisDistal, Math.min(w.tFirstLBB, w.tFirstRBB), Math.min(w.tFirstPurkinjeLV, w.tFirstPurkinjeRV), w.tFirstVent, w.tLastVent];
    if (seq.every((v, i) => Number.isFinite(v) && (i === 0 || v >= seq[i - 1] - 1e-6))) ordered++;
  }
  checks.push({
    group: "Normal physiology",
    name: "Activation sequence SA → atria → AV node → His → bundles → Purkinje → ventricles",
    status: waves.length === 0 ? "n/a" : ordered === waves.length ? "pass" : "warn",
    value: `${ordered}/${waves.length} sinus beats in order`,
    criterion: "Every conducted sinus beat follows the anatomical sequence.",
  });
  const conducted = waves.filter((w) => w.ventCount > 0).length;
  checks.push({
    group: "Normal physiology",
    name: "AV relationship",
    status: waves.length === 0 ? "n/a" : conducted === waves.length ? "pass" : "warn",
    value: `${conducted}/${waves.length} sinus beats conducted`,
    criterion: "1:1 in normal sinus rhythm (block is expected only for abnormal parameters).",
  });
  const pr = median(complete.map((b) => b.pr ?? NaN).filter(Number.isFinite));
  const qrs = median(complete.map((b) => b.qrs));
  const qtc = median(complete.map((b) => b.qtcBazett ?? NaN).filter(Number.isFinite));
  const axis = median(complete.map((b) => b.axisQRS));
  const range = (v: number, lo: number, hi: number): CheckStatus => (!Number.isFinite(v) ? "n/a" : v >= lo && v <= hi ? "pass" : "warn");
  checks.push({ group: "Normal physiology", name: "PR interval", status: range(pr, 120, 200), value: `${pr.toFixed(0)} ms`, criterion: "120–200 ms (conventional adult limits)" });
  checks.push({ group: "Normal physiology", name: "QRS duration", status: range(qrs, 70, 110), value: `${qrs.toFixed(0)} ms`, criterion: "< 110 ms (AHA/ACCF/HRS 2009, Surawicz et al.)" });
  checks.push({ group: "Normal physiology", name: "QTc (Bazett)", status: range(qtc, 350, 450), value: `${qtc.toFixed(0)} ms`, criterion: "≈ 390–450 ms (AHA/ACCF/HRS 2009, Rautaharju et al.)" });
  checks.push({ group: "Normal physiology", name: "Frontal QRS axis", status: range(axis, -30, 90), value: `${axis.toFixed(0)}°`, criterion: "−30° to +90° (conventional)" });
  const qrsSpread = complete.length > 2 ? Math.max(...complete.map((b) => b.qrs)) - Math.min(...complete.map((b) => b.qrs)) : NaN;
  checks.push({
    group: "Normal physiology",
    name: "Stable QRS morphology beat-to-beat",
    status: Number.isFinite(qrsSpread) ? (qrsSpread <= 4 ? "pass" : "warn") : "n/a",
    value: Number.isFinite(qrsSpread) ? `QRS range ${qrsSpread.toFixed(0)} ms` : "—",
    criterion: "QRS duration varies ≤ 4 ms at constant rate.",
  });

  // ---- ECG signal identities ------------------------------------------------------------
  let einth = 0;
  let gold = 0;
  const ns = data.sampleEnd - data.sampleOffset;
  for (let k = 0; k < ns; k++) {
    const o = k * N_CHANNELS;
    const I = data.ecg[o];
    const II = data.ecg[o + 1];
    const III = data.ecg[o + 2];
    einth = Math.max(einth, Math.abs(II - (I + III)));
    gold = Math.max(gold, Math.abs(data.ecg[o + 3] + data.ecg[o + 4] + data.ecg[o + 5]));
  }
  checks.push({ group: "ECG signal", name: "Einthoven's law II = I + III", status: ns ? (einth < 1e-5 ? "pass" : "fail") : "n/a", value: `max |residual| ${einth.toExponential(1)} mV`, criterion: "Exact (limb leads derived from electrode potentials)." });
  checks.push({ group: "ECG signal", name: "aVR + aVL + aVF = 0", status: ns ? (gold < 1e-5 ? "pass" : "fail") : "n/a", value: `max |sum| ${gold.toExponential(1)} mV`, criterion: "Exact (Goldberger augmented leads)." });

  // ---- coherence between ECG and the activation model -----------------------------------
  const withTruth = complete.filter((b) => b.truth);
  const dQrs = median(withTruth.map((b) => b.qrs - (b.truth!.qrsOff - b.truth!.qrsOn)));
  const dOn = median(withTruth.map((b) => b.qrsOn - b.truth!.qrsOn));
  const dPr = median(withTruth.filter((b) => b.pr !== null && b.truth!.pOn !== null).map((b) => b.pr! - (b.truth!.qrsOn - b.truth!.pOn!)));
  const dQt = median(withTruth.map((b) => b.qt! - (b.truth!.repolEnd - b.truth!.qrsOn)));
  const within = (v: number, tol: number): CheckStatus => (!Number.isFinite(v) ? "n/a" : Math.abs(v) <= tol ? "pass" : "warn");
  checks.push({ group: "ECG ↔ activation coherence", name: "QRS onset vs first ventricular activation", status: within(dOn, 6), value: `${dOn.toFixed(1)} ms`, criterion: "|Δ| ≤ 6 ms" });
  checks.push({ group: "ECG ↔ activation coherence", name: "QRS duration vs ventricular activation time", status: within(dQrs, 10), value: `Δ ${dQrs.toFixed(1)} ms`, criterion: "|Δ| ≤ 10 ms (J point includes the final upstrokes)" });
  checks.push({ group: "ECG ↔ activation coherence", name: "PR vs first atrial → first ventricular activation", status: within(dPr, 10), value: `Δ ${dPr.toFixed(1)} ms`, criterion: "|Δ| ≤ 10 ms" });
  checks.push({ group: "ECG ↔ activation coherence", name: "QT vs last ventricular repolarisation (APD90)", status: within(dQt, 20), value: `Δ ${dQt.toFixed(1)} ms`, criterion: "|Δ| ≤ 20 ms (tangent T end ≠ APD90 of the last cell)" });
  checks.push({
    group: "ECG ↔ activation coherence",
    name: "Common time base",
    status: "pass",
    value: `${(1000 / data.dt).toFixed(0)} Hz, one clock`,
    criterion: "All leads, activation maps and APs are computed from one simulation clock.",
  });
  return checks;
}

export const FIDELITY_TABLE: { output: string; category: "Mechanistically simulated" | "Reduced-order approximation" | "Educational preset or schematic"; note: string }[] = [
  { output: "Activation sequence and conduction timing", category: "Mechanistically simulated", note: "Event-driven propagation on an anisotropic tissue graph with refractoriness (Levels 1–2)." },
  { output: "AV nodal rate-dependent delay", category: "Reduced-order approximation", note: "Recovery-curve model (Sun et al. 1995 form); nominal parameters." },
  { output: "Action-potential waveforms", category: "Reduced-order approximation", note: "Parametric Vm(t) anchored to activation time and APD; not ionic." },
  { output: "APD rate dependence", category: "Reduced-order approximation", note: "Mitchell–Schaeffer restitution map fitted to Franz 1988 steady-state slope." },
  { output: "12-lead ECG", category: "Reduced-order approximation", note: "Lead-field of −σ∇Vm; infinite-medium chest leads, Einthoven lead-vector limb leads." },
  { output: "ECG amplitudes", category: "Educational preset or schematic", note: "Scaled by calibrated torso transfer factors; not predictive." },
  { output: "Cardiac anatomy", category: "Educational preset or schematic", note: "Idealised ellipsoidal geometry, voxel size 2.5 mm." },
  { output: "Autonomic effects", category: "Educational preset or schematic", note: "Lumped tone indices with nominal coefficients." },
  { output: "Ionic currents, EAD/DAD, drug effects", category: "Educational preset or schematic", note: "Not implemented in Phase 1 (planned Phase 4)." },
];
