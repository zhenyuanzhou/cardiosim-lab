/**
 * Drug calibration against Johannesen et al. 2014 (Clin Pharmacol Ther 96:549): measure QT, J–Tpeak and
 * Tpeak–Tend (vector magnitude of the heart vector, like the study's global measures) for a uniform
 * APD shift Δa (ms) and a phase-3 width scale w. usage: tsx drug-cal.ts "da1,da2" "w1,w2"
 */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { DEFAULT_PARAMS, cloneParams, type SimParams } from "../../src/simulation/core/params";
import { N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";
const m = buildCardiacModel();
export function repol(p: SimParams) {
  const sim = new Simulator(m, p); sim.run(7000); const o = sim.drain(); const dt = sim.dt;
  const beats = measureBeats(o.ecg, dt, 0, o.waves).slice(1, -1);
  const vm = (t: number) => { const i = Math.round(t / dt) * N_CHANNELS; return Math.hypot(o.ecg[i + 12], o.ecg[i + 13], o.ecg[i + 14]); };
  const r = beats.map((b: any) => {
    const J = b.qrsOff, Te = b.qrsOn + b.qt; let tp = J + 40, best = -1;
    for (let t = J + 40; t < Te; t += dt) { const v = vm(t); if (v > best) { best = v; tp = t; } }
    return { qt: b.qt, jtp: tp - J, tpte: Te - tp, pr: b.pr, qrs: b.qrs };
  });
  const med = (k: string) => { const v = r.map((x: any) => x[k]).filter(Number.isFinite).sort((a: number, b: number) => a - b); return v[v.length >> 1]; };
  return { qt: med("qt"), jtp: med("jtp"), tpte: med("tpte"), pr: med("pr"), qrs: med("qrs") };
}
if (process.argv[1].endsWith("drug-cal.ts")) {
  const base = repol(cloneParams(DEFAULT_PARAMS));
  console.log("baseline", base);
  for (const da of (process.argv[2] ?? "0").split(",").map(Number)) for (const w of (process.argv[3] ?? "1").split(",").map(Number)) {
    const p = cloneParams(DEFAULT_PARAMS); p.ventricles.apd += da; p.ventricles.phase3Scale = w;
    const r = repol(p);
    console.log(`da=${da} w=${w}: dQT ${r.qt - base.qt} dJTp ${r.jtp - base.jtp} dTpTe ${r.tpte - base.tpte}`);
  }
}
