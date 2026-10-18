/** QC reproduction B: a later high-amplitude segment must not erase earlier QRS detections. */
import { SCENARIOS } from "../../../src/simulation/scenarios/scenarios";
import { run } from "../../../tests/helpers/sim";
import { measureBeats } from "../../../src/simulation/ecg-forward/measurements";
import { N_CHANNELS } from "../../../src/simulation/ecg-forward/leadField";

const r = run(SCENARIOS.find((s) => s.id === "nsr")!.apply!(), 8000);
const dt = r.sim.dt;
const ecg = r.out.ecg;
const n = ecg.length / N_CHANNELS;
const first6 = (bs: { qrsOn: number }[]) => bs.filter((b) => b.qrsOn < 6000).length;
const before = measureBeats(ecg, dt, 0, r.out.waves);
const boosted = ecg.slice();
for (let s = Math.round(7000 / dt); s < n; s++) for (let c = 0; c < N_CHANNELS; c++) boosted[s * N_CHANNELS + c] *= 10;
const after = measureBeats(boosted, dt, 0, r.out.waves);
const truth = r.out.waves.filter((w) => Number.isFinite(w.tFirstVent) && w.tFirstVent < 6000).length;
console.log(`ventricular activations (simulator labels) in 0-6 s: ${truth}`);
console.log(`QRS detected in 0-6 s: original ${first6(before)}, after x10 on the last second ${first6(after)}`);
