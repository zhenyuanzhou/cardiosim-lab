/** Calibrate the baseline-flatness metric: sinus (long isoelectric baseline) vs VF (none). */
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { run } from "../../tests/helpers/sim";
import { tdpMetrics, formatMetrics } from "./tdp-metrics";
for (const id of ["nsr", "vt-focal", "vf"]) {
  const s = SCENARIOS.find((x) => x.id === id)!;
  const r = run(s.apply!(), 12000);
  console.log(id.padEnd(9), formatMetrics(tdpMetrics(r.out, r.sim.dt, 6000, 11000)));
}
