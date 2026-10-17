/** Render ECG through the real engine for given serum K values. */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";
import { writeFileSync } from "node:fs";
const m = buildCardiacModel();
for (const k of process.argv.slice(2).map(Number)) {
  const p = cloneParams(DEFAULT_PARAMS); p.electrolytes.serumPotassium = k;
  const sim = new Simulator(m, p); sim.run(6000); const o = sim.drain();
  const b = measureBeats(o.ecg, sim.dt, 0, o.waves).slice(1, -1);
  const med = (f: (x: any) => number) => { const v = b.map(f).filter(Number.isFinite).sort((x, y) => x - y); return v[v.length >> 1]; };
  console.log(`K=${k}: PR ${med((x) => x.pr)} QRS ${med((x) => x.qrs)} QT ${med((x) => x.qt)} P dur ${med((x) => x.pDur)}`);
  const rows = ["t,I,II,III,aVR,aVL,aVF,V1,V2,V3,V4,V5,V6"];
  for (let i = 0; i < o.ecg.length / N_CHANNELS; i++) { const t = i * sim.dt; if (t < 2000 || t >= 4500) continue; rows.push([(t - 2000).toFixed(0), ...Array.from({ length: 12 }, (_, c) => o.ecg[i * N_CHANNELS + c].toFixed(4))].join(",")); }
  writeFileSync(`/tmp/claude-0/ko/K${k}.csv`, rows.join("\n"));
}
