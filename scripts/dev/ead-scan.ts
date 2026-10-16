import { pace, TP06_DEFAULT_MODS } from "../../src/simulation/cellular/tp06";
const B = TP06_DEFAULT_MODS;
console.log("=== EAD scan: tauF 0.5 (Vandersickel 2014), CL 1000, 30 beats ===");
for (const cell of ["epi","mid","endo"] as const) {
  for (const gCaL of [1,1.5,2,2.5,3]) {
    for (const gKs of [1,0.2]) {
      const r = pace(cell, {...B, tauF:0.5, gCaL, gKs}, 1000, 30);
      console.log(`${cell} gCaL=${gCaL} gKs=${gKs} apd90=${String(r.apd90).padStart(5)} EADs=${r.eadCount} cap=${r.captured}`);
    }
  }
}
