/** Split a scenario's ECG into atrial-only and ventricular-only contributions (lead-field rows zeroed). */
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams } from "../../src/simulation/core/params";
import { computeLeadField, N_CHANNELS, N_COLS } from "../../src/simulation/ecg-forward/leadField";
import { CT } from "../../src/simulation/core/model";
import { writeFileSync } from "node:fs";
const id = process.argv[2]; const t0 = +(process.argv[3] ?? 4000);
const m = buildCardiacModel(); const W = computeLeadField(m);
const mk = (keep: (c: number) => boolean) => { const w = Float32Array.from(W as any); for (let i = 0; i < m.cellType.length; i++) if (!keep(m.cellType[i])) for (let e = 0; e < N_COLS; e++) w[i * N_COLS + e] = 0; return w; };
const out: Record<string, Float32Array> = {};
for (const [k, w] of [["all", W], ["atr", mk((c) => c === CT.ATRIAL)], ["ven", mk((c) => c !== CT.ATRIAL)]] as const) {
  const p = SCENARIOS.find((s) => s.id === id)!.apply!();
  const sim = new Simulator(m, sanitizeParams(p as unknown as Record<string, unknown>), w as any); sim.run(t0 + 3000); out[k] = sim.drain().ecg;
}
const L = ["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"];
const rows = ["t," + ["all","atr","ven"].flatMap((k) => L.map((l) => `${k}_${l}`)).join(",")];
const dt = 2; for (let i = Math.round(t0 / dt); i < Math.round((t0 + 3000) / dt); i++) rows.push([(i * dt - t0).toFixed(0), ...["all","atr","ven"].flatMap((k) => L.map((_, c) => out[k][i * N_CHANNELS + c].toFixed(4)))].join(","));
writeFileSync(`/tmp/claude-0/svt/${id}-decomp.csv`, rows.join("\n"));
