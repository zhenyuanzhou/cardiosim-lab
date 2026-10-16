/** Render the final torsades scenario exactly as the app runs it. */
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { computeLeadField, N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
import { writeFileSync } from "node:fs";
const m=buildCardiacModel(); const W=computeLeadField(m);
const s=SCENARIOS.find(x=>x.id==="tdp")!;
const sim=new Simulator(m,s.apply!(),W); sim.run(22000); const o=sim.drain();
const rows=["t,II"];
for(let i=0;i<o.ecg.length/N_CHANNELS;i++){const t=i*sim.dt; if(t<6000||t>18000)continue; rows.push(`${t.toFixed(0)},${o.ecg[i*N_CHANNELS+1].toFixed(4)}`);}
writeFileSync("/tmp/claude-0/tdp_final.csv", rows.join("\n"));
console.log("rendered");
