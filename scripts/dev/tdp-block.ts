/**
 * Does the premature beat block at the M-cell island, and if so does the wavefront come back?
 *
 * Reports, for each coupling interval: the refractory window actually present in the ventricle when
 * S2 lands, how much of the ventricle S2 captured, how long its activation took, and whether any
 * re-entrant wave followed. This is the measurement the earlier scans were missing — they only asked
 * whether re-entry happened, not whether the conditions for it (a blocked island the wave can round)
 * were ever created.
 */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { CT } from "../../src/simulation/core/model";
import { setupParams, type Setup } from "./tdp-emergent";
import { mCellWeights } from "../../src/simulation/core/mcells";
import { derive } from "../../src/simulation/core/derive";

const model = buildCardiacModel();
const W = computeLeadField(model);
let nVent = 0;
for (let i = 0; i < model.n; i++) if (model.cellType[i] === CT.VENTRICULAR) nVent++;

export const ISLAND = { phiSd: 55, longSd: 0.22 };

/** Named stimulus nodes, including positions relative to the M-cell island. */
export function stimNode(name: string): number {
  if (model.ectopicSites[name] !== undefined) return model.ectopicSites[name];
  const w = mCellWeights(model, { transmuralSd: 0.33, phiSd: ISLAND.phiSd, longSd: ISLAND.longSd, floor: 0.25 });
  let core = -1;
  let best = -1;
  for (let i = 0; i < model.n; i++) if (w[i] > best) [best, core] = [w[i], i];
  const near = (pred: (i: number) => boolean, around = core, maxR2 = 1e9) => {
    let n = -1;
    let d2 = maxR2;
    for (let i = 0; i < model.n; i++) {
      if (model.cellType[i] !== CT.VENTRICULAR || !pred(i)) continue;
      const dx = model.pos[3 * i] - model.pos[3 * around];
      const dy = model.pos[3 * i + 1] - model.pos[3 * around + 1];
      const dz = model.pos[3 * i + 2] - model.pos[3 * around + 2];
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < d2) [d2, n] = [r2, i];
    }
    return n;
  };
  if (name === "island-core") return core;
  // ring of mid-wall nodes at a fixed radius around the island core, indexed clockwise
  const ring = /^ring(\d+)of(\d+)r(\d+)$/.exec(name);
  if (ring) {
    const [k, n, r] = [+ring[1], +ring[2], +ring[3]];
    const f = model.frame;
    const cx = model.pos[3 * core], cy = model.pos[3 * core + 1], cz = model.pos[3 * core + 2];
    // local tangent basis in the wall plane at the core: long axis and its perpendicular
    const ax = f.axis as unknown as number[];
    const rad = [cx - f.baseCenter[0], cy - f.baseCenter[1], cz - f.baseCenter[2]];
    const dotA = rad[0] * ax[0] + rad[1] * ax[1] + rad[2] * ax[2];
    const out = [rad[0] - dotA * ax[0], rad[1] - dotA * ax[1], rad[2] - dotA * ax[2]];
    const on = Math.hypot(out[0], out[1], out[2]);
    const u = [out[1] * ax[2] - out[2] * ax[1], out[2] * ax[0] - out[0] * ax[2], out[0] * ax[1] - out[1] * ax[0]].map((x) => x / on); // circumferential
    const th = (2 * Math.PI * k) / n;
    const tx = cx + r * (Math.cos(th) * u[0] + Math.sin(th) * ax[0]);
    const ty = cy + r * (Math.cos(th) * u[1] + Math.sin(th) * ax[1]);
    const tz = cz + r * (Math.cos(th) * u[2] + Math.sin(th) * ax[2]);
    let best2 = Infinity, bn = -1;
    for (let i = 0; i < model.n; i++) {
      if (model.cellType[i] !== CT.VENTRICULAR) continue;
      const d2 = (model.pos[3 * i] - tx) ** 2 + (model.pos[3 * i + 1] - ty) ** 2 + (model.pos[3 * i + 2] - tz) ** 2;
      if (d2 < best2) [best2, bn] = [d2, i];
    }
    return bn;
  }
  if (name === "island-epi") return near((i) => model.transmural[i] > 0.9);
  if (name === "island-endo") return near((i) => model.transmural[i] < 0.1);
  throw new Error(`unknown stimulus site ${name}`);
}

/** Sinus QRS onsets (independent of the ventricular substrate). */
let sinusTimes: number[] | null = null;
function sinusQrsBefore(t: number): number {
  if (!sinusTimes) {
    const sim = new Simulator(model, setupParams({ apd: 1, grad: 1, floor: 0.45, cv: 1, het: 0, s2: 0, site: "lv-apex" }), W);
    sim.run(20000);
    sinusTimes = sim.drain().waves.filter((w) => Number.isFinite(w.tFirstVent)).map((w) => w.tFirstVent).sort((a, b) => a - b);
  }
  let best = sinusTimes![0];
  for (const x of sinusTimes!) if (x <= t) best = x;
  return best;
}

export function probe(s: Setup, tS1 = 5000) {
  const p = setupParams(s);
  const sim = new Simulator(model, p, W);
  const q = sinusQrsBefore(tS1);
  const t2 = q + s.s2;
  sim.stimulate(stimNode(s.site), t2);
  if (s.s3) sim.stimulate(stimNode(s.site3 ?? s.site), t2 + s.s3);
  sim.run(t2 + 4000);
  const o = sim.drain();
  // wave ids born at or after S2
  const born = o.waves.filter((w) => w.t0 >= t2 - 1).map((w) => w.id);
  const ids = new Set(born);
  let captured = 0;
  let last = t2;
  const seen = new Set<number>();
  for (let k = 0; k < o.recT.length; k++) {
    if (o.recT[k] < t2 - 1 || o.recT[k] > t2 + 500) continue;
    if (!ids.has(o.recWave[k])) continue;
    const n = o.recNode[k];
    if (model.cellType[n] !== CT.VENTRICULAR || seen.has(n)) continue;
    seen.add(n);
    captured++;
    last = Math.max(last, o.recT[k]);
  }
  const re = o.waves.filter((w) => w.origin === "reentry" && w.t0 >= t2);
  const vents = o.waves.filter((w) => Number.isFinite(w.tFirstVent) && w.tFirstVent > t2 + 30).sort((a, b) => a.tFirstVent - b.tFirstVent);
  let end = t2;
  for (const w of vents) {
    if (w.tFirstVent - end > 600) break;
    end = w.tFirstVent;
  }
  return { captured, frac: captured / nVent, span: last - t2, re: re.length, dur: end - t2, beats: vents.filter((w) => w.tFirstVent <= end).length };
}

if (process.argv[1].endsWith("tdp-block.ts")) {
  const list = (v: string | undefined, d: string) => (v ?? d).split(",").map(Number);
  const sites = (process.argv[6] ?? "island-epi").split(",");
  const smooth = +(process.argv[7] ?? 1);
  ISLAND.phiSd = +(process.argv[8] ?? 55);
  ISLAND.longSd = +(process.argv[9] ?? 0.22);
  {
    const p = setupParams({ apd: 1.3, grad: 1, floor: 0.45, cv: 1, het: 0, s2: 0, site: "island-epi", mBoost: +list(process.argv[2], "120")[0], smooth, phiSd: ISLAND.phiSd, longSd: ISLAND.longSd });
    const d = derive(model, p);
    const core = stimNode("island-core");
    const epi = stimNode("island-epi");
    console.log(`island core APDref ${d.apdRef[core].toFixed(0)} ms (ERP ${(d.apdRef[core] * d.erpRatio[core]).toFixed(0)}), epicardium over it ${d.apdRef[epi].toFixed(0)} ms (ERP ${(d.apdRef[epi] * d.erpRatio[epi]).toFixed(0)})\n`);
  }
  for (const mBoost of list(process.argv[2], "120"))
    for (const cv of list(process.argv[3], "1"))
      for (const floor of list(process.argv[4], "0.45"))
        for (const site of sites) {
          for (const s2 of list(process.argv[5], "300,310,320,330,340,350,360,370,380,390,400,410,420,430,440")) {
            const r = probe({ apd: 1.3, grad: 1, floor, cv, het: 0, s2, site, mBoost, smooth, phiSd: ISLAND.phiSd, longSd: ISLAND.longSd });
            if (r.captured > 0)
              console.log(
                `mB${mBoost} phi${ISLAND.phiSd} lng${ISLAND.longSd} sm${smooth} cv${cv} floor${floor} ${site} s2=${s2}: captured ${(100 * r.frac).toFixed(0)} % in ${r.span.toFixed(0)} ms | re ${r.re} | run ${r.dur.toFixed(0)} ms (${r.beats} beats)`,
              );
          }
          console.log("");
        }
}
