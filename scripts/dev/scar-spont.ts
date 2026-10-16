/** Scar VT must (a) stay quiet in sinus rhythm and (b) be inducible at a clinical VT rate. */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
import { CT } from "../../src/simulation/core/model";
const m = buildCardiacModel();
const W = computeLeadField(m);
function trial(floor:number,iCv:number,bCv:number,iApd:number,induce:boolean){
  const p = cloneParams(DEFAULT_PARAMS);
  p.restitution.apdFloor=floor; p.ventricles.scar=true;
  p.ventricles.isthmusCvFactor=iCv; p.ventricles.borderCvFactor=bCv; p.ventricles.isthmusApdFactor=iApd;
  const sim=new Simulator(m,sanitizeParams(p as unknown as Record<string,unknown>),W);
  if(induce){const n=m.ectopicSites["scar-border"];const t=[...Array(8).keys()].map(i=>2000+500*i);t.push(t[7]+260);t.push(t[8]+240);for(const x of t)sim.stimulate(n,x);}
  sim.run(12000);
  const o=sim.drain();
  let last=0,re=0;
  for(let k=0;k<o.recT.length;k++) if(m.cellType[o.recNode[k]]===CT.VENTRICULAR) last=Math.max(last,o.recT[k]);
  for(const w of o.waves) if(w.origin==="reentry") re++;
  const acts=o.waves.filter(w=>Number.isFinite(w.tFirstVent)&&w.tFirstVent>7000).map(w=>w.tFirstVent).sort((a,b)=>a-b);
  const ivs=acts.slice(1).map((t,i)=>t-acts[i]);
  const cl=ivs.length?ivs.reduce((a,b)=>a+b,0)/ivs.length:NaN;
  const disp=analyseMorphology(o.ecg,sim.dt,acts).axisDispersion;
  return {re,cl,disp,n:acts.length,sust:last>11600};
}
for(const floor of [0.6,0.7,0.85])
 for(const iCv of [0.12,0.18,0.25])
  for(const bCv of [0.12,0.25]){
    const s=trial(floor,iCv,bCv,1.3,false);
    if(s.re>0) continue;                       // rejects substrates that self-start
    const i=trial(floor,iCv,bCv,1.3,true);
    const ok = i.re>0 && i.sust && i.cl>=280 && i.cl<=500 && i.disp<30;
    console.log(`floor=${floor} iCv=${iCv} bCv=${bCv} | quiet: CL=${s.cl.toFixed(0)} | induced: re=${i.re} sust=${i.sust} CL=${i.cl.toFixed(0)} disp=${i.disp.toFixed(0)}°${ok?"  <== SCAR VT OK":""}`);
  }
console.log("complete");
