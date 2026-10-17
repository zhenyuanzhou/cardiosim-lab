/**
 * TP06 ionic cell model and its mapping onto the tissue model (Group E, "partial" scenarios).
 * Each `TP06 mapping <key>` test recomputes the registry's APD/CV scale from the cell model and
 * checks the direction of the resulting tissue-level ECG change.
 */
import { describe, expect, it } from "vitest";
import { pace, TP06_DEFAULT_MODS, type PacedResult } from "../../src/simulation/cellular/tp06";
import { mapToTissue } from "../../src/simulation/cellular/ionicMapping";
import { potassiumEffect } from "../../src/simulation/cellular/electrolytes";
import { SCENARIOS, TP06_MAPPED } from "../../src/simulation/scenarios/scenarios";
import { run, median } from "../helpers/sim";

const CELLS = ["epi", "mid", "endo"] as const;
let base: PacedResult[] | null = null;
const baseline = () => (base ??= CELLS.map((c) => pace(c, TP06_DEFAULT_MODS, 1000, 30)));
const nsr = (() => {
  let r: ReturnType<typeof run> | null = null;
  return () => (r ??= run(SCENARIOS.find((s) => s.id === "nsr")!.apply!(), 6000));
})();

describe("TP06 single cell", () => {
  it("reproduces the published qualitative cell-type differences at CL 1000 ms", () => {
    const [epi, mid, endo] = baseline();
    for (const r of [epi, mid, endo]) {
      expect(r.vRest).toBeLessThan(-84);
      expect(r.vRest).toBeGreaterThan(-88);
      expect(r.vPeak).toBeGreaterThan(25);
      expect(r.captured).toBe(true);
    }
    expect(epi.apd90).toBeGreaterThan(270);
    expect(epi.apd90).toBeLessThan(330);
    expect(mid.apd90).toBeGreaterThan(epi.apd90 + 50); // M cell: low IKs → longest APD
    expect(Math.abs(endo.apd90 - epi.apd90)).toBeLessThan(30);
  }, 60000);
  it("APD shortens at faster pacing (rate adaptation)", () => {
    const fast = pace("epi", TP06_DEFAULT_MODS, 500, 30);
    expect(fast.apd90).toBeLessThan(baseline()[0].apd90 - 10); // direction only (30 beats ≠ full steady state)
  }, 60000);
});

const effects: Record<string, (q: ReturnType<typeof run>) => void> = {
  ikr50: (q) => expect(median(q.beats.slice(1, -1).map((b) => b.qt!))).toBeGreaterThan(median(nsr().beats.slice(1, -1).map((b) => b.qt!)) + 15),
  ikr90: (q) => expect(median(q.beats.slice(1, -1).map((b) => b.qt!))).toBeGreaterThan(median(nsr().beats.slice(1, -1).map((b) => b.qt!)) + 35),
  ikr200: (q) => expect(median(q.beats.slice(1, -1).map((b) => b.qt!))).toBeLessThan(median(nsr().beats.slice(1, -1).map((b) => b.qt!)) - 25),
  na50: (q) => expect(median(q.beats.map((b) => b.qrs))).toBeGreaterThan(median(nsr().beats.map((b) => b.qrs)) + 6),
  cal50: (q) => expect(median(q.beats.slice(1, -1).map((b) => b.qt!))).toBeLessThan(median(nsr().beats.slice(1, -1).map((b) => b.qt!)) - 40),
};

describe("Group E — potassium table (TP06)", () => {
  // electrolytes.ts stores TP06's response to [K⁺]o; recompute two rows from the cell model.
  for (const k of [3, 8]) {
    it(`TP06 potassium table at ${k} mM`, () => {
      const mod = CELLS.map((c) => pace(c, { ...TP06_DEFAULT_MODS, Ko: k }, 1000, 30));
      const map = mapToTissue(baseline(), mod);
      const e = potassiumEffect(k);
      expect(Math.abs(map.apdScale - e.apdScale)).toBeLessThan(0.01);
      expect(Math.abs(map.cvScale - e.cvScale)).toBeLessThan(0.01);
      const amp = (rs: PacedResult[]) => rs.reduce((a, r) => a + r.vPeak - r.vRest, 0) / rs.length;
      expect(Math.abs(amp(mod) / amp(baseline()) - e.ampScale)).toBeLessThan(0.01);
    }, 120000);
  }
});

describe("Group E — TP06 → tissue mapping", () => {
  for (const [key, m] of Object.entries(TP06_MAPPED)) {
    it(`TP06 mapping ${key}`, () => {
      const mod = CELLS.map((c) => pace(c, { ...TP06_DEFAULT_MODS, ...m.mods }, 1000, 30));
      const map = mapToTissue(baseline(), mod);
      expect(Math.abs(map.apdScale - m.apdScale)).toBeLessThan(0.01);
      expect(Math.abs(map.cvScale - m.cvScale)).toBeLessThan(0.01);
      const sc = SCENARIOS.find((s) => s.validation.includes(`TP06 mapping ${key}`))!;
      effects[key](run(sc.apply!(), 6000));
    }, 120000);
  }
});
