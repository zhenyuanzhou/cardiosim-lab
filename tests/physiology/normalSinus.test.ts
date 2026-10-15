import { describe, expect, it } from "vitest";
import { activationTimes, median, model, params, run } from "../helpers/sim";
import { CT, RG } from "../../src/simulation/core/model";

/**
 * Normal physiology. Reference values: AH 76 ± 16 ms, HV 45 ± 6 ms (Lee & Lien 1975);
 * PR 120–200 ms, QRS < 110 ms (Surawicz 2009), QTc ≤ 450 ms (Rautaharju 2009);
 * activation sequence after Durrer et al. 1970.
 */
const base = run(params(), 9000);
const sinus = base.waves.filter((w) => w.origin === "sinus" && w.tVentRepolEnd < 9000);
const steady = base.beats.filter((b) => b.qt !== null && b.rr !== null);

describe("normal sinus rhythm — activation sequence", () => {
  it("produces only sinus beats (latent pacemakers stay suppressed)", () => {
    expect(base.waves.every((w) => w.origin === "sinus")).toBe(true);
    expect(sinus.length).toBeGreaterThanOrEqual(8);
  });

  it("follows SA → atria → AV node → His → bundles → Purkinje → ventricles for every beat", () => {
    for (const w of sinus) {
      const seq = [w.t0, w.tFirstAtrial, w.tAvnIn, w.tAvnOut, w.tHisDistal, Math.min(w.tFirstLBB, w.tFirstRBB), Math.min(w.tFirstPurkinjeLV, w.tFirstPurkinjeRV), w.tFirstVent, w.tLastVent];
      for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
    }
  });

  it("conducts 1:1 and activates every atrial and ventricular cell once per beat", () => {
    for (const w of sinus) {
      expect(w.avnBlocked).toBe(false);
      expect(w.atrialCount).toBe(model.counts.atrial);
      expect(w.ventCount).toBe(model.counts.ventricular);
    }
  });

  it("activates the right atrium before the left atrium", () => {
    const w = sinus[3];
    const at = activationTimes(base.out, w.id);
    let ra = Infinity;
    let la = Infinity;
    for (const [n, t] of at) {
      if (model.cellType[n] !== CT.ATRIAL) continue;
      if (model.region[n] === RG.LA) la = Math.min(la, t);
      else ra = Math.min(ra, t);
    }
    expect(ra).toBeLessThan(la);
  });

  it("starts ventricular activation on the septum / LV endocardium and ends basally (Durrer 1970)", () => {
    const w = sinus[3];
    expect([RG.SEPTUM, RG.LV]).toContain(model.region[w.firstVentNode]);
    expect(model.transmural[w.firstVentNode]).toBeLessThan(0.4);
    expect(model.apicobasal[w.lastVentNode]).toBeLessThan(0.35);
  });

  it("activates the LV septal surface before the RV endocardium", () => {
    const w = sinus[3];
    expect(w.tFirstPurkinjeLV - w.tFirstLBB).toBeGreaterThanOrEqual(0);
    const at = activationTimes(base.out, w.id);
    let sept = Infinity;
    let rv = Infinity;
    for (const [n, t] of at) {
      if (model.cellType[n] !== CT.VENTRICULAR) continue;
      if (model.region[n] === RG.SEPTUM) sept = Math.min(sept, t);
      if (model.region[n] === RG.RV) rv = Math.min(rv, t);
    }
    expect(sept).toBeLessThan(rv);
  });
});

describe("normal sinus rhythm — intervals", () => {
  it("has a regular sinus rate equal to the autonomically modulated SA rate", () => {
    const rr = median(steady.map((b) => b.rr!));
    expect(Math.abs(rr - base.sim.d.sinusCycle)).toBeLessThan(base.sim.dt + 0.5);
  });
  it("AH and HV fall within ±2 SD of Lee & Lien (1975)", () => {
    const ah = median(sinus.map((w) => w.tAvnOut - w.tAvnIn));
    const hv = median(sinus.map((w) => w.tFirstVent - w.tHisProximal));
    expect(ah).toBeGreaterThanOrEqual(76 - 32);
    expect(ah).toBeLessThanOrEqual(76 + 32);
    expect(hv).toBeGreaterThanOrEqual(45 - 12);
    expect(hv).toBeLessThanOrEqual(45 + 12);
  });
  it("PR, P duration, QRS and QTc are in adult normal ranges (signal-derived)", () => {
    const pr = median(steady.map((b) => b.pr!));
    const pd = median(steady.map((b) => b.pOff! - b.pOn!));
    const qrs = median(steady.map((b) => b.qrs));
    const qtc = median(steady.map((b) => b.qtcBazett!));
    expect(pr).toBeGreaterThanOrEqual(120);
    expect(pr).toBeLessThanOrEqual(200);
    expect(pd).toBeLessThan(120);
    expect(qrs).toBeGreaterThanOrEqual(70);
    expect(qrs).toBeLessThan(110);
    expect(qtc).toBeGreaterThan(350);
    expect(qtc).toBeLessThanOrEqual(450);
  });
  it("has a normal frontal QRS axis and P axis", () => {
    const ax = median(steady.map((b) => b.axisQRS));
    const pax = median(steady.map((b) => b.axisP!));
    expect(ax).toBeGreaterThanOrEqual(-30);
    expect(ax).toBeLessThanOrEqual(90);
    expect(pax).toBeGreaterThanOrEqual(0);
    expect(pax).toBeLessThanOrEqual(75);
  });
  it("produces stable beat-to-beat morphology at constant rate", () => {
    const later = steady.slice(2);
    const qrs = later.map((b) => b.qrs);
    const qt = later.map((b) => b.qt!);
    expect(Math.max(...qrs) - Math.min(...qrs)).toBeLessThanOrEqual(4);
    expect(Math.max(...qt) - Math.min(...qt)).toBeLessThanOrEqual(6);
  });
  it("keeps the T wave concordant with the QRS in lead II and V5", () => {
    // area of T in II and V5 must be positive (upright) as the QRS is predominantly positive there
    const b = steady[4];
    const dt = base.sim.dt;
    const area = (lead: number, t0: number, t1: number) => {
      let s = 0;
      for (let t = t0; t <= t1; t += dt) s += base.out.ecg[Math.round(t / dt) * 15 + lead];
      return s;
    };
    for (const lead of [1, 10]) {
      expect(area(lead, b.qrsOn, b.qrsOff)).toBeGreaterThan(0);
      expect(area(lead, b.qrsOff + 80, b.tEnd!)).toBeGreaterThan(0);
    }
  });
});
