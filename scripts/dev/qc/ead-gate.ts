/**
 * Where can an EAD take off at 390 ms after the upstroke? Needs APD > 390 ms during sinus rhythm.
 * Reports the dynamic APD (at the sinus cycle) at the M-cell island core and the distribution across
 * the ventricle, for the default substrate and the long-QT torsades substrate, plus how APD responds
 * to a long cycle (pause dependence).
 */
import { SCENARIOS } from "../../../src/simulation/scenarios/scenarios";
import { buildCardiacModel } from "../../../src/simulation/tissue/buildModel";
import { Simulator } from "../../../src/simulation/core/engine";
import { computeLeadField } from "../../../src/simulation/ecg-forward/leadField";
import { DEFAULT_PARAMS, cloneParams, type SimParams } from "../../../src/simulation/core/params";
import { mCellWeights } from "../../../src/simulation/core/mcells";
import { CT } from "../../../src/simulation/core/model";

const model = buildCardiacModel();
const W = computeLeadField(model);
const report = (label: string, p: SimParams) => {
  const w = mCellWeights(model, { transmuralSd: 0.33, phiSd: p.ventricles.mCellPhiSd, longSd: p.ventricles.mCellLongSd, floor: 0.25 });
  let core = 0;
  for (let i = 0; i < model.n; i++) if (w[i] > w[core]) core = i;
  const pp = cloneParams(p);
  pp.torsades.enabled = false;
  const s = new Simulator(model, pp, W);
  s.run(8000);
  const apd: number[] = [];
  for (let i = 0; i < model.n; i++) if (model.cellType[i] === CT.VENTRICULAR) apd.push(s.apd[i]);
  apd.sort((a, b) => a - b);
  const q = (f: number) => apd[Math.floor(f * (apd.length - 1))].toFixed(0);
  const over = apd.filter((x) => x > 390).length / apd.length;
  console.log(`${label}: island core APD ${s.apd[core].toFixed(0)} ms (ERP ${s.erp[core].toFixed(0)}) | ventricle APD min ${q(0)} / median ${q(0.5)} / max ${q(1)} ms | ${(100 * over).toFixed(1)} % of ventricle has APD > 390`);
  return core;
};
const tdp = SCENARIOS.find((x) => x.id === "tdp")!.apply!();
report("default (normal QT)   ", cloneParams(DEFAULT_PARAMS));
report("torsades substrate    ", tdp);
const noM = cloneParams(tdp); noM.ventricles.mCellBoost = DEFAULT_PARAMS.ventricles.mCellBoost;
report("long QT, normal M-cell", noM);
for (const id of ["ikr-block", "drug-dofetilide", "dofetilide-clinical", "hypok", "hypoca"]) {
  const s = SCENARIOS.find((x) => x.id === id);
  if (s?.apply) report(id.padEnd(22), s.apply());
}
