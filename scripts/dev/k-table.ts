/**
 * TP06 → tissue table for extracellular potassium (and the acute-ischaemia cell condition):
 * APD scale, CV scale (√ dV/dt_max), AP amplitude scale, resting potential. Mean of epi/mid/endo,
 * CL 1000 ms, 30 beats — the same protocol as TP06_MAPPED.
 */
import { pace, TP06_DEFAULT_MODS } from "../../src/simulation/cellular/tp06";
import { mapToTissue } from "../../src/simulation/cellular/ionicMapping";
const CELLS = ["epi", "mid", "endo"] as const;
const base = CELLS.map((c) => pace(c, TP06_DEFAULT_MODS, 1000, 30));
const amp = (rs: any[]) => rs.reduce((a, r) => a + r.vPeak - r.vRest, 0) / rs.length;
const rest = (rs: any[]) => rs.reduce((a, r) => a + r.vRest, 0) / rs.length;
const conds: [string, any][] = [2.5, 3, 3.5, 4, 4.5, 5.4, 6, 7, 8, 9].map((k) => [`Ko=${k}`, { Ko: k }]);
conds.push(["ischaemia (Ko 9.9, gNa & gCaL x0.85)", { Ko: 9.9, gNa: 0.85, gCaL: 0.85 }]);
for (const [name, mods] of conds) {
  const r = CELLS.map((c) => pace(c, { ...TP06_DEFAULT_MODS, ...mods }, 1000, 30));
  const m = mapToTissue(base, r);
  console.log(`${name}: apdScale ${m.apdScale.toFixed(3)} cvScale ${m.cvScale.toFixed(3)} ampScale ${(amp(r) / amp(base)).toFixed(3)} vRest ${rest(r).toFixed(1)} captured ${r.every((x) => x.captured)}`);
}
