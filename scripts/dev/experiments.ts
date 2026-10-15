import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";
import { EXPERIMENTS } from "../../src/visualization/explorer/experiments";
const m = buildCardiacModel();
for (const e of EXPERIMENTS) for (const v of e.variants) {
  const s = new Simulator(m, v.params()); s.run(5000); const o = s.drain();
  const b = measureBeats(o.ecg, s.dt, 0, o.waves).slice(1);
  console.log(v.id.padEnd(10), "n", b.length, "QRS", b.map(x=>x.qrs.toFixed(0)).join(","), "ax", b.map(x=>x.axisQRS.toFixed(0)).join(","), "QT", b.map(x=>x.qt?.toFixed(0)).join(","), b.map(x=>x.origin).join(","));
}
