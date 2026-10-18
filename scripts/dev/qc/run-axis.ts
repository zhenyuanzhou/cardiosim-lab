/** During an actual run: the source site's predicted axis against the realised beat axis. */
import { buildCardiacModel } from "../../../src/simulation/tissue/buildModel";
import { Simulator } from "../../../src/simulation/core/engine";
import { computeLeadField, N_CHANNELS } from "../../../src/simulation/ecg-forward/leadField";
import { SCENARIOS } from "../../../src/simulation/scenarios/scenarios";
import { torsadesPath, angleDiff } from "../../../src/simulation/core/torsades";

const model = buildCardiacModel();
const W = computeLeadField(model);
const p = SCENARIOS.find((s) => s.id === "tdp")!.apply!();
p.restitution.apdFloor = 0.5;
p.restitution.cvAmplitude = 0.85;
p.torsades = { ...p.torsades, twistDeg: +(process.argv[2] ?? 22), pairOffset: +(process.argv[3] ?? 30), pathSites: +(process.argv[4] ?? 24), margin: +(process.argv[5] ?? 10) };
const path = torsadesPath(model, W, p.torsades.pathSites);
const axisOf = new Map(path.map((s) => [s.node, s.axis]));
const sim = new Simulator(model, p, W);
sim.run(24000);
const o = sim.drain();
const foci = o.waves.filter((w) => w.site === "torsades focus" && Number.isFinite(w.tFirstVent)).sort((a, b) => a.tFirstVent - b.tFirstVent);
const starts = foci.filter((w, i) => i === 0 || w.tFirstVent - foci[i - 1].tFirstVent > 600);
let best = { t: 0, n: 0 };
for (const st of starts) {
  const n = foci.filter((w) => w.tFirstVent >= st.tFirstVent && w.tFirstVent < st.tFirstVent + 8000).length;
  if (n > best.n) best = { t: st.tFirstVent, n };
}
const epi = foci.filter((w) => w.tFirstVent >= best.t && w.tFirstVent < best.t + 8000);
const rows: string[] = [];
let prevReal = NaN;
for (const w of epi) {
  let m = -1;
  let ax = 0;
  for (let t = w.tFirstVent; t <= w.tLastVent; t += sim.dt) {
    const i = Math.round(t / sim.dt) * N_CHANNELS;
    const mag = Math.hypot(o.ecg[i + 12], o.ecg[i + 13]);
    if (mag > m) { m = mag; ax = (Math.atan2(o.ecg[i + 13], o.ecg[i + 12]) * 180) / Math.PI; }
  }
  const pred = axisOf.get(w.firstVentNode);
  const step = Number.isNaN(prevReal) ? NaN : angleDiff(ax, prevReal);
  rows.push(`t ${w.tFirstVent.toFixed(0).padStart(6)}  node ${String(w.firstVentNode).padStart(5)}  predicted ${pred === undefined ? "  n/a" : pred.toFixed(0).padStart(5)}  realised ${ax.toFixed(0).padStart(5)}  step ${Number.isNaN(step) ? "  -" : step.toFixed(0).padStart(5)}  |V| ${m.toFixed(3)}`);
  prevReal = ax;
}
console.log(rows.join("\n"));
