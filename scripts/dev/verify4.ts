/** Induction through the ectopy "run" machinery (what a scenario can express). */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams, type SimParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";
import { CT } from "../../src/simulation/core/model";
const m = buildCardiacModel(); const W = computeLeadField(m);
const med=(x:number[])=>x.slice().sort((a,b)=>a-b)[Math.floor(x.length/2)];
function go(name:string,build:(p:SimParams)=>void,T=14000){
  const p=cloneParams(DEFAULT_PARAMS); build(p);
  const sim=new Simulator(m,sanitizeParams(p as unknown as Record<string,unknown>),W);
  sim.run(T); const o=sim.drain();
  let last=0,re=0; for(let k=0;k<o.recT.length;k++) if(m.cellType[o.recNode[k]]===CT.VENTRICULAR) last=Math.max(last,o.recT[k]);
  for(const w of o.waves) if(w.origin==="reentry") re++;
  const acts=o.waves.filter(w=>Number.isFinite(w.tFirstVent)&&w.tFirstVent>T*0.65).map(w=>w.tFirstVent).sort((a,b)=>a-b);
  const ivs=acts.slice(1).map((t,i)=>t-acts[i]);
  const cl=ivs.length?ivs.reduce((a,b)=>a+b,0)/ivs.length:NaN;
  const sd=ivs.length?Math.sqrt(ivs.reduce((a,b)=>a+(b-cl)**2,0)/ivs.length):NaN;
  const mo=analyseMorphology(o.ecg,sim.dt,acts);
  const probes=["rvot","lv-apex","septum"].map(s=>m.ectopicSites[s]); const all:number[]=[];
  for(const pr of probes){const ts:number[]=[];for(let k=0;k<o.recT.length;k++) if(o.recNode[k]===pr&&o.recT[k]>T*0.65) ts.push(o.recT[k]);ts.sort((a,b)=>a-b);for(let i=1;i<ts.length;i++) all.push(ts[i]-ts[i-1]);}
  const lcl=all.length?all.reduce((a,b)=>a+b,0)/all.length:NaN;
  const lsd=all.length?Math.sqrt(all.reduce((a,b)=>a+(b-lcl)**2,0)/all.length):NaN;
  const beats=measureBeats(o.ecg,sim.dt,0,o.waves).filter(b=>b.qt!==null&&b.qrs!==null).slice(0,3);
  console.log(`${name.padEnd(12)} re=${String(re).padStart(3)} sust=${String(last>T-400).padEnd(5)} waveCL=${cl.toFixed(0)} localCL=${lcl.toFixed(0)} var=${(100*lsd/lcl).toFixed(0)}% disp=${mo.axisDispersion.toFixed(0)}° n=${acts.length} | sinus QT=${beats.length?med(beats.map(b=>b.qt!)).toFixed(0):"-"} QRS=${beats.length?med(beats.map(b=>b.qrs!)).toFixed(0):"-"}`);
}
go("scarVT",(p)=>{p.restitution.apdFloor=0.6;p.ventricles.scar=true;p.ventricles.isthmusCvFactor=0.18;p.ventricles.borderCvFactor=0.12;p.ventricles.isthmusApdFactor=1.3;
  p.ectopy={...p.ectopy,site:"scar-border",pattern:"run",runLength:8,coupling:260,every:3};});
go("PVT",(p)=>{p.restitution.apdFloor=0.6;p.ventricles.scar=true;p.ventricles.isthmusCvFactor=0.12;p.ventricles.borderCvFactor=0.25;p.ventricles.isthmusApdFactor=1.3;
  p.ectopy={...p.ectopy,site:"scar-border",pattern:"run",runLength:8,coupling:260,every:3};});
go("VF",(p)=>{p.restitution.apdFloor=0.79;p.ventricles.heterogeneity=0.2;
  p.ectopy={...p.ectopy,site:"rv-apex",pattern:"run",runLength:14,coupling:240,every:3};});
