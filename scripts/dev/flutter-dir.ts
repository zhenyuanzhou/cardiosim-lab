/** Sequence of activation at atrial landmarks during flutter: which way does the wave circulate? */
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams } from "../../src/simulation/core/params";
const m = buildCardiacModel(); const p = SCENARIOS.find((s) => s.id === "flutter")!.apply!();
const sim: any = new Simulator(m, sanitizeParams(p as any)); const sites = ["ra-high", "ra-low", "la"]; const ids = sites.map((s) => m.ectopicSites[s]);
const last = ids.map(() => -1); const ev: [number, string][] = [];
for (let t = 4000; t < 5200; t += 2) { sim.run(t); ids.forEach((n, k) => { const a = sim.lastAct[n]; if (a !== last[k]) { last[k] = a; ev.push([a, sites[k]]); } }); }
ev.sort((a, b) => a[0] - b[0]); console.log(ev.map(([t, s]) => `${t.toFixed(0)} ${s}`).join("\n"));
console.log("RA centre / landmark positions:", sites.map((s, k) => `${s} [${[0,1,2].map((c) => m.pos[3*ids[k]+c].toFixed(0))}]`).join("  "));
