/** Render lead II (and V1, V5) for a tuned torsades configuration. */
import { measure } from "./tdp-tune";
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { run } from "../../tests/helpers/sim";
import { N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
import { runWindow } from "../../src/simulation/ecg-forward/tdpMetrics";
import { writeFileSync } from "node:fs";
const [floor, drift, pair, ring, margin, tag] = [+process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5], +process.argv[6], process.argv[7]];
const p = SCENARIOS.find((x) => x.id === "tdp")!.apply!();
p.restitution.apdFloor = floor;
if (process.argv[8]) p.restitution.cvAmplitude = +process.argv[8];
p.torsades = { ...p.torsades, drift, pairOffset: pair, ringSize: ring, margin };
const r = run(p, 24000);
const foci = r.out.waves.filter((w) => w.site === "torsades focus" && Number.isFinite(w.tFirstVent)).sort((x, y) => x.tFirstVent - y.tFirstVent);
const starts = foci.filter((w, i) => i === 0 || w.tFirstVent - foci[i - 1].tFirstVent > 600);
let [a, b] = [0, 0];
for (const st of starts) { const [x, y] = runWindow(r.out, st.tFirstVent - 5, 24000); if (y - x > b - a) [a, b] = [x, y]; }
const t0 = Math.max(0, a - 2000), t1 = Math.min(b + 1500, 24000);
const rows = ["t,I,II,III,aVR,aVL,aVF,V1,V2,V3,V4,V5,V6"];
for (let i = 0; i < r.out.ecg.length / N_CHANNELS; i++) { const t = i * r.sim.dt; if (t < t0 || t >= t1) continue;
  rows.push([(t - t0).toFixed(0), ...Array.from({ length: 12 }, (_, c) => r.out.ecg[i * N_CHANNELS + c].toFixed(4))].join(",")); }
writeFileSync(`/tmp/claude-0/tdp/${tag}.csv`, rows.join("\n"));
console.log(tag, "window", (b - a).toFixed(0), "ms");
