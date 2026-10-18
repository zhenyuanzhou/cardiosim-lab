/** Predicted (ball-sum) vs measured frontal axis for every site on the source path. */
import { buildCardiacModel } from "../../../src/simulation/tissue/buildModel";
import { Simulator } from "../../../src/simulation/core/engine";
import { computeLeadField, N_CHANNELS } from "../../../src/simulation/ecg-forward/leadField";
import { SCENARIOS } from "../../../src/simulation/scenarios/scenarios";
import { torsadesPath, angleDiff } from "../../../src/simulation/core/torsades";

const model = buildCardiacModel();
const W = computeLeadField(model);
const p = SCENARIOS.find((s) => s.id === "tdp")!.apply!();
p.torsades.enabled = false; // calibrate on the substrate without the generator running
const path = torsadesPath(model, W, 24);
const rows: string[] = [];
const errs: number[] = [];
for (const site of path) {
  const s = new Simulator(model, p, W);
  // fire late in diastole, after the long action potential of the long-QT substrate has finished
  const T = 1700;
  s.stimulate(site.node, T);
  s.run(T + 350);
  const o = s.drain();
  const w = o.waves.find((x) => x.site === "stimulus" && Math.abs(x.t0 - T) < 2);
  if (!w || !Number.isFinite(w.tFirstVent) || w.ventCount < 500) { rows.push(`node ${String(site.node).padStart(5)}  NO CAPTURE (${w ? w.ventCount : 0} nodes)`); continue; }
  let best = -1;
  let ax = 0;
  for (let i = Math.round(T / s.dt); i < Math.round((T + 200) / s.dt); i++) {
    const hx = o.ecg[i * N_CHANNELS + 12];
    const hy = o.ecg[i * N_CHANNELS + 13];
    const m = Math.hypot(hx, hy);
    if (m > best) { best = m; ax = (Math.atan2(hy, hx) * 180) / Math.PI; }
  }
  const e = angleDiff(ax, site.axis);
  errs.push(Math.abs(e));
  rows.push(`node ${String(site.node).padStart(5)}  predicted ${site.axis.toFixed(0).padStart(5)}  measured ${ax.toFixed(0).padStart(5)}  error ${e.toFixed(0).padStart(5)}`);
}
console.log(rows.join("\n"));
errs.sort((a, b) => a - b);
console.log(`\nabsolute error: median ${errs[errs.length >> 1].toFixed(0)} deg, 90th pct ${errs[Math.floor(errs.length * 0.9)].toFixed(0)} deg, max ${errs[errs.length - 1].toFixed(0)} deg`);
