/**
 * QC reproduction A: disabling torsades mid-episode must stop the episode.
 * Also checks that snapshot → restore → replay mid-episode reproduces the original continuation.
 */
import { SCENARIOS } from "../../../src/simulation/scenarios/scenarios";
import { buildCardiacModel } from "../../../src/simulation/tissue/buildModel";
import { Simulator } from "../../../src/simulation/core/engine";
import { computeLeadField } from "../../../src/simulation/ecg-forward/leadField";
import { cloneParams } from "../../../src/simulation/core/params";

const model = buildCardiacModel();
const W = computeLeadField(model);
const p0 = SCENARIOS.find((s) => s.id === "tdp")!.apply!();

// 1. find episodes in an undisturbed run
const ref = new Simulator(model, p0, W);
ref.run(30000);
const all = ref.drain().waves.filter((w) => w.site === "torsades focus").map((w) => w.t0).sort((a, b) => a - b);
const starts = all.filter((t, i) => i === 0 || t - all[i - 1] > 600);
console.log(`torsades stimuli in 30 s: ${all.length}; episode starts (ms): ${starts.map((x) => x.toFixed(0)).join(", ")}`);
// a time in the middle of the second episode (the first is the isolated triggered beat? report both)
const epi = all.filter((t) => t >= starts[1] && t < starts[1] + 5000);
const mid = epi[Math.floor(epi.length / 2)];
console.log(`second episode: ${epi.length} stimuli from ${epi[0].toFixed(0)} to ${epi[epi.length - 1].toFixed(0)} ms; disabling at ${mid.toFixed(0)} ms`);

// 2. disable mid-episode
const sim = new Simulator(model, p0, W);
sim.run(mid);
sim.drain();
const p1 = cloneParams(p0);
p1.torsades.enabled = false;
sim.setParams(p1);
sim.run(mid + 4000);
const after = sim.drain().waves.filter((w) => w.site === "torsades focus" && w.t0 > mid);
console.log(`A. torsades stimuli that still fired in the 4 s after disabling: ${after.length}`);

// 3. snapshot/restore mid-episode
const a = new Simulator(model, p0, W);
a.run(mid);
const snap = a.snapshot();
a.run(mid + 3000);
const ca = a.drain().waves.filter((w) => w.site === "torsades focus" && w.t0 > mid).length;
const b = new Simulator(model, p0, W);
b.run(1000); // diverge first
b.restore(snap);
b.run(mid + 3000);
const cb = b.drain().waves.filter((w) => w.site === "torsades focus" && w.t0 > mid).length;
console.log(`snapshot/restore mid-episode: original continuation ${ca} torsades stimuli, restored continuation ${cb} -> ${ca === cb ? "consistent" : "DIVERGES"}`);
