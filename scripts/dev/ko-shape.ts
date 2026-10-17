/** TP06 action-potential shape vs [K+]o: repolarisation milestones and terminal tail, per cell type. */
import { pace, TP06_DEFAULT_MODS } from "../../src/simulation/cellular/tp06";
import { writeFileSync } from "node:fs";
const rows: string[] = ["cell,Ko,t,v"];
for (const cell of ["endo", "mid", "epi"] as const) for (const Ko of [2.5, 3, 4, 5.4, 7, 8, 9]) {
  const r = pace(cell, { ...TP06_DEFAULT_MODS, Ko }, 1000, 30);
  const v = r.v, amp = r.vPeak - r.vRest;
  const t = (frac: number) => { for (let i = 20; i < v.length; i++) if (v[i] < r.vRest + frac * amp) return i; return NaN; };
  const [a30, a50, a70, a90, a97] = [0.7, 0.5, 0.3, 0.1, 0.03].map(t);
  // max repolarisation slope (phase 3) and its time
  let smax = 0, ts = 0; for (let i = 30; i < v.length - 1; i++) { const s = v[i] - v[i + 1]; if (s > smax) { smax = s; ts = i; } }
  console.log(`${cell.padEnd(4)} Ko=${Ko}: rest ${r.vRest.toFixed(1)} peak ${r.vPeak.toFixed(1)} dVdt ${r.dvdtMax.toFixed(0)} | APD30 ${a30} APD50 ${a50} APD70 ${a70} APD90 ${a90} APD97 ${a97} | max ph3 slope ${smax.toFixed(2)} mV/ms at ${ts} ms | tail 90→97 ${a97 - a90} ms`);
  for (let i = 0; i < v.length; i += 2) rows.push(`${cell},${Ko},${i},${v[i].toFixed(2)}`);
}
writeFileSync("/tmp/claude-0/svt/ko-ap.csv", rows.join("\n"));
