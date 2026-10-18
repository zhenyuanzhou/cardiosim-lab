/**
 * The OLD global-threshold rule against the NEW adaptive one, both scored on the same simulator
 * labels. The old rule is reproduced here verbatim from v1.6 so the comparison is like for like.
 */
import { SCENARIOS } from "../../../src/simulation/scenarios/scenarios";
import { run } from "../../../tests/helpers/sim";
import { detectQrs } from "../../../src/simulation/ecg-forward/measurements";
import { N_CHANNELS } from "../../../src/simulation/ecg-forward/leadField";

const SLOPE_LEADS = [0, 1, 6, 7, 8, 9, 10, 11];
function slope(ecg: Float32Array, dt: number): Float32Array {
  const n = Math.floor(ecg.length / N_CHANNELS);
  const D = new Float32Array(n);
  for (let s = 1; s < n - 1; s++) {
    let d = 0;
    for (const l of SLOPE_LEADS) d += Math.abs(ecg[(s + 1) * N_CHANNELS + l] - ecg[(s - 1) * N_CHANNELS + l]) / (2 * dt);
    D[s] = d;
  }
  return D;
}
/** v1.6: candidates where D exceeds 30 % of its maximum over the WHOLE window. */
function legacyDetect(D: Float32Array, dt: number): [number, number][] {
  const n = D.length;
  let dMax = 0;
  for (let s = 0; s < n; s++) dMax = Math.max(dMax, D[s]);
  const thr = 0.3 * dMax;
  const runs: [number, number][] = [];
  let s = 0;
  while (s < n) {
    if (D[s] > thr) {
      const a = s;
      while (s < n && D[s] > thr) s++;
      const last = runs[runs.length - 1];
      if (last && (a - last[1]) * dt < 80) last[1] = s;
      else runs.push([a, s]);
    } else s++;
  }
  return runs;
}
const TOL = 80;
function score(runs: [number, number][], dt: number, labels: number[]) {
  const det = runs.map(([a]) => a * dt);
  const used = new Set<number>();
  let tp = 0;
  for (const l of labels) {
    let bi = -1, bd = TOL + 60;
    for (let i = 0; i < det.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(det[i] - l);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi >= 0) { used.add(bi); tp++; }
  }
  return { tp, fn: labels.length - tp, fp: det.length - tp };
}
let o = { tp: 0, fn: 0, fp: 0 };
let w = { tp: 0, fn: 0, fp: 0 };
const rows: string[] = [];
for (const sc of SCENARIOS) {
  if (!sc.apply) continue;
  const r = run(sc.apply(), 8000);
  const raw = r.out.waves.filter((x) => Number.isFinite(x.tFirstVent)).map((x) => x.tFirstVent).sort((a, b) => a - b);
  const labels = raw.filter((t, i) => i === 0 || t - raw[i - 1] > 80).filter((t) => t > 120 && t < 7900);
  const D = slope(r.out.ecg, r.sim.dt);
  const a = score(legacyDetect(D, r.sim.dt), r.sim.dt, labels);
  const b = score(detectQrs(D, r.sim.dt), r.sim.dt, labels);
  o = { tp: o.tp + a.tp, fn: o.fn + a.fn, fp: o.fp + a.fp };
  w = { tp: w.tp + b.tp, fn: w.fn + b.fn, fp: w.fp + b.fp };
  if (a.fn !== b.fn || a.fp !== b.fp) rows.push(`${sc.id.padEnd(22)} labels ${String(labels.length).padStart(3)} | old missed ${a.fn} extra ${a.fp} | new missed ${b.fn} extra ${b.fp}`);
}
console.log(rows.join("\n"));
const pct = (x: { tp: number; fn: number }) => (100 * x.tp) / (x.tp + x.fn);
console.log(`\nOLD (global threshold): ${o.tp} matched, ${o.fn} missed, ${o.fp} extra — sensitivity ${pct(o).toFixed(1)} %`);
console.log(`NEW (adaptive)        : ${w.tp} matched, ${w.fn} missed, ${w.fp} extra — sensitivity ${pct(w).toFixed(1)} %`);
