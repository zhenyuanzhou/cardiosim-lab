/** What fraction of the ventricle is actually refractory at each instant after a sinus beat? */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { CT } from "../../src/simulation/core/model";
import { setupParams } from "./tdp-emergent";
const model = buildCardiacModel(); const W = computeLeadField(model);
const mB = +(process.argv[2] ?? 140), smooth = +(process.argv[3] ?? 1), phiSd = +(process.argv[4] ?? 55), longSd = +(process.argv[5] ?? 0.22);
const p = setupParams({ apd: 1.3, grad: 1, floor: 0.45, cv: 0.7, het: 0, s2: 0, site: "lv-apex", mBoost: mB, smooth, phiSd, longSd });
const sim: any = new Simulator(model, p, W);
sim.run(5000);
const vent: number[] = [];
for (let i = 0; i < model.n; i++) if (model.cellType[i] === CT.VENTRICULAR) vent.push(i);
// step forward and report the refractory fraction each 20 ms
for (let t = 5000; t < 5900; t += 20) {
  sim.run(t);
  let refr = 0;
  for (const i of vent) if (t - sim.lastAct[i] < sim.erp[i]) refr++;
  if (refr > 0) console.log(`t=${t} (${(t - 4766 - 912 * Math.floor((t - 4766) / 912)).toFixed(0)} ms after the last QRS): refractory ${(100 * refr / vent.length).toFixed(1)} %`);
}
