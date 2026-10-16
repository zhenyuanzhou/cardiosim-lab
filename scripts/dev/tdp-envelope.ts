/** Find configs whose lead-II amplitude WAXES AND WANES repeatedly (the torsades hallmark). */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField, N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
const m=buildCardiacModel(); const W=computeLeadField(m);
function envelope(ca:number,d:number,beats:number,A:string,B:string){
  const p=cloneParams(DEFAULT_PARAMS);
  p.ventricles.apd=Math.round(300*1.173); p.ventricles.transmuralGradient=Math.round(25*1.173); p.ventricles.apicobasalGradient=Math.round(-30*1.173);
  p.torsades={enabled:true,siteA:A as never,siteB:B as never,cycleA:ca,cycleB:ca+d,beats,every:12,coupling:390};
  const sim=new Simulator(m,sanitizeParams(p as unknown as Record<string,unknown>),W); sim.run(26000);
  const o=sim.drain();
  const tw=o.waves.filter(w=>w.site==="torsades focus"&&Number.isFinite(w.tFirstVent)).map(w=>w.tFirstVent).sort((a,b)=>a-b);
  const eps:number[][]=[];let cur:number[]=[];
  for(const t of tw){if(cur.length&&t-cur[cur.length-1]>900){eps.push(cur);cur=[];}cur.push(t);}
  if(cur.length)eps.push(cur);
  const run=eps.filter(e=>e.length>=8)[0]; if(!run) return null;
  const merged:number[]=[]; for(const t of run) if(!merged.length||t-merged[merged.length-1]>80) merged.push(t);
  const amps:number[]=[];
  for(let k=0;k<merged.length;k++){
    const a=Math.round(merged[k]/sim.dt);
    const end=Math.min(merged[k]+220,(merged[k+1]??merged[k]+260));
    const b=Math.round(end/sim.dt);
    let lo=Infinity,hi=-Infinity;
    for(let i=a;i<b;i++){const v=o.ecg[i*N_CHANNELS+1]; if(v<lo)lo=v; if(v>hi)hi=v;}
    amps.push(hi-lo);
  }
  // count alternations of the envelope: local minima below 50% of the run's max
  const mx=Math.max(...amps), thr=0.5*mx;
  let dips=0, below=false;
  for(const a of amps){ if(a<thr&&!below){dips++;below=true;} if(a>=thr)below=false; }
  const iv=merged.slice(1).map((t,i)=>t-merged[i]); const cl=iv.reduce((x,y)=>x+y,0)/iv.length;
  return {beats:merged.length, cl, rate:60000/cl, amps, dips, ratio:mx/Math.min(...amps)};
}
for(const [A,B] of [["rv-apex","lv-anterobasal"],["lv-lateral","septum"]] as const)
for(const ca of [280,320])
for(const d of [20,30,40,55])
for(const beats of [28]) {
  const r=envelope(ca,d,beats,A,B); if(!r){console.log(`${A}+${B} ${ca}/+${d}: no run`);continue;}
  const ok=r.dips>=2&&r.ratio>3&&r.rate>=180&&r.rate<=270;
  console.log(`${(A+"+"+B).padEnd(24)} ${ca}/+${d}: beats=${r.beats} ${r.rate.toFixed(0)}/min dips=${r.dips} ratio=${r.ratio.toFixed(1)}${ok?"  <== WAXES/WANES":""}`);
  if(ok) console.log(`   amps: ${r.amps.map(a=>a.toFixed(2)).join(" ")}`);
}
