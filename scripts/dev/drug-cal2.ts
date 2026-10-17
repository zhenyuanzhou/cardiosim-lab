import { repol } from "./drug-cal";
import { DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
const base = repol(cloneParams(DEFAULT_PARAMS));
const cases: [string, number, number, number, number][] = [ // name, da, w, ahShift, cv
  ["dofetilide", 61.6, 1.59, 0, 1], ["quinidine", 61.2, 1.7, 0, 1], ["verapamil", 0.1, 1.092, 32, 1],
];
for (const [n, da, w, ah, cv] of cases) {
  const p = cloneParams(DEFAULT_PARAMS); p.ventricles.apd += da; p.ventricles.phase3Scale = w; p.avNode.ahMin += ah; p.ventricles.cvLongitudinal *= cv;
  const r = repol(p);
  console.log(`${n}: dQT ${r.qt - base.qt} dJTp ${r.jtp - base.jtp} dTpTe ${r.tpte - base.tpte} dPR ${r.pr - base.pr} dQRS ${r.qrs - base.qrs}`);
}
