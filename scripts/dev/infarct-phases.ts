/** ST, Q wave and T wave through the phases of an infarct, measured off the detected beat. */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField, N_CHANNELS, channelOf } from "../../src/simulation/ecg-forward/leadField";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";
import { INFARCT_PHASES, setTWaveApd } from "../../src/simulation/core/ischaemia";
import { writeFileSync } from "node:fs";
const m = buildCardiacModel(); const W = computeLeadField(m);

/** ST (mm at J+60), initial Q depth (mm), R height (mm), T amplitude (mm) for one lead of one beat. */
export function waveform(ecg: Float32Array, dt: number, b: { qrsOn: number; qrsOff: number; qt: number }, ch: number) {
  const at = (t: number) => ecg[Math.round(t / dt) * N_CHANNELS + ch];
  const base = at(b.qrsOn - 20);
  const st = (at(b.qrsOff + 60) - base) * 10;
  // Q: the initial negative deflection, i.e. negativity before the first positive excursion
  let q = 0;
  for (let t = b.qrsOn; t < b.qrsOff; t += dt) {
    const v = at(t) - base;
    if (v > 0.03) break;
    q = Math.min(q, v);
  }
  let r = 0;
  for (let t = b.qrsOn; t <= b.qrsOff; t += dt) r = Math.max(r, at(t) - base);
  let T = 0;
  for (let t = b.qrsOff + 80; t < b.qrsOn + b.qt; t += dt) if (Math.abs(at(t) - base) > Math.abs(T)) T = at(t) - base;
  return { st, q: q * 10, r: r * 10, t: T * 10 };
}

if (process.argv[1].endsWith("infarct-phases.ts")) {
  const culprit = (process.argv[2] ?? "lad-prox") as never;
  const leads = (process.argv[3] ?? "I,aVL,V2,V3,V4,III,aVF").split(",");
  if (process.argv[4]) setTWaveApd(+process.argv[4]);
  for (const phase of INFARCT_PHASES) {
    const p = cloneParams(DEFAULT_PARAMS);
    (p as unknown as { ischaemia: unknown }).ischaemia = { culprit, grade: 2, phase };
    const sim = new Simulator(m, p, W); sim.run(5000); const o = sim.drain(); const dt = sim.dt;
    const beats = measureBeats(o.ecg, dt, 0, o.waves).filter((x) => x.qt !== null);
    const b = beats[beats.length - 2] as unknown as { qrsOn: number; qrsOff: number; qt: number };
    const out = leads.map((n) => { const x = waveform(o.ecg, dt, b, channelOf(n)); return `${n} ST${x.st >= 0 ? "+" : ""}${x.st.toFixed(1)} Q${x.q.toFixed(1)} R${x.r.toFixed(1)} T${x.t >= 0 ? "+" : ""}${x.t.toFixed(1)}`; });
    console.log(`${phase.padEnd(11)} QRS ${(b.qrsOff - b.qrsOn).toFixed(0)} QT ${b.qt.toFixed(0)} | ` + out.join("  "));
    const rows = ["t," + ["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"].join(",")];
    for (let i = 0; i < o.ecg.length / N_CHANNELS; i++) { const t = i * dt; if (t < 1500 || t >= 3500) continue;
      rows.push([(t - 1500).toFixed(0), ...Array.from({length:12},(_,c)=>o.ecg[i*N_CHANNELS+c].toFixed(4))].join(",")); }
    writeFileSync(`/tmp/claude-0/ko/phase-${culprit}-${phase}.csv`, rows.join("\n"));
  }
}
