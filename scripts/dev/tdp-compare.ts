/** Compare twist "straightness" (net rotation / total rotation) across polymorphic rhythms. */
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
const m=buildCardiacModel(); const W=computeLeadField(m);
function straight(id:string, ms:number, from:number, onlyFoci=false){
  const s=SCENARIOS.find(x=>x.id===id)!; const sim=new Simulator(m,s.apply!(),W); sim.run(ms); const o=sim.drain();
  let acts=o.waves.filter(w=>Number.isFinite(w.tFirstVent)&&w.tFirstVent>from).map(w=>w.tFirstVent).sort((a,b)=>a-b);
  if(onlyFoci){
    const tw=o.waves.filter(w=>w.site==="torsades focus"&&Number.isFinite(w.tFirstVent)).map(w=>w.tFirstVent).sort((a,b)=>a-b);
    const eps:number[][]=[];let cur:number[]=[];
    for(const t of tw){if(cur.length&&t-cur[cur.length-1]>900){eps.push(cur);cur=[];}cur.push(t);}
    if(cur.length)eps.push(cur);
    acts=eps.filter(e=>e.length>=8)[0]??[];
  }
  const mo=analyseMorphology(o.ecg,sim.dt,acts);
  const steps:number[]=[];
  for(let k=1;k<mo.axes.length;k++){let d=((mo.axes[k]-mo.axes[k-1])%360+540)%360-180; steps.push(d);}
  const net=Math.abs(steps.reduce((a,b)=>a+b,0)); const tot=steps.reduce((a,b)=>a+Math.abs(b),0);
  console.log(`${id.padEnd(10)} beats=${String(mo.axes.length).padStart(3)} span=${(Math.max(...mo.axes)-Math.min(...mo.axes)).toFixed(0)}° cons=${(100*mo.rotationConsistency).toFixed(0)}% net=${net.toFixed(0)}° total=${tot.toFixed(0)}° straightness=${(net/tot).toFixed(2)}`);
}
straight("tdp",26000,0,true);
straight("pvt",14000,9000);
straight("vf",14000,9000);
straight("vt-scar",14000,9000);
