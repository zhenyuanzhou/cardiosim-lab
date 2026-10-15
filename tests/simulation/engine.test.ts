import { describe, expect, it } from "vitest";
import { Simulator } from "../../src/simulation/core/engine";
import { median, model, params, run, W } from "../helpers/sim";
import { CT, RG } from "../../src/simulation/core/model";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";

describe("determinism and time control", () => {
  it("identical seed and parameters give bit-identical output", () => {
    const a = run(params(), 4000);
    const b = run(params(), 4000);
    expect(a.out.ecg.length).toBe(b.out.ecg.length);
    expect(Buffer.from(a.out.ecg.buffer).equals(Buffer.from(b.out.ecg.buffer))).toBe(true);
    expect(Array.from(a.out.recT)).toEqual(Array.from(b.out.recT));
  });

  it("checkpoint → restore → replay reproduces the original continuation exactly", () => {
    const s = new Simulator(model, params(), W);
    s.run(2998);
    s.drain();
    const snap = s.snapshot();
    s.run(5998);
    const first = s.drain();
    s.restore(snap);
    s.run(5998);
    const second = s.drain();
    expect(Array.from(second.ecg)).toEqual(Array.from(first.ecg));
    expect(Array.from(second.recNode)).toEqual(Array.from(first.recNode));
  });

  it("a parameter change at time t affects only beats after t", () => {
    const s = new Simulator(model, params(), W);
    s.run(3998);
    s.setParams(params({ avNode: { ahMin: 180 } }));
    s.run(9998);
    const out = s.drain();
    const beats = measureBeats(out.ecg, s.dt, 0, out.waves);
    const before = beats.filter((b) => b.qrsOn < 3900 && b.pr !== null).map((b) => b.pr!);
    const after = beats.filter((b) => b.pOn !== null && b.pOn > 4500 && b.pr !== null).map((b) => b.pr!);
    expect(median(after) - median(before)).toBeGreaterThan(90);
    expect(Math.max(...before) - Math.min(...before)).toBeLessThanOrEqual(4);
  });
});

describe("conduction abnormalities emerging from the conduction model", () => {
  it("prolonged AV nodal conduction lengthens PR without changing QRS", () => {
    const a = run(params(), 7000);
    const b = run(params({ avNode: { ahMin: 180 } }), 7000);
    const m = (r: typeof a, f: (x: (typeof a.beats)[0]) => number | null) => median(r.beats.map(f).filter((x): x is number => x !== null));
    expect(m(b, (x) => x.pr) - m(a, (x) => x.pr)).toBeGreaterThan(100);
    expect(Math.abs(m(b, (x) => x.qrs) - m(a, (x) => x.qrs))).toBeLessThanOrEqual(4);
  });

  it("AV nodal refractoriness longer than the available recovery time drops ventricular activations", () => {
    const r = run(params({ sinus: { vagalTone: 0, sympatheticTone: 0, intrinsicRate: 110 }, avNode: { erp: 520 } }), 9000);
    const blocked = r.waves.filter((w) => w.origin === "sinus" && w.avnBlocked);
    const conducted = r.waves.filter((w) => w.origin === "sinus" && !w.avnBlocked && w.ventCount > 0);
    expect(blocked.length).toBeGreaterThan(0);
    expect(conducted.length).toBeGreaterThan(0);
    for (const w of blocked) {
      expect(w.atrialCount).toBe(model.counts.atrial); // P wave present…
      expect(w.ventCount).toBe(0); // …but no ventricular activation from it
    }
  });

  it("sinus arrest is followed by a junctional escape rhythm at the escape rate (overdrive release)", () => {
    const r = run(params({ sinus: { intrinsicRate: 30, vagalTone: 1 } }), 12000);
    const esc = r.waves.filter((w) => w.origin === "junctional");
    expect(esc.length).toBeGreaterThanOrEqual(3);
    const rr = esc.slice(1).map((w, i) => w.t0 - esc[i].t0);
    expect(median(rr)).toBeCloseTo(60000 / 45, -1);
    // junctional beats activate the ventricles via the normal His–Purkinje route (narrow QRS)
    for (const w of esc.slice(1)) expect(w.tLastVent - w.tFirstVent).toBeLessThan(110);
  });

  it("slowing the right bundle delays RV activation and widens QRS", () => {
    const a = run(params(), 6000);
    const b = run(params({ hisPurkinje: { rbbCv: 0.05 } }), 6000);
    const span = (r: typeof a) => median(r.waves.slice(2).map((w) => w.tLastVent - w.tFirstVent));
    expect(span(b)).toBeGreaterThan(span(a) + 20);
    const qrs = (r: typeof a) => median(r.beats.map((x) => x.qrs));
    expect(qrs(b)).toBeGreaterThan(qrs(a) + 20);
    // last activated region moves to the RV
    const w = b.waves[3];
    expect(model.region[w.lastVentNode]).toBe(RG.RV);
  });

  it("slowing the left bundle system makes the RV/septum activate before the LV free wall", () => {
    const b = run(params({ hisPurkinje: { lbbCv: 0.05, lafCv: 0.05, lpfCv: 0.05 } }), 6000);
    const w = b.waves[3];
    expect(model.region[w.lastVentNode]).toBe(RG.LV);
    expect(w.tLastVent - w.tFirstVent).toBeGreaterThan(100);
  });
});

describe("premature activation", () => {
  const lvEpi = model.probes.find((p) => p.id === "lvepi")!.node;

  it("a ventricular stimulus in diastole propagates through the whole ventricles and retrogradely into the His bundle", () => {
    const r = run(params(), 4000, (s) => s.stimulate(lvEpi, 2400));
    const ect = r.waves.find((w) => w.origin === "ectopic")!;
    expect(ect).toBeTruthy();
    expect(ect.ventCount).toBeGreaterThan(0.95 * model.counts.ventricular);
    expect(ect.tLastVent - ect.tFirstVent).toBeGreaterThan(110); // cell-to-cell spread → wide QRS
    expect(Number.isFinite(ect.tHisProximal) || Number.isFinite(ect.tHisDistal)).toBe(true);
  });

  it("a stimulus inside the refractory period is blocked", () => {
    const r = run(params(), 4000, (s) => s.stimulate(lvEpi, 2775 + 250));
    const ect = r.waves.filter((w) => w.origin === "ectopic");
    expect(ect.length).toBe(0);
  });

  it("activity terminates after a single premature beat (no sustained reentry without a substrate)", () => {
    const r = run(params(), 7000, (s) => s.stimulate(lvEpi, 2400));
    const ect = r.waves.find((w) => w.origin === "ectopic")!;
    // after the ectopic wave has finished, every ventricular activation belongs to a sinus wave
    const sinusIds = new Set(r.waves.filter((w) => w.origin === "sinus").map((w) => w.id));
    for (let k = 0; k < r.out.recT.length; k++) {
      if (r.out.recT[k] <= ect.tLastVent + 1) continue;
      if (model.cellType[r.out.recNode[k]] !== CT.VENTRICULAR) continue;
      expect(sinusIds.has(r.out.recWave[k])).toBe(true);
    }
    // no ventricular cell is activated twice by the ectopic wave
    expect(ect.ventCount).toBeLessThanOrEqual(model.counts.ventricular);
    // every later beat is sinus
    expect(r.waves.filter((w) => w.t0 > ect.t0 && w.origin !== "sinus").length).toBe(0);
  });

  it("each cell is activated at most once per wave", () => {
    const r = run(params(), 5000);
    const seen = new Set<string>();
    for (let k = 0; k < r.out.recT.length; k++) {
      const key = `${r.out.recWave[k]}:${r.out.recNode[k]}`;
      if (model.cellType[r.out.recNode[k]] === CT.AVN) continue;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
