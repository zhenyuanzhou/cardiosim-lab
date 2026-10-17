/** ST deviation (J+60 ms, vs PR baseline) in all 19 leads for each culprit lesion. */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { N_CHANNELS, ALL_LEAD_NAMES, channelOf } from "../../src/simulation/ecg-forward/leadField";
import { CULPRITS } from "../../src/simulation/core/ischaemia";
import { writeFileSync } from "node:fs";
const m = buildCardiacModel();
const grade = +(process.argv[2] ?? 2);
const list = process.argv[3] ? process.argv[3].split(",") : CULPRITS;
for (const c of list) {
  const p = cloneParams(DEFAULT_PARAMS); (p as any).ischaemia = { culprit: c, grade };
  const sim = new Simulator(m, p); sim.run(4000); const o = sim.drain(); const dt = sim.dt;
  const ws = o.waves.filter((w) => Number.isFinite(w.tFirstVent)); const w = ws[ws.length - 2];
  const at = (ch: number, t: number) => o.ecg[Math.round(t / dt) * N_CHANNELS + ch];
  const st: string[] = [];
  for (const n of ALL_LEAD_NAMES) {
    const ch = channelOf(n); const base = at(ch, w.tFirstVent - 15); const j = w.tLastVent;
    st.push(`${n}:${((at(ch, j + 60) - base) * 10).toFixed(1)}`);
  }
  console.log(`${c.padEnd(16)} ST(mm @J+60) ` + st.join(" "));
  const rows = ["t," + ALL_LEAD_NAMES.join(",")];
  for (let i = 0; i < o.ecg.length / N_CHANNELS; i++) { const t = i * dt; if (t < 1500 || t >= 4000) continue; rows.push([(t - 1500).toFixed(0), ...ALL_LEAD_NAMES.map((n) => o.ecg[i * N_CHANNELS + channelOf(n)].toFixed(4))].join(",")); }
  writeFileSync(`/tmp/claude-0/ko/stemi-${c}-g${grade}.csv`, rows.join("\n"));
}
