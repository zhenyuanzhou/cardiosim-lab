/** Slower foci + smaller cycle-length difference: does rotation become consistent? */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
const m = buildCardiacModel(); const W = computeLeadField(m);
for (const [A,B] of [["rv-apex","lv-anterobasal"],["lv-lateral","septum"],["rvot","lv-inferobasal"]] as const)
for (const ca of [300,330,360])
for (const d of [8,15,25]) {
  const p = cloneParams(DEFAULT_PARAMS);
  p.ventricles.apd=Math.round(300*1.173); p.ventricles.transmuralGradient=Math.round(25*1.173); p.ventricles.apicobasalGradient=Math.round(-30*1.173);
  p.torsades={enabled:true,siteA:A as never,siteB:B as never,cycleA:ca,cycleB:ca+d,beats:14,every:7,coupling:390};
  const sim=new Simulator(m,sanitizeParams(p as unknown as Record<string,unknown>),W);
  sim.run(20000); const o=sim.drain();
  const tw=o.waves.filter(w=>w.site==="torsades focus"&&Number.isFinite(w.tFirstVent)).sort((a,b)=>a.tFirstVent-b.tFirstVent);
  const eps:number[][]=[];let cur:number[]=[];
  for(const w of tw){if(cur.length&&w.tFirstVent-cur[cur.length-1]>800){eps.push(cur);cur=[];}cur.push(w.tFirstVent);}
  if(cur.length)eps.push(cur);
  const runs=eps.filter(e=>e.length>=6); if(!runs.length){console.log(`${A}+${B} ${ca}/+${d}: no run`);continue;}
  const r=runs[0]; const ivs=r.slice(1).map((t,i)=>t-r[i]); const cl=ivs.reduce((a,b)=>a+b,0)/ivs.length;
  const mo=analyseMorphology(o.ecg,sim.dt,r);
  const rate=60000/cl;
  const ok = rate>=180&&rate<=260 && mo.rotationConsistency>=0.65 && mo.axisDispersion>30;
  console.log(`${(A+"+"+B).padEnd(24)} ${ca}/+${d}: beats=${r.length} CL=${cl.toFixed(0)} (${rate.toFixed(0)}/min) disp=${mo.axisDispersion.toFixed(0)}° rot=${mo.meanRotation.toFixed(0)}°/b cons=${(100*mo.rotationConsistency).toFixed(0)}%${ok?"  <== TdP":""}`);
}
