/** Dump 12-lead ECG (10 s window) of a scenario to CSV for plotting. usage: tsx svt-12lead.ts <id> <t0> */
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams } from "../../src/simulation/core/params";
import { computeLeadField, N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
import { writeFileSync } from "node:fs";
const id = process.argv[2]; const t0 = +(process.argv[3] ?? 4000);
const m = buildCardiacModel(); const W = computeLeadField(m);
const p = SCENARIOS.find((s) => s.id === id)!.apply!();
const sim = new Simulator(m, sanitizeParams(p as unknown as Record<string, unknown>), W); sim.run(t0 + 10500);
const o = sim.drain();
const rows = ["t,I,II,III,aVR,aVL,aVF,V1,V2,V3,V4,V5,V6"];
for (let i = 0; i < o.ecg.length / N_CHANNELS; i++) { const t = i * sim.dt; if (t < t0 || t >= t0 + 10000) continue;
  rows.push([ (t - t0).toFixed(1), ...Array.from({ length: 12 }, (_, c) => o.ecg[i * N_CHANNELS + c].toFixed(4)) ].join(",")); }
writeFileSync(`/tmp/claude-0/svt/${id}.csv`, rows.join("\n"));
const v = o.waves.filter((w) => Number.isFinite(w.tFirstVent) && w.tFirstVent > t0).map((w) => ({ o: w.origin, s: w.site, a: +w.tFirstVent.toFixed(0), qrs: +(w.tLastVent - w.tFirstVent).toFixed(0), atr: Number.isFinite((w as any).tFirstAtrial) ? +(w as any).tFirstAtrial.toFixed(0) : null }));
console.log(id, JSON.stringify(v.slice(0, 8)));
