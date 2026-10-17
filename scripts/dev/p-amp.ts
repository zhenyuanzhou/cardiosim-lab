import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
const m = buildCardiacModel();
for (const k of process.argv.slice(2).map(Number)) {
  const p = cloneParams(DEFAULT_PARAMS); p.electrolytes.serumPotassium = k; const sim = new Simulator(m, p); sim.run(4000); const o = sim.drain();
  const w = o.waves.filter((x) => Number.isFinite(x.tFirstAtrial) && x.tFirstAtrial > 2000)[0];
  let mx = 0, t0 = NaN, t1 = NaN; const base = o.ecg[Math.round((w.tFirstAtrial - 10) / 2) * N_CHANNELS + 1];
  for (let t = w.tFirstAtrial; t < w.tFirstAtrial + 200; t += 2) { const v = o.ecg[Math.round(t / 2) * N_CHANNELS + 1] - base; if (v > mx) mx = v; if (v > 0.01 && isNaN(t0)) t0 = t; if (v > 0.01) t1 = t; }
  console.log(`K=${k}: P(II) amp ${mx.toFixed(3)} width>0.01mV ${t1 - t0} ms atrial activation span ${(w.tLastAtrial - w.tFirstAtrial).toFixed(0)}`);
}
