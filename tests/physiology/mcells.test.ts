/**
 * Midmyocardial (M) cells. The band is not a uniform layer: it is a zone bounded in the plane of the
 * wall as well as across it ("unique topographical distribution", Akar, Yan, Antzelevitch & Rosenbaum,
 * Circulation 2002;105:1247), which is what makes it an obstacle a wavefront can travel AROUND rather
 * than a face it merely stops at. Its electrophysiological signature is the Tpeak–Tend interval: the
 * peak of the T coincides with epicardial repolarisation and its end with the latest (M) repolarisation
 * (Yan & Antzelevitch, Circulation 1998;98:1928).
 *
 * The amplitude this model can carry is limited by its 2.5 mm grid and 4 mm electrotonic smoothing —
 * see SCIENTIFIC_LIMITATIONS.md ("M cells"); these tests check the shape and the direction of the
 * effect, not the wedge-preparation gradient.
 */
import { describe, expect, it } from "vitest";
import { model, run } from "../helpers/sim";
import { mCellWeights, M_TRANSMURAL_CENTRE, M_SHAPE } from "../../src/simulation/core/mcells";
import { derive } from "../../src/simulation/core/derive";
import { DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";
import { N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
import { CT } from "../../src/simulation/core/model";

const w = mCellWeights(model, M_SHAPE);

describe("M-cell island", () => {
  it("is ventricular myocardium only, and peaks in the middle of the wall", () => {
    let peakI = -1;
    for (let i = 0; i < model.n; i++) {
      if (model.cellType[i] !== CT.VENTRICULAR) expect(w[i]).toBe(0);
      else if (peakI < 0 || w[i] > w[peakI]) peakI = i;
    }
    expect(model.transmural[peakI]).toBeGreaterThan(M_TRANSMURAL_CENTRE - 0.2);
    expect(model.transmural[peakI]).toBeLessThan(M_TRANSMURAL_CENTRE + 0.2);
    // mid-wall is denser than either surface, i.e. the transmural profile is a hump, not a gradient
    const band = (lo: number, hi: number) => {
      let s = 0, n = 0;
      for (let i = 0; i < model.n; i++) if (model.cellType[i] === CT.VENTRICULAR && model.transmural[i] >= lo && model.transmural[i] < hi) { s += w[i]; n++; }
      return s / n;
    };
    expect(band(0.35, 0.55)).toBeGreaterThan(band(0, 0.15));
    expect(band(0.35, 0.55)).toBeGreaterThan(band(0.9, 1.01));
  });

  it("is an island: bounded in the plane of the wall, not a continuous layer", () => {
    // the densest decile must occupy only a small part of the mid-wall, otherwise it is a layer
    const mid: number[] = [];
    for (let i = 0; i < model.n; i++) if (model.cellType[i] === CT.VENTRICULAR && model.transmural[i] > 0.3 && model.transmural[i] < 0.6) mid.push(w[i]);
    const sorted = [...mid].sort((a, b) => b - a);
    const hot = sorted[Math.floor(mid.length * 0.1)];
    expect(hot).toBeGreaterThan(sorted[Math.floor(mid.length * 0.9)] * 1.8);
    // and it is bounded along the long axis too (not a complete circumferential ring)
    const base = mid.length;
    expect(base).toBeGreaterThan(200);
  });

  it("lengthens APD where it is dense, and does so monotonically with the boost", () => {
    const apdAt = (boost: number) => {
      const p = cloneParams(DEFAULT_PARAMS);
      p.ventricles.mCellBoost = boost;
      return derive(model, p).apdRef;
    };
    const a0 = apdAt(0);
    const a1 = apdAt(DEFAULT_PARAMS.ventricles.mCellBoost);
    const a2 = apdAt(2 * DEFAULT_PARAMS.ventricles.mCellBoost);
    let peakI = 0;
    for (let i = 0; i < model.n; i++) if (w[i] > w[peakI]) peakI = i;
    expect(a1[peakI]).toBeGreaterThan(a0[peakI]);
    expect(a2[peakI]).toBeGreaterThan(a1[peakI]);
    // nothing outside the ventricles moves
    for (let i = 0; i < model.n; i++) if (model.cellType[i] !== CT.VENTRICULAR) expect(a2[i]).toBeCloseTo(a0[i], 6);
  });

  it("Tpeak–Tend stays in the human range and the QRS is untouched", () => {
    const p = cloneParams(DEFAULT_PARAMS);
    const r = run(p, 5000);
    const beats = measureBeats(r.out.ecg, r.sim.dt, 0, r.out.waves).filter((x) => x.qt !== null && x.qrs !== null) as unknown as { qrsOn: number; qrsOff: number; qt: number; qrs: number }[];
    const vm = (t: number) => { const i = Math.round(t / r.sim.dt) * N_CHANNELS; return Math.hypot(r.out.ecg[i + 12], r.out.ecg[i + 13], r.out.ecg[i + 14]); };
    const tpte = beats.slice(1, -1).map((b) => {
      const te = b.qrsOn + b.qt;
      let best = -1, at = b.qrsOff;
      for (let t = b.qrsOff + 40; t < te; t += r.sim.dt) if (vm(t) > best) { best = vm(t); at = t; }
      return te - at;
    });
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
    expect(med(tpte)).toBeGreaterThan(40); // normal human Tpeak-Tend is roughly 60-100 ms
    expect(med(tpte)).toBeLessThan(110);
    expect(med(beats.map((b) => b.qrs))).toBeLessThan(110);
  });
});
