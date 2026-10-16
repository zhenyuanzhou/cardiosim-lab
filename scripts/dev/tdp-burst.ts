/** Long-QT substrate + burst: is the resulting rhythm polymorphic with a rotating axis? */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
import { CT } from "../../src/simulation/core/model";
const m = buildCardiacModel();
const W = computeLeadField(m);
const T = 14000, BURST = 3000;
for (const apdScale of [1.173, 1.35]) {
  for (const het of [0.12, 0.18, 0.25]) {
    for (const cyc of [300, 340]) {
      const p = cloneParams(DEFAULT_PARAMS);
      p.restitution.apdFloor = 0.79;
      p.ventricles.heterogeneity = het;
      p.ventricles.apd = Math.round(300 * apdScale);
      p.ventricles.transmuralGradient = Math.round(25 * apdScale);
      p.ventricles.apicobasalGradient = Math.round(-30 * apdScale);
      const sim = new Simulator(m, sanitizeParams(p as unknown as Record<string, unknown>), W);
      const node = m.ectopicSites["lv-lateral"];
      for (let i = 0; i < 8; i++) sim.stimulate(node, BURST + i * cyc);
      sim.run(T);
      const o = sim.drain();
      let lastVent = 0, re = 0;
      for (let k = 0; k < o.recT.length; k++) if (m.cellType[o.recNode[k]] === CT.VENTRICULAR) lastVent = Math.max(lastVent, o.recT[k]);
      for (const w of o.waves) if (w.origin === "reentry") re++;
      const after = BURST + 8 * cyc + 300;
      const acts = o.waves.filter((w) => Number.isFinite(w.tFirstVent) && w.tFirstVent > after).map((w) => w.tFirstVent).sort((a,b)=>a-b);
      if (acts.length < 3) { console.log(`apd×${apdScale} het=${het} cyc=${cyc} -> no tachycardia (re=${re})`); continue; }
      const ivs = acts.slice(1).map((t,i)=>t-acts[i]);
      const mean = ivs.reduce((a,b)=>a+b,0)/ivs.length;
      const mo = analyseMorphology(o.ecg, sim.dt, acts);
      const dur = (lastVent - after)/1000;
      console.log(`apd×${apdScale} het=${het} cyc=${cyc} -> re=${re} CL=${mean.toFixed(0)} n=${acts.length} dur=${dur.toFixed(1)}s sust=${lastVent>T-400} disp=${mo.axisDispersion.toFixed(0)}° rot=${mo.meanRotation.toFixed(0)}°/b cons=${(100*mo.rotationConsistency).toFixed(0)}%`);
    }
  }
}
console.log("done");
