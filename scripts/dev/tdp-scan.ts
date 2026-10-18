import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { run } from "../../tests/helpers/sim";
import { tdpMetrics, formatMetrics, runWindow } from "./tdp-metrics";
const base = SCENARIOS.find((x) => x.id === "tdp")!.apply!;
for (const ring of [12, 16, 20]) for (const po of [50, 90]) {
  const p = base(); p.torsades = { ...p.torsades, pathSites: ring, pairOffset: po };
  const r = run(p, 20000);
  const runs = r.out.waves.filter((w) => w.site === "torsades focus" && Number.isFinite(w.tFirstVent)).sort((x, y) => x.tFirstVent - y.tFirstVent);
  const starts = runs.filter((w, i) => i === 0 || w.tFirstVent - runs[i - 1].tFirstVent > 600);
  let [a, b] = [0, 0];
  for (const st of starts) { const [x, y] = runWindow(r.out, st.tFirstVent - 5, 20000); if (y - x > b - a) [a, b] = [x, y]; }
  console.log(`ring=${ring} pair=${po} run ${(b - a).toFixed(0)} ms |`, formatMetrics(tdpMetrics(r.out, r.sim.dt, a, b)));
}
