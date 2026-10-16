/** Full check of the chosen torsades configuration against its defining features. */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";
const m = buildCardiacModel(); const W = computeLeadField(m);
const p = cloneParams(DEFAULT_PARAMS);
p.ventricles.apd=Math.round(300*1.173); p.ventricles.transmuralGradient=Math.round(25*1.173); p.ventricles.apicobasalGradient=Math.round(-30*1.173);
p.torsades={enabled:true,siteA:"rv-apex",siteB:"lv-anterobasal",cycleA:320,cycleB:327,beats:16,every:9,coupling:390};
const sim=new Simulator(m,sanitizeParams(p as unknown as Record<string,unknown>),W);
sim.run(26000); const o=sim.drain();
const tw=o.waves.filter(w=>w.site==="torsades focus"&&Number.isFinite(w.tFirstVent)).map(w=>w.tFirstVent).sort((a,b)=>a-b);
const eps:number[][]=[];let cur:number[]=[];
for(const t of tw){if(cur.length&&t-cur[cur.length-1]>900){eps.push(cur);cur=[];}cur.push(t);}
if(cur.length)eps.push(cur);
const runs=eps.filter(e=>e.length>=8);
console.log(`episodes: ${runs.length} (recurrent, self-terminating)`);
for(const r of runs){
  const merged:number[]=[]; for(const t of r) if(!merged.length||t-merged[merged.length-1]>80) merged.push(t);
  const iv=merged.slice(1).map((t,i)=>t-merged[i]); const cl=iv.reduce((a,b)=>a+b,0)/iv.length;
  const mo=analyseMorphology(o.ecg,sim.dt,r);
  const span=Math.max(...mo.axes)-Math.min(...mo.axes);
  const sinusAfter=o.waves.filter(w=>w.origin==="sinus"&&Number.isFinite(w.tFirstVent)&&w.tFirstVent>r[r.length-1]+200&&w.tFirstVent<r[r.length-1]+2500).length;
  console.log(`  run ${(r[0]/1000).toFixed(1)}-${(r[r.length-1]/1000).toFixed(1)}s: beats=${merged.length} CL=${cl.toFixed(0)} (${(60000/cl).toFixed(0)}/min) span=${span.toFixed(0)}° cons=${(100*mo.rotationConsistency).toFixed(0)}% sinusResumes=${sinusAfter>0}`);
  console.log(`    axes: ${mo.axes.map(a=>a.toFixed(0)).join(" ")}`);
}
// QT on the sinus beats before the first run
const beats=measureBeats(o.ecg,sim.dt,0,o.waves).filter(b=>b.qt!==null&&b.qrs!==null);
const pre=beats.filter(b=>b.tStart<runs[0]?.[0]).slice(-4);
console.log("sinus before onset: QT", pre.map(b=>b.qt!.toFixed(0)).join("/"), "QRS", pre.map(b=>b.qrs!.toFixed(0)).join("/"));
// control: same foci WITHOUT the long-QT substrate
const q=cloneParams(DEFAULT_PARAMS); q.torsades={...p.torsades};
const s2=new Simulator(m,sanitizeParams(q as unknown as Record<string,unknown>),W); s2.run(26000); const o2=s2.drain();
const tw2=o2.waves.filter(w=>w.site==="torsades focus"&&Number.isFinite(w.tFirstVent)).map(w=>w.tFirstVent).sort((a,b)=>a-b);
const e2:number[][]=[];let c2:number[]=[];
for(const t of tw2){if(c2.length&&t-c2[c2.length-1]>900){e2.push(c2);c2=[];}c2.push(t);}
if(c2.length)e2.push(c2);
const r2=e2.filter(e=>e.length>=8)[0];
if(r2){const mo2=analyseMorphology(o2.ecg,s2.dt,r2); console.log(`control (normal QT): span=${(Math.max(...mo2.axes)-Math.min(...mo2.axes)).toFixed(0)}° cons=${(100*mo2.rotationConsistency).toFixed(0)}%`);}
