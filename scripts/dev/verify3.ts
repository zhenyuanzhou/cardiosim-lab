import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams, type SimParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
import { CT } from "../../src/simulation/core/model";
const m = buildCardiacModel(); const W = computeLeadField(m);
const med=(x:number[])=>x.slice().sort((a,b)=>a-b)[Math.floor(x.length/2)];
function cfg(iCv:number,bCv:number):SimParams{
  const p=cloneParams(DEFAULT_PARAMS); p.restitution.apdFloor=0.6; p.ventricles.scar=true;
  p.ventricles.isthmusCvFactor=iCv; p.ventricles.borderCvFactor=bCv; p.ventricles.isthmusApdFactor=1.3;
  return sanitizeParams(p as unknown as Record<string,unknown>);
}
function go(name:string,p:SimParams,induce:boolean,seeds:number[]){
  for(const seed of seeds){
    const q={...p,seed} as SimParams;
    const sim=new Simulator(m,q,W);
    if(induce){const n=m.ectopicSites["scar-border"];const t=[...Array(8).keys()].map(i=>2000+500*i);t.push(t[7]+260);t.push(t[8]+240);for(const x of t)sim.stimulate(n,x);}
    sim.run(12000);
    const o=sim.drain();
    let last=0,re=0; for(let k=0;k<o.recT.length;k++) if(m.cellType[o.recNode[k]]===CT.VENTRICULAR) last=Math.max(last,o.recT[k]);
    for(const w of o.waves) if(w.origin==="reentry") re++;
    const acts=o.waves.filter(w=>Number.isFinite(w.tFirstVent)&&w.tFirstVent>7000).map(w=>w.tFirstVent).sort((a,b)=>a-b);
    const ivs=acts.slice(1).map((t,i)=>t-acts[i]);
    const cl=ivs.length?ivs.reduce((a,b)=>a+b,0)/ivs.length:NaN;
    const mo=analyseMorphology(o.ecg,sim.dt,acts);
    const beats=measureBeats(o.ecg,sim.dt,0,o.waves);
    const early=beats.filter(b=>b.qt!==null&&b.qrs!==null).slice(0,3);
    // QRS width of the tachycardia from the model's own activation span
    const vw=o.waves.filter(w=>Number.isFinite(w.tFirstVent)&&Number.isFinite(w.tLastVent)&&w.tFirstVent>7000).map(w=>w.tLastVent-w.tFirstVent);
    console.log(`${name} seed=${seed} re=${re} sust=${last>11600} CL=${cl.toFixed(0)} disp=${mo.axisDispersion.toFixed(0)}° nbeats=${acts.length} activationSpan=${vw.length?med(vw).toFixed(0):"-"}ms | baselineQT=${early.length?med(early.map(b=>b.qt!)).toFixed(0):"-"} QRS=${early.length?med(early.map(b=>b.qrs!)).toFixed(0):"-"}`);
  }
}
console.log("— scar VT (iCv 0.18, bCv 0.12) —");
go("quiet  ",cfg(0.18,0.12),false,[1]);
go("induced",cfg(0.18,0.12),true,[1,7,42]);
console.log("— polymorphic VT (iCv 0.12, bCv 0.25) —");
go("quiet  ",cfg(0.12,0.25),false,[1]);
go("induced",cfg(0.12,0.25),true,[1,7,42]);
