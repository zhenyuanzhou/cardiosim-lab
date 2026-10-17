/**
 * Group F — acute ischaemia from a culprit lesion. Each test checks the lead pattern of Marriott's
 * "seven culprit risk areas" (Practical Electrocardiography 13th ed., Table 8.2) on the simulated
 * ECG, and the size of the ST shift against human 1-minute balloon occlusion (Haeberlin et al.,
 * J Electrocardiol 2014;47:29: LAD 0.26 mV [IQR 0.16–0.33] max, RCA 0.20 [0.09–0.26] in III,
 * LCx 0.04 [0.02–0.14] in V6). The LAD value was used to calibrate the ischaemic AP amplitude; the
 * RCA and LCx values are independent checks.
 *
 * ST is measured at J + 60 ms against the PR segment, in mV.
 */
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { run } from "../helpers/sim";
import { N_CHANNELS, ALL_LEAD_NAMES, channelOf } from "../../src/simulation/ecg-forward/leadField";
import { ischaemiaField, segmentWeights, type Culprit } from "../../src/simulation/core/ischaemia";
import { model } from "../helpers/sim";
import { CT, RG } from "../../src/simulation/core/model";

const cache = new Map<string, Record<string, number>>();
function st(culprit: Culprit): Record<string, number> {
  if (cache.has(culprit)) return cache.get(culprit)!;
  const s = culprit === "none" ? SCENARIOS.find((x) => x.id === "nsr")! : SCENARIOS.find((x) => x.id === `isch-${culprit}`)!;
  const r = run(s.apply!(), 4000);
  const ws = r.out.waves.filter((w) => Number.isFinite(w.tFirstVent)).sort((a, b) => a.tFirstVent - b.tFirstVent);
  const w = ws[ws.length - 2];
  const dt = r.sim.dt;
  const at = (ch: number, t: number) => r.out.ecg[Math.round(t / dt) * N_CHANNELS + ch];
  const out: Record<string, number> = {};
  for (const n of ALL_LEAD_NAMES) {
    const ch = channelOf(n);
    out[n] = at(ch, w.tLastVent + 60) - at(ch, w.tFirstVent - 15);
  }
  cache.set(culprit, out);
  return out;
}
const UP = 0.05; // 0.5 mm: "elevated" for a pattern test (the clinical STEMI threshold is 1 mm, see below)
const up = (c: Culprit, leads: string[]) => leads.forEach((l) => expect(st(c)[l], `${c} ${l}`).toBeGreaterThanOrEqual(UP));
const down = (c: Culprit, leads: string[]) => leads.forEach((l) => expect(st(c)[l], `${c} ${l}`).toBeLessThanOrEqual(-UP));

describe("territories (AHA 17-segment model)", () => {
  it("segment weights form a partition of unity and every territory lies in the ventricles", () => {
    for (const [ab, phi] of [[0.1, 10], [0.5, -100], [0.8, 170], [0.97, 0], [0.33, 59.5]] as const) {
      const w = segmentWeights(ab, phi);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
    }
    const f = ischaemiaField(model, "rca-prox");
    let rv = 0;
    for (let i = 0; i < model.n; i++) {
      if (model.cellType[i] !== CT.VENTRICULAR) expect(f[i]).toBe(0);
      else if (model.region[i] === RG.RV && f[i] > 0.9) rv++;
    }
    expect(rv).toBeGreaterThan(100); // proximal RCA includes the RV free wall
    expect(ischaemiaField(model, "rca-distal").some((x, i) => model.region[i] === RG.RV && x > 0)).toBe(false);
  });
});

describe("Group F — culprit risk areas (Marriott Table 8.2)", () => {
  it("baseline has no ST deviation", () => {
    for (const v of Object.values(st("none"))) expect(Math.abs(v)).toBeLessThan(0.03);
  });
  it("ischaemia lad-prox", () => {
    up("lad-prox", ["V2", "V3", "V4", "I", "aVL"]);
    down("lad-prox", ["III", "aVF"]);
  });
  it("ischaemia lad-diag", () => {
    up("lad-diag", ["I", "aVL"]);
    // the diagonal territory is small, so its reciprocal depression is smaller than the 0.05 mV pattern threshold
    for (const l of ["III", "aVF"]) expect(st("lad-diag")[l], l).toBeLessThan(-0.03);
    for (const l of ["V1", "V2", "V3"]) expect(Math.abs(st("lad-diag")[l]), l).toBeLessThan(0.1); // minimal anterior change (< 1 mm)
  });
  it("ischaemia lad-mid", () => {
    up("lad-mid", ["V3", "V4", "V5", "V6", "I", "II", "aVF"]);
    down("lad-mid", ["aVR"]);
  });
  it("ischaemia lcx-nondominant", () => {
    down("lcx-nondominant", ["V1", "V2", "V3", "V4"]);
    for (const l of ["II", "III", "aVF"]) expect(st("lcx-nondominant")[l]).toBeLessThan(UP); // minimal-to-no inferior elevation
    up("lcx-nondominant", ["V7", "V8"]); // posterior leads see the elevation directly
  });
  it("ischaemia lcx-dominant", () => {
    up("lcx-dominant", ["II", "III", "aVF"]);
    down("lcx-dominant", ["V2", "V3", "V4"]);
    expect(st("lcx-dominant").V1).toBeLessThanOrEqual(0);
  });
  it("ischaemia rca-prox", () => {
    up("rca-prox", ["III", "aVF", "V4R"]);
    expect(st("rca-prox").III).toBeGreaterThan(st("rca-prox").II); // III > II favours the RCA
    down("rca-prox", ["I", "aVL"]); // Marriott: aVL depression is "the clincher"
    // Right-ventricular involvement: ST elevation in V1 ≥ V2 (Marriott ch. 8, Fig. 8.8). Table 8.2 lists
    // V1–V3 depression for this row; the text and figure describe RV involvement as V1 elevation.
    expect(st("rca-prox").V1).toBeGreaterThanOrEqual(UP);
    expect(st("rca-prox").V1).toBeGreaterThanOrEqual(st("rca-prox").V2);
  });
  it("ischaemia rca-distal", () => {
    up("rca-distal", ["III", "aVF"]);
    down("rca-distal", ["I", "aVL"]);
    for (const l of ["V1", "V2", "V3"]) expect(st("rca-distal")[l]).toBeGreaterThan(-0.1); // minimal-to-no V1–V3 depression
    expect(st("rca-distal").V4R).toBeLessThan(st("rca-prox").V4R); // no RV branches
    expect(st("rca-distal").V1).toBeLessThan(st("rca-prox").V1);
  });
  it("ST-shift size matches human 1-minute balloon occlusion (Haeberlin et al. 2014)", () => {
    const max = (c: Culprit) => Math.max(...ALL_LEAD_NAMES.slice(0, 12).map((l) => Math.abs(st(c)[l])));
    const lad = (max("lad-prox") + max("lad-mid")) / 2;
    expect(lad).toBeGreaterThan(0.2); // calibrated to the median 0.26 mV
    expect(lad).toBeLessThan(0.32);
    for (const c of ["rca-prox", "rca-distal"] as const) {
      expect(st(c).III).toBeGreaterThanOrEqual(0.09); // independent check: RCA IQR 0.09–0.26 mV in III
      expect(st(c).III).toBeLessThanOrEqual(0.26);
    }
    expect(Math.abs(st("lcx-nondominant").V6)).toBeGreaterThanOrEqual(0.02); // independent check: LCx IQR 0.02–0.14 mV in V6
    expect(Math.abs(st("lcx-nondominant").V6)).toBeLessThanOrEqual(0.14);
  });
});
