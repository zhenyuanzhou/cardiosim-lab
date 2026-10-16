import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField, precordialPositions, CHEST, N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
const m = buildCardiacModel(); const base = { ...CHEST };
const TG = { V1R: 0.126, V2R: 0.351, V2S: 0.937, V3R: 0.705, V4S: 0.332, V6R: 1.083 };
const p = cloneParams(DEFAULT_PARAMS); p.forward.precordialGain = 1;
for (const dz of (process.argv[2] ?? "10,20,30,40").split(",").map(Number)) for (const rot of (process.argv[3] ?? "-30,-40,-50").split(",").map(Number)) {
  Object.assign(CHEST, base, { halfDepth: base.halfDepth + dz }); const th = rot * Math.PI / 180;
  const pos = precordialPositions().map(([x, y, z]) => [x * Math.cos(th) - z * Math.sin(th), y, x * Math.sin(th) + z * Math.cos(th)] as [number, number, number]);
  const sim = new Simulator(m, p, computeLeadField(m, pos)); sim.run(1800); const o = sim.drain(); const e = o.ecg;
  const v = o.waves.filter((w) => Number.isFinite(w.tFirstVent))[0]; const q0 = Math.round(v.tFirstVent / 2) - 10, q1 = Math.round(v.tLastVent / 2) + 5, t1 = q0 + 230;
  const a = [0,1,2,3,4,5].map((k) => { const c = 6 + k; let R = 0, S = 0, T = 0; for (let i = q0; i < q1; i++) { R = Math.max(R, e[i*N_CHANNELS+c]); S = Math.min(S, e[i*N_CHANNELS+c]); } for (let i = q1; i < t1; i++) if (Math.abs(e[i*N_CHANNELS+c]) > Math.abs(T)) T = e[i*N_CHANNELS+c]; return { R, S: -S, T }; });
  const mod = { V1R: a[0].R, V2R: a[1].R, V2S: a[1].S, V3R: a[2].R, V4S: a[3].S, V6R: a[5].R };
  // log-ratio fit of a single gain g: minimise Σ (ln g·m − ln t)²
  const ks = Object.keys(TG) as (keyof typeof TG)[]; const lg = ks.reduce((s, k) => s + Math.log(TG[k] / Math.max(1e-3, mod[k])), 0) / ks.length; const g = Math.exp(lg);
  const err = Math.sqrt(ks.reduce((s, k) => s + Math.log(g * mod[k] / TG[k]) ** 2, 0) / ks.length);
  console.log(`depth+${dz} rot${rot} gain=${g.toFixed(2)} rmsLogErr=${err.toFixed(2)} | ` + a.map((x, k) => `V${k+1} ${(g*x.R).toFixed(2)}/${(-g*x.S).toFixed(2)} T${(g*x.T).toFixed(2)}`).join(" "));
}
