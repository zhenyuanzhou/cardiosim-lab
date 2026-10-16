/**
 * Fit the idealised heart orientation + chest depth so that the sinus-rhythm QRS amplitudes match
 * population medians (Cleveland Family Study, visit 5, n = 732) and T waves are upright where they
 * are normally upright. usage: tsx geom-fit.ts "ant1,ant2" "spin1,spin2" "depth1,depth2" [frontal]
 */
import { ANATOMY, makeFrame } from "../../src/simulation/tissue/anatomy";
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField, precordialPositions, CHEST, N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
import { cross, normalize, scale, add, dot, type Vec3 } from "../../src/simulation/core/vec";
const TG: Record<string, number> = { V1R: 0.126, V2R: 0.351, V2S: 0.937, V3R: 0.705, V4S: 0.332, V6R: 1.083 };
const IR = 0.751; let nBuild = 0;
const base = { ...CHEST }; const sd0 = [...ANATOMY.septalDir] as Vec3; const ant0 = ANATOMY.axisAnteriorDeg, fr0 = ANATOMY.axisFrontalDeg;
const list = (s: string | undefined, d: string) => (s ?? d).split(",").map(Number);
const rot = (v: Vec3, k: Vec3, a: number): Vec3 => add(add(scale(v, Math.cos(a)), scale(cross(k, v), Math.sin(a))), scale(k, dot(k, v) * (1 - Math.cos(a))));
export function evalGeom(ant: number, spin: number, depth: number, frontal = fr0, verbose = false) {
  ANATOMY.axisAnteriorDeg = ant; ANATOMY.axisFrontalDeg = frontal; ANATOMY.septalDir = sd0 as any;
  const f = makeFrame(); ANATOMY.septalDir = rot(sd0, f.d, (spin * Math.PI) / 180) as any;
  Object.assign(CHEST, base, { halfDepth: base.halfDepth + depth });
  const m = buildCardiacModel(2.5 + 1e-9 * ++nBuild); const W = computeLeadField(m, precordialPositions());
  const p = cloneParams(DEFAULT_PARAMS); p.forward.precordialGain = 1; p.forward.limbGain = 1;
  const sim = new Simulator(m, p, W); sim.run(1800); const o = sim.drain(); const e = o.ecg;
  const v = o.waves.filter((w) => Number.isFinite(w.tFirstVent))[0]; const q0 = Math.round(v.tFirstVent / 2) - 10, q1 = Math.round(v.tLastVent / 2) + 5, t1 = q0 + 230;
  const a = Array.from({ length: 12 }, (_, c) => { let R = 0, S = 0, T = 0; for (let i = q0; i < q1; i++) { R = Math.max(R, e[i*N_CHANNELS+c]); S = Math.min(S, e[i*N_CHANNELS+c]); } for (let i = q1; i < t1; i++) if (Math.abs(e[i*N_CHANNELS+c]) > Math.abs(T)) T = e[i*N_CHANNELS+c]; return { R, S: -S, T }; });
  const mod: Record<string, number> = { V1R: a[6].R, V2R: a[7].R, V2S: a[7].S, V3R: a[8].R, V4S: a[9].S, V6R: a[11].R };
  const ks = Object.keys(TG); const g = Math.exp(ks.reduce((s, k) => s + Math.log(TG[k] / Math.max(1e-3, mod[k])), 0) / ks.length);
  const err = Math.sqrt(ks.reduce((s, k) => s + Math.log((g * mod[k]) / TG[k]) ** 2, 0) / ks.length);
  const lg = IR / a[0].R;
  // QRS axis from net area isn't needed here; report peak-based frontal direction of R
  const tNeg = [9, 10, 11].filter((c) => a[c].T < 0).length + [0, 1].filter((c) => a[c].T < 0).length;
  const line = `ant=${ant} spin=${spin} depth=${depth} fr=${frontal} | chestGain=${g.toFixed(2)} err=${err.toFixed(2)} limbGain=${lg.toFixed(2)} negT(I,II,V4-6)=${tNeg} | ` +
    ["I", "II", "III"].map((n, c) => `${n} ${(lg*a[c].R).toFixed(2)}/${(-lg*a[c].S).toFixed(2)} T${(lg*a[c].T).toFixed(2)}`).join(" ") + " | " +
    a.slice(6).map((x, k) => `V${k+1} ${(g*x.R).toFixed(2)}/${(-g*x.S).toFixed(2)} T${(g*x.T).toFixed(2)}`).join(" ");
  if (verbose) console.log(line);
  return { err, tNeg, g, lg, line };
}
if (process.argv[1].endsWith("geom-fit.ts")) {
  for (const ant of list(process.argv[2], "30")) for (const spin of list(process.argv[3], "0")) for (const d of list(process.argv[4], "0"))
    evalGeom(ant, spin, d, process.argv[5] ? +process.argv[5] : fr0, true);
}
