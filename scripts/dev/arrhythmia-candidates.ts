/**
 * Named candidate configurations for VF, polymorphic VT and torsades, each measured against its
 * clinical target. Burst cycle lengths are set just above the substrate's refractory period
 * (ERP ≈ erpRatio × apdFloor × APDref), because a burst faster than ERP cannot capture.
 *
 * Torsades is initiated mechanistically — a late-coupled (R-on-T) beat at the EAD coupling
 * interval measured in the ionic cell — rather than by a burst, which is how it starts clinically.
 */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams, type SimParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";
import { CT } from "../../src/simulation/core/model";

const m = buildCardiacModel();
const W = computeLeadField(m);
const T = 14000;
const BURST = 3000;

function base(floor: number, het: number, apdScale = 1): SimParams {
  const p = cloneParams(DEFAULT_PARAMS);
  p.restitution.apdFloor = floor;
  p.ventricles.heterogeneity = het;
  if (apdScale !== 1) {
    p.ventricles.apd = Math.round(p.ventricles.apd * apdScale);
    p.ventricles.transmuralGradient = Math.round(p.ventricles.transmuralGradient * apdScale);
    p.ventricles.apicobasalGradient = Math.round(p.ventricles.apicobasalGradient * apdScale);
  }
  return sanitizeParams(p as unknown as Record<string, unknown>);
}

function measure(name: string, p: SimParams, burst: { site: string; n: number; cycle: number } | null, target: string) {
  const sim = new Simulator(m, p, W);
  let after = 2000;
  if (burst) {
    const node = m.ectopicSites[burst.site];
    for (let i = 0; i < burst.n; i++) sim.stimulate(node, BURST + i * burst.cycle);
    after = BURST + burst.n * burst.cycle + 400;
  }
  sim.run(T);
  const o = sim.drain();
  let lastVent = 0;
  let re = 0;
  for (let k = 0; k < o.recT.length; k++) if (m.cellType[o.recNode[k]] === CT.VENTRICULAR) lastVent = Math.max(lastVent, o.recT[k]);
  for (const w of o.waves) if (w.origin === "reentry") re++;
  const acts = o.waves.filter((w) => Number.isFinite(w.tFirstVent) && w.tFirstVent > after).map((w) => w.tFirstVent).sort((a, b) => a - b);
  const ivs = acts.slice(1).map((t, i) => t - acts[i]);
  const mean = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : NaN;
  const sd = ivs.length ? Math.sqrt(ivs.reduce((a, b) => a + (b - mean) ** 2, 0) / ivs.length) : NaN;
  const mo = analyseMorphology(o.ecg, sim.dt, acts);
  const erp = 0.92 * p.restitution.apdFloor * p.ventricles.apd;
  // baseline QT before any intervention
  const b0 = new Simulator(m, p, W);
  b0.run(4000);
  const q = measureBeats(b0.drain().ecg, b0.dt, 0).map((b) => b.qt).filter((x): x is number => x !== null).sort((a, b) => a - b);
  console.log(
    `${name.padEnd(22)} ERP≈${erp.toFixed(0)} QT0=${q.length ? q[Math.floor(q.length / 2)].toFixed(0) : "–"} | sust=${String(lastVent > T - 400).padEnd(5)} end=${(lastVent / 1000).toFixed(1)}s CL=${mean.toFixed(0)} var=${((100 * sd) / mean).toFixed(0)}% n=${acts.length} re=${re} disp=${mo.axisDispersion.toFixed(0)}° rot=${mo.meanRotation.toFixed(0)}°/beat cons=${(100 * mo.rotationConsistency).toFixed(0)}%\n${" ".repeat(24)}target: ${target}`,
  );
}

// --- VF: the configuration tuned against Nair 2012 (CL 218 ± 24 ms) -----------------
measure("VF floor.79 het.20", base(0.79, 0.2), { site: "rv-apex", n: 14, cycle: 240 }, "CL 218±24 ms, irregular, sustained, many wavelets");
measure("VF floor.79 het.30", base(0.79, 0.3), { site: "rv-apex", n: 14, cycle: 240 }, "as above");

// --- Polymorphic VT: less heterogeneity, slower substrate ---------------------------
measure("PVT floor.70 het.15", base(0.7, 0.15), { site: "lv-lateral", n: 10, cycle: 220 }, "CL 240–300 ms, changing QRS, fewer wavelets");
measure("PVT floor.79 het.15", base(0.79, 0.15), { site: "lv-lateral", n: 10, cycle: 240 }, "as above");

// --- Torsades: long QT, R-on-T initiation (no burst) --------------------------------
for (const [floor, het] of [[0.7, 0.2], [0.79, 0.2], [0.79, 0.3]] as const) {
  const p = base(floor, het, 1.173);
  p.ectopy = { ...p.ectopy, site: "lv-lateral", pattern: "bigeminy", coupling: 390 };
  measure(`TdP floor${floor} het${het}`, p, null, "long QT, CL 240–375 ms, axis rotates consistently");
}
console.log("candidates complete");
