import { ANATOMY, toLocal, makeFrame } from "../../src/simulation/tissue/anatomy";
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams } from "../../src/simulation/core/params";
import { computeLeadField, N_COLS } from "../../src/simulation/ecg-forward/leadField";
const over = JSON.parse(process.argv[2] ?? "{}");
Object.assign(ANATOMY, over.anatomy ?? {});
const m = buildCardiacModel();
const W = computeLeadField(m);
const sim = new Simulator(m, sanitizeParams(over.params ?? {}), W);
sim.run(3800);
const out = sim.drain();
const w = out.waves.filter((w) => w.origin === "sinus").sort((a, b) => a.id - b.id)[3];
const AT = new Float64Array(m.n).fill(NaN);
for (let k = 0; k < out.recT.length; k++) if (out.recWave[k] === w.id) AT[out.recNode[k]] = out.recT[k] - w.tFirstVent;
const col = +process.argv[3];
const groups = new Map<string, number>();
for (let i = 0; i < m.n; i++) {
  if (m.cellType[i] !== 5) continue;
  const e = m.transmural[i];
  const surf = e < 0.15 ? "endo" : e > 0.85 ? "epi" : "mid";
  const lev = m.apicobasal[i] < 0.1 ? "base" : m.apicobasal[i] < 0.5 ? "upper" : "lower";
  const key = ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "LV", "SEP", "RV"][m.region[i]] + "-" + surf + "-" + lev;
  groups.set(key, (groups.get(key) ?? 0) - 120 * W[i * N_COLS + col] * AT[i]);
}
const tot = [...groups.values()].reduce((a, b) => a + b, 0);
console.log("total QRS integral (approx)", tot.toFixed(1));
for (const [k, v] of [...groups].sort((a, b) => a[1] - b[1])) if (Math.abs(v) > Math.abs(tot) * 0.05) console.log(k.padEnd(18), v.toFixed(1));
