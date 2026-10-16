/**
 * Scar re-entry diagnostics: npx tsx scripts/dev/scar.ts '<json>' [ms] [stimJson]
 * Reports isthmus / border activation timing so the circuit can be reasoned about.
 */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS } from "../../src/simulation/core/params";

const m = buildCardiacModel();
const over = JSON.parse(process.argv[2] ?? "{}");
const merged: Record<string, unknown> = JSON.parse(JSON.stringify(DEFAULT_PARAMS));
for (const [g, v] of Object.entries(over)) merged[g] = typeof v === "object" ? { ...(merged[g] as object), ...(v as object) } : v;
const T = +(process.argv[3] ?? 10000);
const stim = process.argv[4] ? JSON.parse(process.argv[4]) : null;

const S = m.substrates;
const isth = Array.from(S.scarIsthmus ?? []);
const border = Array.from(S.scarBorder ?? []);
const core = Array.from(S.scarCore ?? []);
console.log(`substrate sizes: core=${core.length} isthmus=${isth.length} border=${border.length} purk=${(S.scarPurkinje ?? []).length}`);

// order isthmus nodes along the isthmus axis using positions
const pos = (i: number) => [m.pos[3 * i], m.pos[3 * i + 1], m.pos[3 * i + 2]] as const;
if (isth.length) {
  const a = pos(isth[0]);
  const far = isth.reduce((best, i) => (Math.hypot(...pos(i).map((v, k) => v - a[k]) as unknown as [number, number, number]) > Math.hypot(...pos(best).map((v, k) => v - a[k]) as unknown as [number, number, number]) ? i : best), isth[0]);
  const fp = pos(far);
  const len = Math.hypot(fp[0] - a[0], fp[1] - a[1], fp[2] - a[2]);
  console.log(`isthmus extent ≈ ${len.toFixed(1)} mm`);
}

const sim = new Simulator(m, sanitizeParams(merged));
if (stim) {
  const node = typeof stim.node === "string" ? m.ectopicSites[stim.node] : stim.node;
  for (const t of stim.times as number[]) sim.stimulate(node, t);
}
sim.run(T);
const o = sim.drain();

const setI = new Set(isth);
const setB = new Set(border);
const evI: number[] = [];
const evB: number[] = [];
for (let k = 0; k < o.recT.length; k++) {
  if (setI.has(o.recNode[k])) evI.push(o.recT[k]);
  if (setB.has(o.recNode[k])) evB.push(o.recT[k]);
}
const burstsOf = (ts: number[]) => {
  ts.sort((x, y) => x - y);
  const out: [number, number, number][] = [];
  let s = ts[0], last = ts[0], n = 0;
  for (const t of ts) {
    if (t - last > 120) {
      out.push([s, last, n]);
      s = t;
      n = 0;
    }
    last = t;
    n++;
  }
  if (ts.length) out.push([s, last, n]);
  return out;
};
if (evI.length) {
  const b = burstsOf(evI);
  console.log(`isthmus activations: ${evI.length} in ${b.length} bursts`);
  console.log("  bursts (start→end, n):", b.slice(-14).map(([s, e, n]) => `${s.toFixed(0)}→${e.toFixed(0)}(${n})`).join(" "));
  const starts = b.map(([s]) => s);
  console.log("  burst-to-burst CL:", starts.slice(1).map((s, i) => Math.round(s - starts[i])).slice(-14).join(" "));
} else console.log("isthmus never activated");
if (evB.length) {
  const b = burstsOf(evB);
  const starts = b.map(([s]) => s);
  console.log(`border bursts: ${b.length}; CL:`, starts.slice(1).map((s, i) => Math.round(s - starts[i])).slice(-14).join(" "));
}
const origins: Record<string, number> = {};
for (const w of o.waves) origins[w.origin] = (origins[w.origin] ?? 0) + 1;
console.log("waves by origin", JSON.stringify(origins));
