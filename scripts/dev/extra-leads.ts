import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { N_CHANNELS, ALL_LEAD_NAMES, channelOf } from "../../src/simulation/ecg-forward/leadField";
const m = buildCardiacModel(); const sim = new Simulator(m, cloneParams(DEFAULT_PARAMS)); sim.run(2000); const o = sim.drain();
const w = o.waves.filter((x) => Number.isFinite(x.tFirstVent))[0]; const a = Math.round((w.tFirstVent - 10) / 2), b = Math.round((w.tLastVent + 5) / 2), c = a + 200;
for (const n of ALL_LEAD_NAMES) { const ch = channelOf(n); let R = 0, S = 0, T = 0; for (let i = a; i < b; i++) { R = Math.max(R, o.ecg[i * N_CHANNELS + ch]); S = Math.min(S, o.ecg[i * N_CHANNELS + ch]); } for (let i = b; i < c; i++) if (Math.abs(o.ecg[i * N_CHANNELS + ch]) > Math.abs(T)) T = o.ecg[i * N_CHANNELS + ch]; console.log(n.padEnd(4), `R ${R.toFixed(2)} S ${S.toFixed(2)} T ${T.toFixed(2)}`); }
