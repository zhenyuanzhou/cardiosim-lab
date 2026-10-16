/** NSR precordial R/S/T amplitudes vs chest geometry (electrode distance from the heart). */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField, precordialPositions, CHEST, N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
const m = buildCardiacModel();
const L = ["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"];
function amps(W: Float32Array, gain?: number) {
  const p = cloneParams(DEFAULT_PARAMS); if (gain) p.forward.precordialGain = gain;
  const sim = new Simulator(m, p, W); sim.run(1800); const o = sim.drain(); const e = o.ecg;
  const v = o.waves.filter((w) => Number.isFinite(w.tFirstVent))[0]; const q0 = Math.round(v.tFirstVent / 2) - 10, q1 = Math.round(v.tLastVent / 2) + 5, t1 = q0 + 230;
  return L.map((_, c) => { let R = 0, S = 0, T = 0; for (let i = q0; i < q1; i++) { R = Math.max(R, e[i*N_CHANNELS+c]); S = Math.min(S, e[i*N_CHANNELS+c]); } for (let i = q1; i < t1; i++) if (Math.abs(e[i*N_CHANNELS+c]) > Math.abs(T)) T = e[i*N_CHANNELS+c]; return [R, S, T]; });
}
const base = { ...CHEST };
const cfgs = (process.argv[2] ?? "0,0").split(";").map((s) => s.split(",").map(Number));
for (const [dz, dx, rotDeg = 0, gain = 0] of cfgs) {
  Object.assign(CHEST, base, { centerZ: base.centerZ + 0, halfDepth: base.halfDepth + dz, midlineX: base.midlineX + dx });
  const th = (rotDeg * Math.PI) / 180;
  const pos = precordialPositions().map(([x, y, z]) => [x * Math.cos(th) - z * Math.sin(th), y, x * Math.sin(th) + z * Math.cos(th)] as [number, number, number]);
  const W = computeLeadField(m, pos);
  const a = amps(W, gain || undefined);
  console.log(`depth+${dz} midline+${dx} rot${rotDeg}: ` + a.slice(6).map((x, k) => `V${k+1} R${x[0].toFixed(2)} S${x[1].toFixed(2)} T${x[2].toFixed(2)}`).join(" | "));
}
// ---- fit: CFS medians (sleepdata.org, Cleveland Family Study visit 5, n = 732), mV
export const TARGET = { V1R: 0.126, V2R: 0.351, V2S: 0.937, V3R: 0.705, V4S: 0.332, V6R: 1.083 };
