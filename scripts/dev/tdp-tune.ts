/** Tune cycle-length difference and run length for a full, consistent twist at 200-250/min. */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
const m = buildCardiacModel(); const W = computeLeadField(m);
for (const [A,B] of [["rv-apex","lv-anterobasal"],["lv-lateral","septum"]] as const)
for (const ca of [320,340,360])
for (const d of [3,5,7])
for (const beats of [14,18]) {
  const p=cloneParams(DEFAULT_PARAMS);
  p.ventricles.apd=Math.round(300*1.173); p.ventricles.transmuralGradient=Math.round(25*1.173); p.ventricles.apicobasalGradient=Math.round(-30*1.173);
  p.torsades={enabled:true,siteA:A as never,siteB:B as never,cycleA:ca,cycleB:ca+d,beats,every:9,coupling:390};
  const sim=new Simulator(m,sanitizeParams(p as unknown as Record<string,unknown>),W);
  sim.run(22000); const o=sim.drain();
  const tw=o.waves.filter(w=>w.site==="torsades focus"&&Number.isFinite(w.tFirstVent)).map(w=>w.tFirstVent).sort((a,b)=>a-b);
  const eps:number[][]=[];let cur:number[]=[];
  for(const t of tw){if(cur.length&&t-cur[cur.length-1]>900){eps.push(cur);cur=[];}cur.push(t);}
  if(cur.length)eps.push(cur);
  const r=eps.filter(e=>e.length>=8)[0]; if(!r){console.log(`${A}+${B} ${ca}/+${d}: no run`);continue;}
  const merged:number[]=[]; for(const t of r) if(!merged.length||t-merged[merged.length-1]>80) merged.push(t);
  const iv=merged.slice(1).map((t,i)=>t-merged[i]); const cl=iv.reduce((a,b)=>a+b,0)/iv.length; const rate=60000/cl;
  const mo=analyseMorphology(o.ecg,sim.dt,r);
  const span=Math.max(...mo.axes)-Math.min(...mo.axes);
  const ok = rate>=180&&rate<=260 && mo.rotationConsistency>=0.7 && span>=90;
  console.log(`${(A+"+"+B).padEnd(24)} ${ca}/+${d}: beats=${merged.length} CL=${cl.toFixed(0)} (${rate.toFixed(0)}/min) span=${span.toFixed(0)}° rot=${mo.meanRotation.toFixed(0)}°/b cons=${(100*mo.rotationConsistency).toFixed(0)}%${ok?"  <== TdP":""}`);
}
