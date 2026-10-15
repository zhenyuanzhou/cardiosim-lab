import { pace, TP06_DEFAULT_MODS } from "../../src/simulation/cellular/tp06";
const t0 = performance.now();
for (const cell of ["epi", "mid", "endo"] as const) {
  for (const [lab, m] of [["base", {}], ["IKr-50%", { gKr: 0.5 }], ["IKr-90%", { gKr: 0.1 }], ["Ko 8", { Ko: 8 }], ["Ko 3", { Ko: 3 }], ["Cao 3", { Cao: 3 }], ["Cao 1", { Cao: 1 }], ["INa-50%", { gNa: 0.5 }], ["ICaL-50%", { gCaL: 0.5 }]] as const) {
    const r = pace(cell, { ...TP06_DEFAULT_MODS, ...m }, 1000, 30);
    console.log(cell.padEnd(5), lab.padEnd(9), "APD90", r.apd90.toFixed(0), "Vrest", r.vRest.toFixed(1), "Vpk", r.vPeak.toFixed(1), "dVdt", r.dvdtMax.toFixed(0), "EAD", r.ead, "cap", r.captured, "hj", r.naAvailability.toFixed(3));
  }
}
console.log("ms", (performance.now() - t0).toFixed(0));
