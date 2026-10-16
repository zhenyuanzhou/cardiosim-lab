/** Export lead II (and the frontal axis per beat) for a torsades candidate, as CSV for plotting. */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField, N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
import { writeFileSync } from "node:fs";
const m = buildCardiacModel(); const W = computeLeadField(m);
const [A,B,ca,d,beats] = [process.argv[2]??"rv-apex", process.argv[3]??"lv-anterobasal", +(process.argv[4]??300), +(process.argv[5]??8), +(process.argv[6]??14)];
const p = cloneParams(DEFAULT_PARAMS);
p.ventricles.apd=Math.round(300*1.173); p.ventricles.transmuralGradient=Math.round(25*1.173); p.ventricles.apicobasalGradient=Math.round(-30*1.173);
p.torsades={enabled:true,siteA:A as never,siteB:B as never,cycleA:ca,cycleB:ca+d,beats,every:7,coupling:390};
const sim=new Simulator(m,sanitizeParams(p as unknown as Record<string,unknown>),W);
sim.run(16000); const o=sim.drain();
const rows:string[]=["t,I,II,aVF,V1"];
for(let i=0;i<o.ecg.length/N_CHANNELS;i++){const t=i*sim.dt; if(t<5000||t>13000)continue; const b=i*N_CHANNELS;
  rows.push([t.toFixed(0),o.ecg[b+0].toFixed(4),o.ecg[b+1].toFixed(4),o.ecg[b+5].toFixed(4),o.ecg[b+6].toFixed(4)].join(","));}
writeFileSync("/tmp/claude-0/tdp.csv", rows.join("\n"));
const tw=o.waves.filter(w=>w.site==="torsades focus"&&Number.isFinite(w.tFirstVent)).sort((a,b)=>a.tFirstVent-b.tFirstVent);
const eps:number[][]=[];let cur:number[]=[];
for(const w of tw){if(cur.length&&w.tFirstVent-cur[cur.length-1]>800){eps.push(cur);cur=[];}cur.push(w.tFirstVent);}
if(cur.length)eps.push(cur);
const r=eps.filter(e=>e.length>=6)[0]??[];
const merged:number[]=[]; for(const t of r) if(!merged.length||t-merged[merged.length-1]>80) merged.push(t);
const mo=analyseMorphology(o.ecg,sim.dt,r);
const mIv=merged.slice(1).map((t,i)=>t-merged[i]); const mCL=mIv.reduce((a,b)=>a+b,0)/mIv.length;
console.log(`MERGED beats=${merged.length} CL=${mCL.toFixed(0)} (${(60000/mCL).toFixed(0)}/min)`);
console.log("episode beats:",r.length,"times:",r.slice(0,20).map(x=>x.toFixed(0)).join(" "));
console.log("intervals:",r.slice(1).map((t,i)=>Math.round(t-r[i])).join(" "));
console.log("axes:",mo.axes.map(a=>a.toFixed(0)).join(" "));
console.log(`disp=${mo.axisDispersion.toFixed(0)}° rot=${mo.meanRotation.toFixed(0)}°/b cons=${(100*mo.rotationConsistency).toFixed(0)}%`);
