/**
 * Ventricular arrhythmia probe: npx tsx scripts/dev/vent.ts '<json overrides>' [ms] [stimJson]
 *
 * Reports ventricular activation intervals at several probes, wave origins, the number of
 * distinct re-entrant waves and whether activation is still going at the end of the run.
 * stimJson: {"node":"scar-border","times":[t0,t1,...]} for programmed stimulation.
 */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS } from "../../src/simulation/core/params";
import { CT } from "../../src/simulation/core/model";

const m = buildCardiacModel();
const over = JSON.parse(process.argv[2] ?? "{}");
const merged: Record<string, unknown> = JSON.parse(JSON.stringify(DEFAULT_PARAMS));
for (const [g, v] of Object.entries(over)) merged[g] = typeof v === "object" ? { ...(merged[g] as object), ...(v as object) } : v;
const T = +(process.argv[3] ?? 8000);
const stim = process.argv[4] ? JSON.parse(process.argv[4]) : null;

const sim = new Simulator(m, sanitizeParams(merged));
if (stim) {
  const node = typeof stim.node === "string" ? m.ectopicSites[stim.node] : stim.node;
  for (const t of stim.times as number[]) sim.stimulate(node, t);
}
sim.run(T);
const o = sim.drain();

const probe = (node: number) => {
  const ts: number[] = [];
  for (let k = 0; k < o.recT.length; k++) if (o.recNode[k] === node) ts.push(o.recT[k]);
  return ts;
};
const iv = (ts: number[], from = 0) => ts.filter((t) => t > from).slice(1).map((t, i, a2) => Math.round(t - ts.filter((x) => x > from)[i]));
const stats = (xs: number[]) => {
  if (!xs.length) return "none";
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return `n=${xs.length} mean=${mean.toFixed(0)} sd=${sd.toFixed(0)} cv=${((100 * sd) / mean).toFixed(0)}% min=${Math.min(...xs)} max=${Math.max(...xs)}`;
};

const after = T * 0.4;
for (const site of ["rv-apex", "lv-lateral", "lv-apex", "rvot", "septum"]) {
  const node = m.ectopicSites[site];
  if (node === undefined) continue;
  console.log(`${site.padEnd(12)} ${stats(iv(probe(node), after))}`);
}

const origins: Record<string, number> = {};
for (const w of o.waves) origins[w.origin] = (origins[w.origin] ?? 0) + 1;
console.log("waves by origin", JSON.stringify(origins));

// ventricular activation density over time (how much tissue is activating per 100 ms window)
const bins = new Map<number, number>();
let lastVentT = 0;
for (let k = 0; k < o.recT.length; k++) {
  if (m.cellType[o.recNode[k]] !== CT.VENTRICULAR) continue;
  lastVentT = Math.max(lastVentT, o.recT[k]);
  const b = Math.floor(o.recT[k] / 500);
  bins.set(b, (bins.get(b) ?? 0) + 1);
}
const nv = [...Array(Math.ceil(T / 500)).keys()].map((b) => bins.get(b) ?? 0);
console.log("vent activations / 500 ms:", nv.join(" "));
console.log("last ventricular activation:", lastVentT.toFixed(0), "of", T, "| sustained:", lastVentT > T - 300);
