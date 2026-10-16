import { pace, TP06_DEFAULT_MODS } from "../../src/simulation/cellular/tp06";
const B = TP06_DEFAULT_MODS;
console.log("TP06 APD90 vs extracellular Ca (CL 1000, 30 beats)");
for (const cell of ["epi","mid","endo"] as const) {
  const row: string[] = [];
  for (const Cao of [1.0, 1.5, 2.0, 2.5, 3.0]) {
    const r = pace(cell, {...B, Cao}, 1000, 30);
    row.push(`Cao=${Cao}:${r.apd90}`);
  }
  console.log(cell.padEnd(5), row.join("  "));
}
