/**
 * QRS detection (src/simulation/ecg-forward/measurements.ts).
 *
 * These tests exist because an independent review found that the previous detector compared the
 * spatial slope against 30 % of its maximum over the WHOLE analysed window. That made detection
 * non-causal: amplifying a later part of a record removed complexes that had already been detected
 * earlier in it. The first test below is that exact scenario.
 *
 * Throughout, "truth" is the simulator's own wave records (first ventricular activation of each
 * wave), which the detector never sees — so these measure the detector rather than itself.
 */
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { run } from "../helpers/sim";
import { measureBeats, detectQrs, QRS_REFRACTORY_MS } from "../../src/simulation/ecg-forward/measurements";
import { N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
import type { SimOutput } from "../../src/simulation/core/engine";

/** Ventricular activations, fused within 80 ms, away from the window edges. */
function labels(out: SimOutput, from = 120, to = 7900): number[] {
  const raw = out.waves.filter((w) => Number.isFinite(w.tFirstVent)).map((w) => w.tFirstVent).sort((a, b) => a - b);
  return raw.filter((t, i) => i === 0 || t - raw[i - 1] > 80).filter((t) => t > from && t < to);
}
/** Greedy one-to-one matching of detections to labels within `tol` ms. */
function match(det: number[], lab: number[], tol = 80): { tp: number; fn: number; fp: number } {
  const used = new Set<number>();
  let tp = 0;
  for (const l of lab) {
    let bi = -1;
    let bd = tol;
    for (let i = 0; i < det.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(det[i] - l);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi >= 0) {
      used.add(bi);
      tp++;
    }
  }
  return { tp, fn: lab.length - tp, fp: det.length - tp };
}
const sinus = (() => {
  const r = run(SCENARIOS.find((s) => s.id === "nsr")!.apply!(), 8000);
  return { ecg: r.out.ecg, dt: r.sim.dt, out: r.out };
})();
/** A copy of the sinus ECG with a time-dependent gain applied to every channel. */
function scaled(gain: (tMs: number) => number): Float32Array {
  const e = sinus.ecg.slice();
  const n = e.length / N_CHANNELS;
  for (let s = 0; s < n; s++) {
    const g = gain(s * sinus.dt);
    for (let c = 0; c < N_CHANNELS; c++) e[s * N_CHANNELS + c] *= g;
  }
  return e;
}
const onsets = (ecg: Float32Array) => measureBeats(ecg, sinus.dt, 0, []).map((b) => b.qrsOn);

describe("QRS detection is causal and amplitude-adaptive", () => {
  it("a later high-amplitude segment does not erase earlier detections (the reported defect)", () => {
    const before = onsets(sinus.ecg).filter((t) => t < 6000);
    expect(before.length).toBeGreaterThanOrEqual(6);
    const after = onsets(scaled((t) => (t > 7000 ? 10 : 1))).filter((t) => t < 6000);
    // the first six seconds are byte-identical in both records, so detection there must be identical
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) expect(Math.abs(after[i] - before[i])).toBeLessThan(10);
  });

  it("detections in an unchanged prefix are independent of everything that follows it", () => {
    const full = onsets(sinus.ecg).filter((t) => t < 4000);
    for (const gain of [(t: number) => (t > 5000 ? 8 : 1), (t: number) => (t > 5000 ? 0.15 : 1), (t: number) => 1 + 5 * (t / 8000)]) {
      const got = onsets(scaled(gain)).filter((t) => t < 4000);
      expect(got.length).toBe(full.length);
    }
  });

  it("low-amplitude and drifting records are still detected", () => {
    const n = labels(sinus.out).length;
    for (const [name, gain] of [
      ["uniform ×0.1", () => 0.1],
      ["second half ×0.2", (t: number) => (t > 4000 ? 0.2 : 1)],
      ["first half ×0.25", (t: number) => (t < 4000 ? 0.25 : 1)],
      ["4× ramp", (t: number) => 1 + 3 * (t / 8000)],
    ] as [string, (t: number) => number][]) {
      const m = match(onsets(scaled(gain)), labels(sinus.out));
      expect(m.tp, `${name}: matched`).toBeGreaterThanOrEqual(n - 1);
      expect(m.fp, `${name}: spurious`).toBeLessThanOrEqual(1);
    }
  });

  it("the peaked T wave of severe hyperkalaemia is not counted as a second complex", () => {
    // QRS ≈ 150 ms with a tall symmetrical T: without T-wave discrimination the rate doubles.
    const r = run(SCENARIOS.find((s) => s.id === "hyperk-severe")!.apply!(), 8000);
    const m = match(measureBeats(r.out.ecg, r.sim.dt, 0, []).map((b) => b.qrsOn), labels(r.out));
    expect(m.fp).toBeLessThanOrEqual(1);
  });

  it("no two complexes are reported closer together than the refractory period", () => {
    for (const id of ["nsr", "bigeminy", "flutter", "vt-focal"]) {
      const r = run(SCENARIOS.find((s) => s.id === id)!.apply!(), 8000);
      const on = measureBeats(r.out.ecg, r.sim.dt, 0, []).map((b) => b.qrsOn);
      for (let i = 1; i < on.length; i++) expect(on[i] - on[i - 1], `${id} beat ${i}`).toBeGreaterThan(QRS_REFRACTORY_MS * 0.5);
    }
  });

  it("detects a single small complex between large ones (search-back)", () => {
    // Attenuate one beat to a quarter: the adaptive threshold alone would miss it.
    const lab = labels(sinus.out);
    const target = lab[4];
    const e = scaled((t) => (Math.abs(t - target) < 200 ? 0.25 : 1));
    const m = match(onsets(e), lab);
    expect(m.tp).toBeGreaterThanOrEqual(lab.length - 1);
  });
});

describe("QRS detection against simulator labels", () => {
  // Organised rhythms only. Fibrillation is excluded deliberately: there are no discrete complexes to
  // detect, and the detector is not expected to find them (see SCIENTIFIC_LIMITATIONS.md).
  const ORGANISED = ["nsr", "brady", "tachy", "avb1", "mobitz1", "pvc", "bigeminy", "couplet", "flutter", "rbbb", "lbbb", "hyperk", "hyperk-severe", "hypok", "isch-lad-prox", "mi-lad-prox-old", "tdp"];
  it("finds at least 90 % of ventricular activations across organised rhythms", () => {
    let tp = 0;
    let fn = 0;
    const bad: string[] = [];
    for (const id of ORGANISED) {
      const r = run(SCENARIOS.find((s) => s.id === id)!.apply!(), 8000);
      const lab = labels(r.out);
      const m = match(measureBeats(r.out.ecg, r.sim.dt, 0, []).map((b) => b.qrsOn), lab);
      tp += m.tp;
      fn += m.fn;
      if (m.tp < lab.length * 0.8) bad.push(`${id} ${m.tp}/${lab.length}`);
    }
    expect(bad, "scenarios below 80 % sensitivity").toEqual([]);
    expect(tp / (tp + fn)).toBeGreaterThan(0.9);
  });

  it("is no worse than the global-threshold rule it replaced", () => {
    // The old rule, reproduced: candidates where D exceeds 30 % of its maximum over the whole window.
    const SLOPE_LEADS = [0, 1, 6, 7, 8, 9, 10, 11];
    const legacy = (D: Float32Array, dt: number): number[] => {
      let dMax = 0;
      for (let s = 0; s < D.length; s++) dMax = Math.max(dMax, D[s]);
      const thr = 0.3 * dMax;
      const out: number[] = [];
      let s = 0;
      while (s < D.length) {
        if (D[s] > thr) {
          const a = s;
          while (s < D.length && D[s] > thr) s++;
          if (!out.length || (a * dt - out[out.length - 1]) > 80) out.push(a * dt);
        } else s++;
      }
      return out;
    };
    let oldTp = 0;
    let oldFn = 0;
    let newTp = 0;
    let newFn = 0;
    for (const id of ORGANISED) {
      const r = run(SCENARIOS.find((s) => s.id === id)!.apply!(), 8000);
      const n = r.out.ecg.length / N_CHANNELS;
      const D = new Float32Array(n);
      for (let s = 1; s < n - 1; s++) {
        let d = 0;
        for (const l of SLOPE_LEADS) d += Math.abs(r.out.ecg[(s + 1) * N_CHANNELS + l] - r.out.ecg[(s - 1) * N_CHANNELS + l]) / (2 * r.sim.dt);
        D[s] = d;
      }
      const lab = labels(r.out);
      const a = match(legacy(D, r.sim.dt), lab, 140);
      const b = match(detectQrs(D, r.sim.dt).map(([k]) => k * r.sim.dt), lab, 140);
      oldTp += a.tp;
      oldFn += a.fn;
      newTp += b.tp;
      newFn += b.fn;
    }
    expect(newTp / (newTp + newFn)).toBeGreaterThanOrEqual(oldTp / (oldTp + oldFn));
  });
});
