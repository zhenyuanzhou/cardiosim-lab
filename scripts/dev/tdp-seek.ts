/**
 * Candidate torsades mechanism: a source that moves each beat to whichever site has recovered most —
 * the reduced-order analogue of a rotor drifting down the gradient of refractoriness, which is what
 * the optical-mapping and simulation literature holds responsible for the undulating axis (Gray et al.,
 * Circulation 1995: nonstationary scroll waves give undulating ECGs, stationary ones monomorphic).
 *
 * The rate is emergent: the next beat fires as soon as some site has recovered (plus a delay), so the
 * cycle length is set by refractoriness on the long-QT substrate rather than imposed. The run ends by
 * itself when no site recovers in time, which matches torsades usually being non-sustained.
 *
 * usage: tsx tdp-seek.ts <apdScale> <erpRatio> <floor> <het> <margin ms> <maxBeats> <tag>
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
const erpR = +(process.argv[3] ?? 0.92);
const floor = +(process.argv[4] ?? 0.45);
const het = +(process.argv[5] ?? 0);
const margin = +(process.argv[6] ?? 10);
const maxBeats = +(process.argv[7] ?? 24);
const disp = +(process.argv[8] ?? 1);
const cvS = +(process.argv[9] ?? 1);
const driftRate = +(process.argv[12] ?? 1); // ring sites advanced per beat
const pairOff = +(process.argv[11] ?? 0); // ms offset of a second, counter-rotating loop (0 = single)
const tag = process.argv[10] ?? "s";

const p = cloneParams(DEFAULT_PARAMS);
p.ventricles.apd = Math.round(300 * scale);
p.ventricles.transmuralGradient = Math.round(25 * scale * disp);
p.ventricles.apicobasalGradient = Math.round(-30 * scale * disp);
p.ventricles.erpRatio = erpR;
p.restitution.apdFloor = floor;
p.ventricles.heterogeneity = het;
p.ventricles.cvLongitudinal = +(p.ventricles.cvLongitudinal * cvS).toFixed(3);

type Internals = { queue: { push: (t: number, n: number, s: number, w: number, k: number, e: number) => void }; lastAct: Float64Array; erp: Float32Array; time: number };
const sim = new Simulator(m, p) as Simulator & Internals;
const SITES = ["rvot", "rv-apex", "septum", "lv-apex", "lv-lateral", "lv-anterobasal", "lv-inferobasal"];
const nodes = SITES.map((s) => m.ectopicSites[s]).filter((n) => n !== undefined) as number[];

sim.run(3000);
const pre = sim.drain();
const v = pre.waves.filter((w) => Number.isFinite(w.tFirstVent)).sort((a, b) => a.tFirstVent - b.tFirstVent);
const t0 = v[v.length - 1].tFirstVent + 1100; // pause, then the first short-coupled (EAD) beat
sim.run(t0 - 1);
sim.queue.push(t0, nodes[0], -6, -1, EV_EXCITE, 0);
const half = Math.floor(nodes.length / 2);
if (pairOff > 0) sim.queue.push(t0 + pairOff, nodes[half], -6, -1, EV_EXCITE, 0);

const fired: { t: number; site: string }[] = [{ t: t0, site: SITES[0] }];
let t = t0;
let prev = 0;
for (let b = 1; b < maxBeats; b++) {
  // The next source is the next site along the path. Advance only until the current wave has reached
  // that site, then fire as soon as it recovers — so the new wavefront starts while the previous one
  // is still propagating elsewhere ("excitation fronts constantly present" during re-entrant torsades,
  // Vandersickel et al., JACC Clin Electrophysiol 2017, versus a silent interval in focal torsades).
  const best = Math.round((b * driftRate) % nodes.length);
  let guard = t;
  while (sim.lastAct[nodes[best]] < t && guard < t + 320) {
    guard += 20;
    sim.run(guard);
  }
  const bestT = sim.lastAct[nodes[best]] + sim.erp[nodes[best]] + margin;
  const next = Math.max(bestT, sim.time + 2);
  if (next - t > 600) break; // the next tissue does not recover in time: the run self-terminates
  sim.run(next - 1);
  sim.queue.push(next, nodes[best], -6, -1, EV_EXCITE, 0);
  // paired figure-of-eight loop: a second source on the far side of the ring, turning the other way
  if (pairOff > 0) {
    const mate = (half - best + nodes.length * 2) % nodes.length;
    sim.queue.push(next + pairOff, nodes[mate], -6, -1, EV_EXCITE, 0);
  }
  fired.push({ t: next, site: SITES[best] });
  prev = best;
  t = next;
}
sim.run(t + 3000);
const o = sim.drain();
const [wa, wb] = runWindow(o, t0 - 10, t + 1500);
const mt = tdpMetrics(o, sim.dt, wa, wb);
console.log(`scale=${scale} erp=${erpR} floor=${floor} het=${het} disp=${disp} cv=${cvS} pair=${pairOff} drift=${driftRate}: run ${(wb - wa).toFixed(0)} ms, ${fired.length} fired | ${formatMetrics(mt)}`);
console.log("  sites:", fired.map((f) => `${f.site}@${f.t.toFixed(0)}`).join(" "));

const rows = ["t,I,II,III,aVR,aVL,aVF,V1,V2,V3,V4,V5,V6"];
for (let i = 0; i < o.ecg.length / N_CHANNELS; i++) {
  const tt = i * sim.dt;
  if (tt < t0 - 1200 || tt >= t + 1500) continue;
  rows.push([(tt - (t0 - 1200)).toFixed(0), ...Array.from({ length: 12 }, (_, c) => o.ecg[i * N_CHANNELS + c].toFixed(4))].join(","));
}
writeFileSync(`/tmp/claude-0/tdp/${tag}.csv`, rows.join("\n"));
