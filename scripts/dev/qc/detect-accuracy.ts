/**
 * Detection accuracy against INDEPENDENTLY RETAINED simulator labels (the wave records), across every
 * scenario, plus two amplitude stress tests. The labels are ground truth from the model, never from
 * the ECG, so this measures the detector and not itself.
 */
import { SCENARIOS } from "../../../src/simulation/scenarios/scenarios";
import { run } from "../../../tests/helpers/sim";
import { measureBeats } from "../../../src/simulation/ecg-forward/measurements";
import { N_CHANNELS } from "../../../src/simulation/ecg-forward/leadField";

const TOL = 80; // ms: a detection matches a label within this window

export function score(ecg: Float32Array, dt: number, labels: number[]) {
  const det = measureBeats(ecg, dt, 0, []).map((b) => b.qrsOn);
  const used = new Set<number>();
  let tp = 0;
  for (const l of labels) {
    let bi = -1;
    let bd = TOL;
    for (let i = 0; i < det.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(det[i] - l);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi >= 0) { used.add(bi); tp++; }
  }
  return { tp, fn: labels.length - tp, fp: det.length - tp, n: labels.length };
}

const ids = process.argv.length > 2 ? process.argv.slice(2) : SCENARIOS.map((s) => s.id);
let totTp = 0, totFn = 0, totFp = 0;
for (const id of ids) {
  const sc = SCENARIOS.find((s) => s.id === id);
  if (!sc?.apply) continue;
  const r = run(sc.apply(), 8000);
  // labels: ventricular activations, merged within 80 ms (one QRS per fused activation)
  const raw = r.out.waves.filter((w) => Number.isFinite(w.tFirstVent)).map((w) => w.tFirstVent).sort((a, b) => a - b);
  const labels = raw.filter((t, i) => i === 0 || t - raw[i - 1] > 80).filter((t) => t > 120 && t < 7900);
  const s = score(r.out.ecg, r.sim.dt, labels);
  totTp += s.tp; totFn += s.fn; totFp += s.fp;
  const flag = s.fn + s.fp > 0 ? "  <-" : "";
  console.log(`${id.padEnd(20)} labels ${String(s.n).padStart(3)}  matched ${String(s.tp).padStart(3)}  missed ${s.fn}  extra ${s.fp}${flag}`);
}
console.log(`\nTOTAL: ${totTp} matched, ${totFn} missed, ${totFp} extra  (sensitivity ${(100 * totTp / (totTp + totFn)).toFixed(1)} %)`);

// amplitude stress tests on sinus rhythm
const r = run(SCENARIOS.find((s) => s.id === "nsr")!.apply!(), 8000);
const base = r.out.waves.filter((w) => Number.isFinite(w.tFirstVent)).map((w) => w.tFirstVent).filter((t) => t > 120 && t < 7900);
const n = r.out.ecg.length / N_CHANNELS;
const scaled = (f: (t: number) => number) => {
  const e = r.out.ecg.slice();
  for (let s = 0; s < n; s++) { const g = f(s * r.sim.dt); for (let c = 0; c < N_CHANNELS; c++) e[s * N_CHANNELS + c] *= g; }
  return e;
};
for (const [name, f] of [
  ["last second x10 (the reported bug)", (t: number) => (t > 7000 ? 10 : 1)],
  ["last second x0.2 (low-amplitude beats)", (t: number) => (t > 7000 ? 0.2 : 1)],
  ["first half x0.25", (t: number) => (t < 4000 ? 0.25 : 1)],
  ["slow 4x amplitude drift", (t: number) => 1 + 3 * (t / 8000)],
  ["whole record x0.1", () => 0.1],
] as [string, (t: number) => number][]) {
  const s = score(scaled(f), r.sim.dt, base);
  console.log(`${name.padEnd(40)} matched ${s.tp}/${s.n}  extra ${s.fp}`);
}
