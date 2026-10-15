import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams } from "../../src/simulation/core/params";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";
const m = buildCardiacModel();
const sim = new Simulator(m, sanitizeParams(JSON.parse(process.argv[2] ?? "{}")));
sim.run(8000);
const out = sim.drain();
const beats = measureBeats(out.ecg, sim.dt, 0, out.waves);
const f = (v: number | null) => (v === null ? "  -  " : v.toFixed(0).padStart(5));
console.log(" RR    HR   PR   QRS   QT  QTcB QTcF axQRS axP axT | truth: PR  QRS  QT(rep)  HV  AH");
for (const b of beats.slice(4,6)) {
  const t = b.truth;
  console.log(f(b.rr), f(b.hr), f(b.pr), f(b.qrs), f(b.qt), f(b.qtcBazett), f(b.qtcFridericia), f(b.axisQRS), f(b.axisP), f(b.axisT), "|", t ? [t.pOn !== null ? t.qrsOn - t.pOn : null, t.qrsOff - t.qrsOn, t.repolEnd - t.qrsOn, t.hisToV, t.ah].map(f).join(" ") : "");
}
