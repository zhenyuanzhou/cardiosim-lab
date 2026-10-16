/** Scan the R-on-T coupling interval for torsades initiation on a long-QT substrate. */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
import { CT } from "../../src/simulation/core/model";
const m = buildCardiacModel();
const W = computeLeadField(m);
const T = 14000;
for (const het of [0.15, 0.2, 0.25]) {
  for (const coupling of [280, 310, 340, 370, 400]) {
    for (const site of ["lv-lateral", "rv-apex"]) {
      const p = cloneParams(DEFAULT_PARAMS);
      p.restitution.apdFloor = 0.79;
      p.ventricles.heterogeneity = het;
      p.ventricles.apd = Math.round(300 * 1.173);
      p.ventricles.transmuralGradient = Math.round(25 * 1.173);
      p.ventricles.apicobasalGradient = Math.round(-30 * 1.173);
      p.ectopy = { ...p.ectopy, site: site as never, pattern: "bigeminy", coupling };
      const sim = new Simulator(m, sanitizeParams(p as unknown as Record<string, unknown>), W);
      sim.run(T);
      const o = sim.drain();
      let lastVent = 0, re = 0;
      for (let k = 0; k < o.recT.length; k++) if (m.cellType[o.recNode[k]] === CT.VENTRICULAR) lastVent = Math.max(lastVent, o.recT[k]);
      for (const w of o.waves) if (w.origin === "reentry") re++;
      if (re === 0) continue;
      const acts = o.waves.filter((w) => Number.isFinite(w.tFirstVent) && w.tFirstVent > 4000).map((w) => w.tFirstVent).sort((a,b)=>a-b);
      const ivs = acts.slice(1).map((t,i)=>t-acts[i]);
      const mean = ivs.reduce((a,b)=>a+b,0)/ivs.length;
      const mo = analyseMorphology(o.ecg, sim.dt, acts);
      console.log(`het=${het} coupling=${coupling} ${site} -> re=${re} end=${(lastVent/1000).toFixed(1)}s CL=${mean.toFixed(0)} n=${acts.length} disp=${mo.axisDispersion.toFixed(0)}° rot=${mo.meanRotation.toFixed(0)}°/b cons=${(100*mo.rotationConsistency).toFixed(0)}%`);
    }
  }
}
console.log("tdp coupling scan complete");
