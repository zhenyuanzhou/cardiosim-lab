import { DRUGS, drugMods } from "../../src/simulation/cellular/drugs";
import { pace, TP06_DEFAULT_MODS } from "../../src/simulation/cellular/tp06";
import { mapToTissue } from "../../src/simulation/cellular/ionicMapping";
const B = TP06_DEFAULT_MODS;
const base = (["epi","mid","endo"] as const).map((c) => pace(c, B, 1000, 30));
console.log("drug          xCmax  gKr   gCaL  gNa   APDscale CVscale  (APD90 epi/M/endo)");
for (const d of DRUGS) {
  for (const x of [1, 4]) {
    const mods = drugMods(d, x);
    const mm = { ...B, ...mods };
    const r = (["epi","mid","endo"] as const).map((c) => pace(c, mm, 1000, 30));
    const map = mapToTissue(base, r);
    console.log(
      `${d.name.padEnd(12)} ${String(x).padStart(4)}x  ${mods.gKr.toFixed(2)}  ${mods.gCaL.toFixed(2)}  ${mods.gNa.toFixed(2)}  ${map.apdScale.toFixed(3)}    ${map.cvScale.toFixed(3)}   ${r.map((z)=>z.apd90).join("/")}`
    );
  }
}
