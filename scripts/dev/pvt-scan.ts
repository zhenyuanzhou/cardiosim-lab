/**
 * Candidate substrates for polymorphic VT and torsades de pointes.
 *
 * Clinical targets:
 *   Polymorphic VT  — wide-complex tachycardia with a continuously changing QRS, typically
 *                     200–250 /min (CL 240–300 ms).
 *   Torsades        — polymorphic VT on a LONG QT background, 160–250 /min (CL 240–375 ms),
 *                     with the axis rotating progressively ("twisting"), usually non-sustained
 *                     and initiated by a pause/R-on-T sequence.
 *
 * Reported per run: cycle length, beat-to-beat variability, axis dispersion (monomorphic rhythms
 * sit near 0°), net axis rotation per beat and how consistently it keeps the same direction.
 */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
import { CT } from "../../src/simulation/core/model";

const m = buildCardiacModel();
const W = computeLeadField(m);
const T = 12000;
const BURST = 3000;

interface Opt {
  floor: number;
  het: number;
  apdScale: number;
  site: string;
  nb: number;
  cycle: number;
}

function run(o: Opt) {
  const p = cloneParams(DEFAULT_PARAMS);
  p.restitution.apdFloor = o.floor;
  p.ventricles.heterogeneity = o.het;
  p.ventricles.apd = Math.round(p.ventricles.apd * o.apdScale);
  p.ventricles.transmuralGradient = Math.round(p.ventricles.transmuralGradient * o.apdScale);
  p.ventricles.apicobasalGradient = Math.round(p.ventricles.apicobasalGradient * o.apdScale);
  const sim = new Simulator(m, sanitizeParams(p as unknown as Record<string, unknown>), W);
  const node = m.ectopicSites[o.site];
  for (let i = 0; i < o.nb; i++) sim.stimulate(node, BURST + i * o.cycle);
  sim.run(T);
  const out = sim.drain();
  const after = BURST + o.nb * o.cycle + 400;
  let lastVent = 0;
  let re = 0;
  for (let k = 0; k < out.recT.length; k++) if (m.cellType[out.recNode[k]] === CT.VENTRICULAR) lastVent = Math.max(lastVent, out.recT[k]);
  for (const w of out.waves) if (w.origin === "reentry") re++;
  const acts = out.waves.filter((w) => Number.isFinite(w.tFirstVent) && w.tFirstVent > after).map((w) => w.tFirstVent).sort((a, b) => a - b);
  const ivs = acts.slice(1).map((t, i) => t - acts[i]);
  const mean = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : NaN;
  const sd = ivs.length ? Math.sqrt(ivs.reduce((a, b) => a + (b - mean) ** 2, 0) / ivs.length) : NaN;
  const mo = analyseMorphology(out.ecg, sim.dt, acts);
  return {
    sustained: lastVent > T - 400,
    lastVent,
    cl: mean,
    cvPct: (100 * sd) / mean,
    n: acts.length,
    re,
    disp: mo.axisDispersion,
    rot: mo.meanRotation,
    cons: mo.rotationConsistency,
  };
}

const opts: Opt[] = [];
for (const floor of [0.6, 0.7, 0.79])
  for (const het of [0.15, 0.25, 0.35])
    for (const apdScale of [1.0, 1.173])
      opts.push({ floor, het, apdScale, site: "lv-lateral", nb: 14, cycle: 200 });

for (const o of opts) {
  const r = run(o);
  const tag = r.cl >= 230 && r.cl <= 380 && r.disp > 25 ? "  <== PVT/TdP-LIKE" : "";
  console.log(
    `floor=${o.floor} het=${o.het} apd×${o.apdScale} -> sust=${r.sustained} end=${r.lastVent.toFixed(0)} CL=${r.cl.toFixed(0)} var=${r.cvPct.toFixed(0)}% n=${r.n} re=${r.re} disp=${r.disp.toFixed(0)}° rot=${r.rot.toFixed(0)}°/beat cons=${(100 * r.cons).toFixed(0)}%${tag}`,
  );
}
console.log("pvt scan complete");
