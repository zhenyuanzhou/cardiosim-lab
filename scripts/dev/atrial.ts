/** Atrial/ventricular rhythm summary for a parameter override: npx tsx scripts/dev/atrial.ts '<json>' [ms] */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS } from "../../src/simulation/core/params";
const m = buildCardiacModel();
const over = JSON.parse(process.argv[2] ?? "{}");
const merged: Record<string, unknown> = JSON.parse(JSON.stringify(DEFAULT_PARAMS));
for (const [g, v] of Object.entries(over)) merged[g] = typeof v === "object" ? { ...(merged[g] as object), ...(v as object) } : v;
const T = +(process.argv[3] ?? 8000);
const sim = new Simulator(m, sanitizeParams(merged));
sim.run(T);
const o = sim.drain();
// per-node activation times for a probe atrial node and a ventricular node
const probe = (node: number) => { const ts: number[] = []; for (let k = 0; k < o.recT.length; k++) if (o.recNode[k] === node) ts.push(o.recT[k]); return ts; };
const pr = m.probes.find((p) => p.id === "ra") ?? m.probes[1];
const a = probe(m.ectopicSites["ra-high"]);
const la = probe(m.ectopicSites["la"]);
const v = probe(m.ectopicSites["rv-apex"]);
const iv = (ts: number[]) => ts.slice(1).map((t, i) => Math.round(t - ts[i]));
console.log("RA-high act intervals:", iv(a.filter((t) => t > 1500)).join(" "));
console.log("LA act intervals     :", iv(la.filter((t) => t > 1500)).join(" "));
console.log("RV apex intervals    :", iv(v.filter((t) => t > 1500)).join(" "));
const origins: Record<string, number> = {};
for (const w of o.waves) origins[w.origin] = (origins[w.origin] ?? 0) + 1;
console.log("waves by origin", JSON.stringify(origins), "probe", pr?.id);
