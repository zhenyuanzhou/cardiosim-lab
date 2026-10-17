/** Baseline effect of the M-cell band: transmural dispersion, QT, Tpeak-Tend. */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField, N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";
import { derive } from "../../src/simulation/core/derive";
import { CT } from "../../src/simulation/core/model";
const m = buildCardiacModel(); const W = computeLeadField(m);
const WALL = 10.5; // mm, LV free-wall thickness in this geometry
const sm = (process.argv[2] ?? "4").split(",").map(Number);
for (const smooth of sm) for (const boost of process.argv.slice(3).map(Number)) {
  const p = cloneParams(DEFAULT_PARAMS); p.ventricles.mCellBoost = boost; p.ventricles.electrotonicSmoothing = smooth;
  const d = derive(m, p);
  // transmural dispersion in the LV lateral wall (where the M island sits): max-min APD among
  // nodes within 8 mm of the lv-lateral site
  const c = m.ectopicSites["lv-lateral"]; let lo = Infinity, hi = -Infinity;
  // transmural profile through the island: nodes within 5 mm of the island centre line
  const prof: number[][] = Array.from({ length: 10 }, () => []);
  // island contrast: APD at the island centre vs the mean 20-26 mm away in the same wall
  let far = 0, nFar = 0, centre = 0, nC = 0;
  for (let i = 0; i < m.n; i++) {
    if (m.cellType[i] !== CT.VENTRICULAR) continue;
    const dx = m.pos[3*i]-m.pos[3*c], dy = m.pos[3*i+1]-m.pos[3*c+1], dz = m.pos[3*i+2]-m.pos[3*c+2];
    const r2 = dx*dx+dy*dy+dz*dz;
    if (r2 < 36) { centre += d.apdRef[i]; nC++; }
    if (r2 < 25) prof[Math.min(9, Math.floor(m.transmural[i] * 10))].push(d.apdRef[i]);
    else if (r2 > 400 && r2 < 676) { far += d.apdRef[i]; nFar++; }
  }
  for (let i = 0; i < m.n; i++) {
    if (m.cellType[i] !== CT.VENTRICULAR) continue;
    const dx = m.pos[3*i]-m.pos[3*c], dy = m.pos[3*i+1]-m.pos[3*c+1], dz = m.pos[3*i+2]-m.pos[3*c+2];
    if (dx*dx+dy*dy+dz*dz > 64) continue;
    lo = Math.min(lo, d.apdRef[i]); hi = Math.max(hi, d.apdRef[i]);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const pv = prof.map(mean).filter((x) => x > 0);
  const tdrWall = pv.length ? Math.max(...pv) - Math.min(...pv) : 0;
  const sim = new Simulator(m, p, W); sim.run(5000); const o = sim.drain();
  const b = measureBeats(o.ecg, sim.dt, 0, o.waves).slice(1, -1);
  const vm = (t: number) => { const i = Math.round(t / sim.dt) * N_CHANNELS; return Math.hypot(o.ecg[i+12], o.ecg[i+13], o.ecg[i+14]); };
  const tp = b.map((x: any) => { const J = x.qrsOff, te = x.qrsOn + x.qt; let best = -1, at = J; for (let t = J+40; t < te; t += sim.dt) if (vm(t) > best) { best = vm(t); at = t; } return te - at; });
  const med = (xs: number[]) => xs.filter(Number.isFinite).sort((a,b)=>a-b)[xs.length>>1];
  console.log(`smooth ${smooth} mm, mCellBoost ${boost}: island contrast ${(centre/nC - far/nFar).toFixed(0)} ms | transmural ${tdrWall.toFixed(0)} ms = ${(tdrWall/WALL).toFixed(1)} ms/mm | QT ${med(b.map((x:any)=>x.qt))} ms | Tpeak-Tend ${med(tp).toFixed(0)} ms | QRS ${med(b.map((x:any)=>x.qrs))}`);
}
