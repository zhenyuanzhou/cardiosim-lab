/** Render lead II for a torsades config and report the per-beat amplitude envelope. */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField, N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
import { writeFileSync } from "node:fs";
const m = buildCardiacModel(); const W = computeLeadField(m);
const [ca,d,beats,T0,T1] = [+(process.argv[2]??320), +(process.argv[3]??7), +(process.argv[4]??16), +(process.argv[5]??8000), +(process.argv[6]??14000)];
const p = cloneParams(DEFAULT_PARAMS);
p.ventricles.apd=Math.round(300*1.173); p.ventricles.transmuralGradient=Math.round(25*1.173); p.ventricles.apicobasalGradient=Math.round(-30*1.173);
p.torsades={enabled:true,siteA:"rv-apex",siteB:"lv-anterobasal",cycleA:ca,cycleB:ca+d,beats,every:9,coupling:390};
const sim=new Simulator(m,sanitizeParams(p as unknown as Record<string,unknown>),W); sim.run(T1+1000);
const o=sim.drain();
const rows=["t,II"];
for(let i=0;i<o.ecg.length/N_CHANNELS;i++){const t=i*sim.dt; if(t<T0||t>T1)continue; rows.push(`${t.toFixed(0)},${o.ecg[i*N_CHANNELS+1].toFixed(4)}`);}
writeFileSync("/tmp/claude-0/tdp_lead2.csv", rows.join("\n"));
// per-beat peak-to-peak amplitude in lead II
const tw=o.waves.filter(w=>w.site==="torsades focus"&&Number.isFinite(w.tFirstVent)).map(w=>w.tFirstVent).sort((a,b)=>a-b);
const merged:number[]=[]; for(const t of tw) if(!merged.length||t-merged[merged.length-1]>80) merged.push(t);
const amps:number[]=[];
for(let k=0;k<merged.length;k++){
  const a=Math.round(merged[k]/sim.dt), b=Math.round(Math.min(merged[k]+ (merged[k+1]??merged[k]+300) - merged[k], merged[k]+200)/sim.dt);
  let lo=Infinity,hi=-Infinity;
  for(let i=a;i<b;i++){const v=o.ecg[i*N_CHANNELS+1]; if(v<lo)lo=v; if(v>hi)hi=v;}
  amps.push(hi-lo);
}
console.log(`cycleA=${ca} d=${d} beats=${beats}`);
console.log("lead II peak-to-peak per beat (mV):", amps.map(a=>a.toFixed(2)).join(" "));
const mx=Math.max(...amps), mn=Math.min(...amps);
console.log(`max/min ratio = ${(mx/mn).toFixed(1)}  (classic torsades: amplitude waxes and wanes, ratio >> 1)`);
