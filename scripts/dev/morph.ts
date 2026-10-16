/** Morphology check: npx tsx scripts/dev/morph.ts <scenarioId...> */
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
const m = buildCardiacModel();
const W = computeLeadField(m);
for (const id of process.argv.slice(2)) {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s?.apply) { console.log(id, "not runnable"); continue; }
  const sim = new Simulator(m, s.apply(), W);
  sim.run(8000);
  const o = sim.drain();
  const acts = o.waves.filter((w) => Number.isFinite(w.tFirstVent) && w.tFirstVent > 2000).map((w) => w.tFirstVent);
  const r = analyseMorphology(o.ecg, sim.dt, acts);
  const cl = acts.length > 1 ? (Math.max(...acts) - Math.min(...acts)) / (acts.length - 1) : NaN;
  console.log(`${id.padEnd(16)} beats=${String(r.axes.length).padStart(3)} CL=${cl.toFixed(0)}ms disp=${r.axisDispersion.toFixed(0)}° rot=${r.meanRotation.toFixed(0)}°/beat cons=${(100*r.rotationConsistency).toFixed(0)}%`);
}
