/**
 * Candidate torsades mechanism: several EAD-triggered foci with reduced repolarisation reserve firing
 * at slightly different cycle lengths and competing for the ventricle (Vandersickel et al., J Physiol
 * 2016: with large heterogeneity, multiple competing foci alone produce a typical TdP ECG).
 *
 * usage: tsx tdp-foci.ts <apdScale> <erpRatio> <floor> <het> <"site:cl,site:cl,..."> <runMs> <tag>
 */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { EV_EXCITE } from "../../src/simulation/core/eventQueue";
import { N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
import { tdpMetrics, formatMetrics, runWindow } from "./tdp-metrics";
import { writeFileSync } from "node:fs";

const m = buildCardiacModel();
const scale = +(process.argv[2] ?? 1.3);
const erp = +(process.argv[3] ?? 0.85);
const floor = +(process.argv[4] ?? 0.45);
const het = +(process.argv[5] ?? 0);
// "site:cl,site:cl" = competing foci; "drift:<cl>:<step>:<site,site,...>" = a source that moves one
// step along the path each beat (reduced-order stand-in for a drifting rotor).
const arg6 = process.argv[6] ?? "lv-anterobasal:260,lv-inferobasal:292";
const drift = arg6.startsWith("drift:");
const spec = drift ? [] : arg6.split(",").map((s) => {
  const [site, cl] = s.split(":");
  return { site, cl: +cl };
});
const [, driftCl, driftStep, driftPath] = drift ? arg6.split(":") : ["", "0", "0", ""];
const runMs = +(process.argv[7] ?? 4000);
const tag = process.argv[8] ?? "f";

const p = cloneParams(DEFAULT_PARAMS);
p.ventricles.apd = Math.round(300 * scale);
p.ventricles.transmuralGradient = Math.round(25 * scale);
p.ventricles.apicobasalGradient = Math.round(-30 * scale);
p.ventricles.erpRatio = erp;
p.restitution.apdFloor = floor;
p.ventricles.heterogeneity = het;

const sim = new Simulator(m, p) as Simulator & { queue: { push: (t: number, node: number, src: number, wave: number, kind: number, extra: number) => void } };
// let sinus run, then a pause (long) and the first short-coupled EAD beat (long–short initiation:
// Kay et al., JACC 1983 — a long–short ventricular cycle preceded 41 of 44 episodes)
sim.run(3000);
const pre = sim.drain();
const v = pre.waves.filter((w) => Number.isFinite(w.tFirstVent)).sort((a, b) => a.tFirstVent - b.tFirstVent);
const t0 = v[v.length - 1].tFirstVent + 1100; // the pause
sim.run(t0 - 1);
if (drift) {
  const path = driftPath.split(",").map((s) => {
    const n = m.ectopicSites[s];
    if (n === undefined) throw new Error(`no site ${s}`);
    return n;
  });
  const cl = +driftCl;
  const st = +driftStep;
  for (let k = 0, t = t0; t < t0 + runMs; k++, t = t0 + k * cl) sim.queue.push(t, path[Math.round(k * st) % path.length], -6, -1, EV_EXCITE, 0);
} else {
  for (const f of spec) {
    const node = m.ectopicSites[f.site];
    if (node === undefined) throw new Error(`no site ${f.site}`);
    for (let k = 0, t = t0; t < t0 + runMs; k++, t = t0 + k * f.cl) sim.queue.push(t, node, -6, -1, EV_EXCITE, 0);
  }
}
sim.run(t0 + runMs + 3000);
const o = sim.drain();
const [wa, wb] = runWindow(o, t0, t0 + runMs + 2000);
const mt = tdpMetrics(o, sim.dt, wa, wb);
console.log(`scale=${scale} erp=${erp} floor=${floor} het=${het} ${process.argv[6]}: run ${(wb - wa).toFixed(0)} ms | ${formatMetrics(mt)}`);

const rows = ["t,I,II,III,aVR,aVL,aVF,V1,V2,V3,V4,V5,V6"];
for (let i = 0; i < o.ecg.length / N_CHANNELS; i++) {
  const t = i * sim.dt;
  if (t < t0 - 1200 || t >= t0 + runMs + 1200) continue;
  rows.push([(t - (t0 - 1200)).toFixed(0), ...Array.from({ length: 12 }, (_, c) => o.ecg[i * N_CHANNELS + c].toFixed(4))].join(","));
}
writeFileSync(`/tmp/claude-0/tdp/${tag}.csv`, rows.join("\n"));
