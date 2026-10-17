/**
 * Can torsades EMERGE in this engine, instead of being imposed?
 *
 * Mechanism under test (the consensus account): on a long-QT substrate with an increased spatial
 * dispersion of repolarisation, an EAD-triggered beat falls on the repolarisation gradient, blocks in
 * the regions that are still refractory, conducts in those that have recovered, and the wavefront
 * curls round the block line into functional re-entry. The resulting rotor is unstable and drifts, and
 * the drift is what twists the QRS axis.
 *
 * The script fires S2 (and optionally S3) after a sinus beat and reports whether re-entry followed,
 * how many wavefronts coexisted (1–2 = organised torsades; many = fibrillation), and the torsades
 * metrics. usage: tsx tdp-emergent.ts <mode> ...
 */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator, type SimOutput } from "../../src/simulation/core/engine";
import { DEFAULT_PARAMS, cloneParams, type SimParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { tdpMetrics, formatMetrics, runWindow } from "../../src/simulation/ecg-forward/tdpMetrics";

const model = buildCardiacModel();
const W = computeLeadField(model);

let sinusTimes: number[] | null = null;
function sinusQrsBefore(t: number): number {
  if (!sinusTimes) {
    const sim = new Simulator(model, cloneParams(DEFAULT_PARAMS), W);
    sim.run(20000);
    sinusTimes = sim
      .drain()
      .waves.filter((w) => Number.isFinite(w.tFirstVent))
      .map((w) => w.tFirstVent)
      .sort((a, b) => a - b);
  }
  let best = sinusTimes[0];
  for (const x of sinusTimes) if (x <= t) best = x;
  return best;
}

export interface Setup {
  /** Ventricular APD multiplier (long QT). */
  apd: number;
  /** Transmural + apicobasal gradient multiplier (dispersion of repolarisation). */
  grad: number;
  /** restitution.apdFloor — sets the cycle length of any functional re-entry. */
  floor: number;
  /** Ventricular CV multiplier. */
  cv: number;
  /** Seeded APD heterogeneity (SD). */
  het: number;
  /** S2 coupling interval (ms after the preceding QRS onset). */
  s2: number;
  /** S2 site. */
  site: string;
  /** S3 coupling after S2 (0 = none). */
  s3?: number;
  /** S3 site (default: same as S2). */
  site3?: string;
  erp?: number;
  /** M-cell island amplitude (ms of extra APD at its centre). */
  mBoost?: number;
  phiSd?: number;
  longSd?: number;
  smooth?: number;
}

export function setupParams(s: Setup): SimParams {
  const p = cloneParams(DEFAULT_PARAMS);
  p.ventricles.apd = Math.round(p.ventricles.apd * s.apd);
  p.ventricles.transmuralGradient = Math.round(p.ventricles.transmuralGradient * s.apd * s.grad);
  p.ventricles.apicobasalGradient = Math.round(p.ventricles.apicobasalGradient * s.apd * s.grad);
  p.restitution.apdFloor = s.floor;
  p.ventricles.cvLongitudinal = +(p.ventricles.cvLongitudinal * s.cv).toFixed(3);
  p.ventricles.heterogeneity = s.het;
  if (s.erp) p.ventricles.erpRatio = s.erp;
  if (s.mBoost !== undefined) p.ventricles.mCellBoost = s.mBoost;
  if (s.phiSd !== undefined) p.ventricles.mCellPhiSd = s.phiSd;
  if (s.longSd !== undefined) p.ventricles.mCellLongSd = s.longSd;
  if (s.smooth !== undefined) p.ventricles.electrotonicSmoothing = s.smooth;
  return p;
}

/** Fire S2/S3 as externally injected stimuli at the given sites, timed from a sinus QRS. */
export function runEmergent(s: Setup, ms = 12000, tS1 = 3000): { out: SimOutput; dt: number; t2: number } {
  const p = setupParams(s);
  const sim = new Simulator(model, p, W);
  // Sinus QRS onsets are set by the SA node and the conduction system, so they do not depend on the
  // ventricular substrate: the last one at or before tS1 is taken from a cached baseline run.
  const q = sinusQrsBefore(tS1);
  const t2 = q + s.s2;
  sim.stimulate(model.ectopicSites[s.site], t2);
  if (s.s3) sim.stimulate(model.ectopicSites[s.site3 ?? s.site], t2 + s.s3);
  sim.run(ms);
  return { out: sim.drain(), dt: sim.dt, t2 };
}

/** Mean number of distinct wavefronts alive at the same time (1–2 organised, > 4 fibrillatory). */
export function wavefronts(o: SimOutput, t0: number, t1: number, life = 25): { mean: number; max: number } {
  const act: { t: number; w: number }[] = [];
  for (let k = 0; k < o.recT.length; k++) if (o.recT[k] >= t0 - life && o.recT[k] <= t1) act.push({ t: o.recT[k], w: o.recWave[k] });
  act.sort((a, b) => a.t - b.t);
  let i = 0;
  let j = 0;
  const counts: number[] = [];
  for (let t = t0; t < t1; t += 10) {
    while (j < act.length && act[j].t <= t) j++;
    while (i < act.length && act[i].t < t - life) i++;
    const s = new Set<number>();
    for (let k = i; k < j; k++) s.add(act[k].w);
    counts.push(s.size);
  }
  if (!counts.length) return { mean: 0, max: 0 };
  return { mean: counts.reduce((a, b) => a + b, 0) / counts.length, max: Math.max(...counts) };
}

export function evaluate(s: Setup, ms = 12000) {
  const { out, dt, t2 } = runEmergent(s, ms);
  const vent = out.waves.filter((w) => Number.isFinite(w.tFirstVent) && w.tFirstVent > t2 - 5).sort((a, b) => a.tFirstVent - b.tFirstVent);
  const re = out.waves.filter((w) => w.origin === "reentry" && w.tFirstVent > t2);
  // the arrhythmia: activations after the last injected stimulus, until a gap > 600 ms
  const after = vent.filter((w) => w.tFirstVent > t2 + (s.s3 ?? 0) + 20);
  let end = t2 + (s.s3 ?? 0);
  for (const w of after) {
    if (w.tFirstVent - end > 600) break;
    end = w.tFirstVent;
  }
  const dur = end - t2;
  const beats = after.filter((w) => w.tFirstVent <= end).length;
  const wf = dur > 400 ? wavefronts(out, t2, end) : { mean: 0, max: 0 };
  return { dur, beats, re: re.length, wf, out, dt, t2, end };
}

if (process.argv[1].endsWith("tdp-emergent.ts")) await (async () => {
  const mode = process.argv[2] ?? "scan";
  const list = (s: string | undefined, d: string) => (s ?? d).split(",").map(Number);
  if (mode === "apd") {
    // the dispersion of repolarisation this substrate actually produces
    const { derive } = await import("../../src/simulation/core/derive");
    const d = derive(model, setupParams({ apd: 1.3, grad: +(process.argv[3] ?? 2.5), floor: 0.45, cv: 1, het: 0, s2: 0, site: "lv-apex" }));
    const names = Object.keys(model.ectopicSites);
    for (const n of names) {
      const i = model.ectopicSites[n];
      if (model.cellType[i] !== 5) continue;
      console.log(`${n.padEnd(16)} APDref ${d.apdRef[i].toFixed(0)} ms  ERP ${(d.apdRef[i] * d.erpRatio[i]).toFixed(0)} ms  (transmural ${model.transmural[i].toFixed(2)}, apicobasal ${model.apicobasal[i].toFixed(2)})`);
    }
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < model.n; i++) if (model.cellType[i] === 5) { lo = Math.min(lo, d.apdRef[i]); hi = Math.max(hi, d.apdRef[i]); }
    console.log(`ventricular APDref range ${lo.toFixed(0)}–${hi.toFixed(0)} ms (dispersion ${(hi - lo).toFixed(0)} ms)`);
  }
  if (mode === "scan") {
    const sites = (process.argv[8] ?? "lv-apex").split(",");
    for (const mBoost of list(process.argv[3], "120"))
      for (const floor of list(process.argv[4], "0.45"))
        for (const cv of list(process.argv[5], "1"))
          for (const het of list(process.argv[6], "0"))
            for (const s2 of list(process.argv[7], "320,360,400"))
              for (const site of sites) {
                const grad = 1;
                const s: Setup = { apd: 1.3, grad, floor, cv, het, s2, site, mBoost };
                const r = evaluate(s, 9000);
                if (r.dur > 400)
                  console.log(
                    `mBoost${mBoost} floor${floor} cv${cv} het${het} s2=${s2} ${site}: dur ${r.dur.toFixed(0)} ms, ${r.beats} beats, re ${r.re}, wavefronts ${r.wf.mean.toFixed(1)} (max ${r.wf.max})`,
                  );
              }
  }
})();
