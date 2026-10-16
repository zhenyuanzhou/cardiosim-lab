import { pace, TP06_DEFAULT_MODS } from "../../src/simulation/cellular/tp06";
const B = TP06_DEFAULT_MODS;
console.log("=== DAD scan: RyR leak + Ca load, CL 600, 40 beats (epi) ===");
for (const leak of [0, 0.00018, 0.0004]) {
  for (const gCaL of [1, 2]) {
    for (const vUp of [1, 3, 4.5]) {
      for (const kNaCa of [1, 2.5]) {
        const r = pace("epi", {...B, vRyRLeak: leak, gCaL, vUp, kNaCa}, 600, 40);
        console.log(`leak=${leak} gCaL=${gCaL} vUp=${vUp} kNaCa=${kNaCa} apd=${String(r.apd90).padStart(4)} DAD=${r.dadAmplitude.toFixed(1)}mV trig=${r.triggeredBeat}`);
      }
    }
  }
}
console.log("\n=== EAD from IKr block alone (tauF 0.5), CL 1000 ===");
for (const cell of ["epi","mid"] as const)
  for (const gKr of [0.5, 0.2, 0.1, 0.05, 0]) {
    const r = pace(cell, {...B, tauF:0.5, gKr}, 1000, 30);
    console.log(`${cell} gKr=${gKr} apd90=${String(r.apd90).padStart(5)} EADs=${r.eadCount}`);
  }
