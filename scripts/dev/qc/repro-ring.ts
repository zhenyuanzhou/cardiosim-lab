/**
 * QC reproduction of the waveform findings on the current generator:
 *  1. index sequence produced by rounding a fractional drift (repeats followed by jumps);
 *  2. frontal QRS axis of a single beat paced from each ring site (are sites ordered by axis?);
 *  3. whether episodes still occur when the long-QT substrate is removed.
 */
import { SCENARIOS } from "../../../src/simulation/scenarios/scenarios";
import { buildCardiacModel } from "../../../src/simulation/tissue/buildModel";
import { Simulator } from "../../../src/simulation/core/engine";
import { computeLeadField, N_CHANNELS } from "../../../src/simulation/ecg-forward/leadField";
import { DEFAULT_PARAMS, cloneParams } from "../../../src/simulation/core/params";

const model = buildCardiacModel();
const W = computeLeadField(model);
const p0 = SCENARIOS.find((s) => s.id === "tdp")!.apply!();

// 1. index sequence
const seq: number[] = [];
let pos = 0;
const LEGACY_DRIFT = 0.6; // the v1.6 default, kept here so the defect stays reproducible
for (let k = 0; k < 20; k++) { seq.push(((Math.round(pos) % 16) + 16) % 16); pos += LEGACY_DRIFT; }
console.log(`1. v1.6 ring index per beat (rounded fractional drift ${LEGACY_DRIFT}): ${seq.join(" ")}`);

// 2. axis of a beat paced from each ring site (sinus beat at ~1 s, stimulus 450 ms later)
const sim0 = new Simulator(model, p0, W);
const ring: number[] = (sim0 as any).torsadesRing(16);
const base = cloneParams(DEFAULT_PARAMS);
const axes: number[] = [];
for (const node of ring) {
  const s = new Simulator(model, base, W);
  s.stimulate(node, 1500);
  s.run(1900);
  const o = s.drain();
  let best = -1, ax = 0;
  for (let i = Math.round(1500 / s.dt); i < Math.round(1700 / s.dt); i++) {
    const hx = o.ecg[i * N_CHANNELS + 12], hy = o.ecg[i * N_CHANNELS + 13];
    const mag = Math.hypot(hx, hy);
    if (mag > best) { best = mag; ax = (Math.atan2(hy, hx) * 180) / Math.PI; }
  }
  axes.push(ax);
}
const steps = axes.map((a, i) => { let d = axes[(i + 1) % axes.length] - a; while (d > 180) d -= 360; while (d < -180) d += 360; return d; });
console.log(`2. frontal axis of a paced beat from each ring site (deg): ${axes.map((a) => a.toFixed(0)).join(" ")}`);
console.log(`   step to the next site (deg): ${steps.map((d) => d.toFixed(0)).join(" ")}  -> range ${Math.min(...steps).toFixed(0)} to ${Math.max(...steps).toFixed(0)}`);

// 3. episodes without the long-QT substrate
const p3 = cloneParams(DEFAULT_PARAMS);
p3.torsades = { ...p0.torsades };
p3.restitution = { ...p0.restitution };
const s3 = new Simulator(model, p3, W);
s3.run(30000);
const n3 = s3.drain().waves.filter((w) => w.site === "torsades focus").length;
console.log(`3. torsades stimuli in 30 s with the generator on but NO long-QT substrate: ${n3}`);
