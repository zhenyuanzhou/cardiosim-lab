/** Post-fix checks: substrate gating, axis ordering of the path, and the realised twist per beat. */
import { SCENARIOS } from "../../../src/simulation/scenarios/scenarios";
import { buildCardiacModel } from "../../../src/simulation/tissue/buildModel";
import { Simulator } from "../../../src/simulation/core/engine";
import { computeLeadField, N_CHANNELS } from "../../../src/simulation/ecg-forward/leadField";
import { DEFAULT_PARAMS, cloneParams } from "../../../src/simulation/core/params";
import { torsadesPath, angleDiff, advanceIndex } from "../../../src/simulation/core/torsades";

const model = buildCardiacModel();
const W = computeLeadField(model);
const tdp = SCENARIOS.find((s) => s.id === "tdp")!.apply!();

// 1. path ordering: step in starting axis between consecutive sites
for (const bins of [24, 48, 96]) {
  const path = torsadesPath(model, W, bins);
  const adj = path.map((s, i) => Math.abs(angleDiff(path[(i + 1) % path.length].axis, s.axis)));
  // realised per-beat twist: walk the path the way the engine does
  let k = 0;
  const used: number[] = [];
  for (let b = 0; b < 40; b++) {
    const n = advanceIndex(path, k, tdp.torsades.twistDeg);
    used.push(Math.abs(angleDiff(path[n].axis, path[k].axis)));
    k = n;
  }
  const mean = used.reduce((a, b) => a + b, 0) / used.length;
  const sd = Math.sqrt(used.reduce((a, b) => a + (b - mean) ** 2, 0) / used.length);
  console.log(`1. pathSites ${String(bins).padStart(3)}: ${path.length} sites | adjacent-site axis gap max ${Math.max(...adj).toFixed(0)} deg | realised twist per beat ${mean.toFixed(1)} +/- ${sd.toFixed(1)} deg (requested ${tdp.torsades.twistDeg})`);
}
const path = torsadesPath(model, W, tdp.torsades.pathSites);

// 2. substrate gating
const count = (p: ReturnType<typeof cloneParams>, ms = 30000) => {
  const s = new Simulator(model, p, W);
  s.run(ms);
  return s.drain().waves.filter((w) => w.site === "torsades focus").length;
};
const normal = cloneParams(DEFAULT_PARAMS);
normal.torsades = { ...tdp.torsades };
normal.restitution = { ...tdp.restitution };
console.log(`2. torsades stimuli in 30 s — long-QT substrate: ${count(tdp)}; generator on but NORMAL QT: ${count(normal)}`);

// 3. realised beat-to-beat axis step during a run
const sim = new Simulator(model, tdp, W);
sim.run(24000);
const o = sim.drain();
const foci = o.waves.filter((w) => w.site === "torsades focus" && Number.isFinite(w.tFirstVent)).sort((a, b) => a.tFirstVent - b.tFirstVent);
const starts = foci.filter((w, i) => i === 0 || w.tFirstVent - foci[i - 1].tFirstVent > 600);
const epi = foci.filter((w) => w.tFirstVent >= starts[1].tFirstVent && w.tFirstVent < starts[1].tFirstVent + 6000);
const axes = epi.map((w) => {
  let best = -1, ax = 0;
  for (let t = w.tFirstVent; t < w.tLastVent + 40; t += sim.dt) {
    const i = Math.round(t / sim.dt) * N_CHANNELS;
    const mag = Math.hypot(o.ecg[i + 12], o.ecg[i + 13]);
    if (mag > best) { best = mag; ax = (Math.atan2(o.ecg[i + 13], o.ecg[i + 12]) * 180) / Math.PI; }
  }
  return ax;
});
const d = axes.slice(1).map((a, i) => angleDiff(a, axes[i]));
let cum = 0, lo = 0, hi = 0;
for (const x of d) { cum += x; lo = Math.min(lo, cum); hi = Math.max(hi, cum); }
console.log(`3. run of ${epi.length} beats: cumulative ECG axis sweep ${(hi - lo).toFixed(0)} deg`);
