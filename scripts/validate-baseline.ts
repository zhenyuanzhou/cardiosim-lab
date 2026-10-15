/**
 * Command-line baseline report: `npm run validate`
 * Simulates 10 s of normal sinus rhythm and prints signal-derived ECG measurements next to
 * the activation model's own timings and published adult reference values.
 */
import { buildCardiacModel } from "../src/simulation/tissue/buildModel";
import { Simulator } from "../src/simulation/core/engine";
import { DEFAULT_PARAMS } from "../src/simulation/core/params";
import { measureBeats } from "../src/simulation/ecg-forward/measurements";

const t0 = performance.now();
const model = buildCardiacModel();
const t1 = performance.now();
const sim = new Simulator(model, DEFAULT_PARAMS);
sim.run(10000);
const t2 = performance.now();
const out = sim.drain();
const beats = measureBeats(out.ecg, sim.dt, 0, out.waves).filter((b) => b.qt !== null && b.rr !== null);
const med = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};
const waves = out.waves.filter((w) => w.origin === "sinus" && w.ventCount > 0);
const rows: [string, number, number, string][] = [
  ["RR (ms)", med(beats.map((b) => b.rr)), NaN, ""],
  ["PR (ms)", med(beats.map((b) => b.pr)), med(beats.map((b) => (b.truth && b.truth.pOn !== null ? b.truth.qrsOn - b.truth.pOn : null))), "120–200"],
  ["P duration (ms)", med(beats.map((b) => (b.pOn !== null && b.pOff !== null ? b.pOff - b.pOn : null))), med(waves.map((w) => w.tLastAtrial - w.tFirstAtrial)), "< 120"],
  ["QRS (ms)", med(beats.map((b) => b.qrs)), med(beats.map((b) => (b.truth ? b.truth.qrsOff - b.truth.qrsOn : null))), "< 110 (Surawicz 2009)"],
  ["QT (ms)", med(beats.map((b) => b.qt)), med(beats.map((b) => (b.truth ? b.truth.repolEnd - b.truth.qrsOn : null))), ""],
  ["QTc Bazett (ms)", med(beats.map((b) => b.qtcBazett)), NaN, "≤ 450 (Rautaharju 2009)"],
  ["QRS axis (°)", med(beats.map((b) => b.axisQRS)), NaN, "−30 … +90"],
  ["AH (ms)", NaN, med(waves.map((w) => w.tAvnOut - w.tAvnIn)), "76 ± 16 (Lee & Lien 1975)"],
  ["HV (ms)", NaN, med(waves.map((w) => w.tFirstVent - w.tHisProximal)), "45 ± 6 (Lee & Lien 1975)"],
];
console.log(`CardioSim Lab baseline · ${model.n} cells · build ${(t1 - t0).toFixed(0)} ms · 10 s simulated in ${(t2 - t1).toFixed(0)} ms`);
console.log("quantity".padEnd(18), "ECG signal".padStart(11), "model".padStart(8), "  reference");
for (const [k, a, b, r] of rows) console.log(k.padEnd(18), (Number.isFinite(a) ? a.toFixed(0) : "—").padStart(11), (Number.isFinite(b) ? b.toFixed(0) : "—").padStart(8), " ", r);
