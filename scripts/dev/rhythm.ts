/** Beat-by-beat trace of waves for a parameter override: npx tsx scripts/dev/rhythm.ts '{"ectopy":{...}}' [ms] */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS } from "../../src/simulation/core/params";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";
const m = buildCardiacModel();
const over = JSON.parse(process.argv[2] ?? "{}");
const merged: Record<string, unknown> = JSON.parse(JSON.stringify(DEFAULT_PARAMS));
for (const [g, v] of Object.entries(over)) merged[g] = typeof v === "object" ? { ...(merged[g] as object), ...(v as object) } : v;
const sim = new Simulator(m, sanitizeParams(merged));
const T = +(process.argv[3] ?? 8000);
sim.run(T);
const out = sim.drain();
const f = (v: number) => (Number.isFinite(v) ? v.toFixed(0).padStart(6) : "     -");
console.log("  id origin        site            t0    A1st  AVNin AVNout path      H     V1st  Vlast  ap   flags");
for (const w of out.waves.sort((a, b) => a.t0 - b.t0)) {
  console.log(
    String(w.id).padStart(4), w.origin.padEnd(13), (w.site || "").padEnd(14), f(w.t0), f(w.tFirstAtrial), f(w.tAvnIn), f(w.tAvnOut), (w.avnPath || "").padEnd(8), f(w.tHisProximal), f(w.tFirstVent), f(w.tLastVent), f(w.tApOut),
    [w.avnBlocked && "AVblk", w.infraHisBlocked && "IHblk", w.saExitBlocked && "SAEB", w.parent >= 0 && `parent ${w.parent}`].filter(Boolean).join(" "),
  );
}
const beats = measureBeats(out.ecg, sim.dt, 0, out.waves);
console.log("QRSon:", beats.map((b) => b.qrsOn.toFixed(0)).join(" "));
console.log("QRSd :", beats.map((b) => b.qrs.toFixed(0)).join(" "), " axis:", beats.map((b) => b.axisQRS.toFixed(0)).join(" "));
console.log("PR   :", beats.map((b) => (b.pr ?? NaN).toFixed(0)).join(" "));
