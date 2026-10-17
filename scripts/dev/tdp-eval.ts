/** Measure the current (v1.5) torsades scenario against the quantitative criteria. */
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { run } from "../../tests/helpers/sim";
import { tdpMetrics, formatMetrics, runWindow } from "./tdp-metrics";
const s = SCENARIOS.find((x) => x.id === "tdp")!;
const r = run(s.apply!(), 20000);
const runs = r.out.waves.filter((w) => w.site === "torsades focus" && Number.isFinite(w.tFirstVent)).sort((x, y) => x.tFirstVent - y.tFirstVent);
// the longest run: start from a torsades beat that is followed by many more
const starts = runs.filter((w, i) => i === 0 || w.tFirstVent - runs[i - 1].tFirstVent > 600);
let [a, b] = [0, 0];
for (const st of starts) {
  const [x, y] = runWindow(r.out, st.tFirstVent - 5, 20000);
  if (y - x > b - a) [a, b] = [x, y];
}
console.log(`tdp: run ${(b - a).toFixed(0)} ms |`, formatMetrics(tdpMetrics(r.out, r.sim.dt, a, b)));
