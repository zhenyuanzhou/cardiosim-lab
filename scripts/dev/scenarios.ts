import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
const only = process.argv.slice(2);
const m = buildCardiacModel();
for (const s of SCENARIOS) {
  if (!s.apply || (only.length && !only.includes(s.id))) continue;
  const sim = new Simulator(m, s.apply()); sim.run(8000); const o = sim.drain();
  const b = measureBeats(o.ecg, sim.dt, 0, o.waves);
  const w = o.waves.sort((a, c) => a.t0 - c.t0);
  console.log(`## ${s.id}`);
  console.log(" QRSon", b.map((x) => x.qrsOn.toFixed(0)).join(" "));
  console.log(" RR   ", b.map((x) => x.rr?.toFixed(0) ?? "-").join(" "));
  console.log(" PR   ", b.map((x) => x.pr?.toFixed(0) ?? "-").join(" "), "| QRS", b.map((x) => x.qrs.toFixed(0)).join(" "), "| QT", b.map((x) => x.qt?.toFixed(0) ?? "-").join(" "));
  console.log(" orig ", b.map((x) => x.origin ?? "?").join(" | "));
  console.log(" waves", w.map((x) => `${x.origin[0]}${x.avnPath === "avn-slow" ? "s" : ""}${x.avnBlocked ? "B" : ""}${x.infraHisBlocked ? "H" : ""}${Number.isFinite(x.tFirstVent) ? "V" : ""}`).join(" "));
}
