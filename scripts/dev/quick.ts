import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";
import { EXPERIMENTS } from "../../src/visualization/explorer/experiments";
const ids = process.argv.slice(2);
const m = buildCardiacModel();
for (const e of EXPERIMENTS) for (const v of e.variants) {
  if (!ids.includes(v.id)) continue;
  const s = new Simulator(m, v.params()); s.run(5000); const o = s.drain();
  const b = measureBeats(o.ecg, s.dt, 0, o.waves);
  console.log(v.id.padEnd(10), "QRS", b.map(x=>x.qrs.toFixed(0)).join(","), "truth", b.map(x=>x.truth? (x.truth.qrsOff-x.truth.qrsOn).toFixed(0):"-").join(","), "ax", b.map(x=>x.axisQRS.toFixed(0)).join(","), "QT", b.map(x=>x.qt?.toFixed(0)).join(","), "PR", b.map(x=>x.pr?.toFixed(0)).join(","));
}
