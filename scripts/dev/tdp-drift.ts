/** Scan the drifting source: capture reliability, rate, envelope dips, longest gap. */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField, N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
const m=buildCardiacModel(); const W=computeLeadField(m);
function go(cycle:number,drift:number,beats:number,apdScale:number,erp:number){
  const p=cloneParams(DEFAULT_PARAMS);
  p.ventricles.erpRatio=erp;
  p.ventricles.apd=Math.round(300*apdScale); p.ventricles.transmuralGradient=Math.round(25*apdScale); p.ventricles.apicobasalGradient=Math.round(-30*apdScale);
  p.torsades={enabled:true,siteA:"rvot",cycleA:cycle,drift,beats,every:10,coupling:390};
  const sim=new Simulator(m,sanitizeParams(p as unknown as Record<string,unknown>),W); sim.run(24000);
  const o=sim.drain();
  const tw=o.waves.filter(w=>w.site==="torsades focus"&&Number.isFinite(w.tFirstVent)).map(w=>w.tFirstVent).sort((a,b)=>a-b);
  const eps:number[][]=[];let cur:number[]=[];
  for(const t of tw){if(cur.length&&t-cur[cur.length-1]>900){eps.push(cur);cur=[];}cur.push(t);}
  if(cur.length)eps.push(cur);
  const run=eps.filter(e=>e.length>=6)[0]; if(!run) return null;
  const merged:number[]=[]; for(const t of run) if(!merged.length||t-merged[merged.length-1]>80) merged.push(t);
  const iv=merged.slice(1).map((t,i)=>t-merged[i]);
  const cl=iv.reduce((a,b)=>a+b,0)/iv.length; const gap=Math.max(...iv);
  const amps:number[]=[];
  for(let k=0;k<merged.length;k++){
    const a=Math.round(merged[k]/sim.dt); const b=Math.round(Math.min(merged[k]+220,(merged[k+1]??merged[k]+240))/sim.dt);
    let lo=Infinity,hi=-Infinity; for(let i=a;i<b;i++){const v=o.ecg[i*N_CHANNELS+1]; if(v<lo)lo=v; if(v>hi)hi=v;}
    amps.push(hi-lo);
  }
  const mx=Math.max(...amps),thr=0.5*mx; let dips=0,below=false;
  for(const a of amps){if(a<thr&&!below){dips++;below=true;} if(a>=thr)below=false;}
  return {capture:merged.length/beats, rate:60000/cl, gap, dips, ratio:mx/Math.min(...amps), n:merged.length};
}
for(const apdScale of [1.08])
for(const erp of [0.75,0.85])
for(const cycle of [340,370,400,430])
for(const drift of [1]){
  const r=go(cycle,drift,36,apdScale,erp); if(!r){console.log(`apd×${apdScale} erp=${erp} cyc=${cycle} dr=${drift}: no run`);continue;}
  const ok=r.capture>0.9&&r.dips>=2&&r.gap<r.rate*0+600;
  console.log(`apd×${apdScale} erp=${erp} cyc=${cycle} dr=${drift}: capture=${(100*r.capture).toFixed(0)}% ${r.rate.toFixed(0)}/min maxGap=${r.gap.toFixed(0)}ms dips=${r.dips} ratio=${r.ratio.toFixed(1)}${ok?"  <== GOOD":""}`);
}
