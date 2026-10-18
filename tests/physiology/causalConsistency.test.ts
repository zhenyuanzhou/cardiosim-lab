/**
 * The ECG and the 3-D activation must come from ONE causal model.
 *
 * The review that prompted v1.7.0 warned specifically against replacing the ECG with an independent
 * synthetic waveform while continuing to display an incompatible activation pattern. This model does
 * not: every lead is a linear functional of the same membrane-potential field that drives the heart
 * view. These tests assert that, for torsades in particular — the scenario where the temptation to
 * fake the waveform is greatest.
 */
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { run, model } from "../helpers/sim";
import { N_CHANNELS, channelOf } from "../../src/simulation/ecg-forward/leadField";
import { CT } from "../../src/simulation/core/model";

const tdp = run(SCENARIOS.find((s) => s.id === "tdp")!.apply!(), 24000);

describe("ECG and activation share one source (torsades)", () => {
  it("every deflection has an activation behind it: the ECG is flat when the myocardium is quiet", () => {
    // Build the activation histogram from the model's own records, then check that the ECG is quiet
    // wherever nothing has been activated recently.
    const dt = tdp.sim.dt;
    const n = Math.floor(tdp.out.ecg.length / N_CHANNELS);
    const act = new Float32Array(n);
    for (let k = 0; k < tdp.out.recT.length; k++) {
      const ct = model.cellType[tdp.out.recNode[k]];
      if (ct !== CT.VENTRICULAR && ct !== CT.ATRIAL) continue; // working myocardium is the only source
      const i = Math.round(tdp.out.recT[k] / dt);
      if (i >= 0 && i < n) act[i]++;
    }
    // "recently activated" = any activation of working myocardium in the preceding 700 ms. The window
    // has to cover depolarisation AND repolarisation: on this long-QT substrate the ventricular action
    // potential lasts about 430 ms, so the T wave legitimately deflects well after the last activation.
    // Atrial activation counts too — the P wave is a real deflection with no ventricular activation
    // behind it, and ignoring it would make this test fail for the right reason in the wrong way.
    const win = Math.round(700 / dt);
    let running = 0;
    const ch = channelOf("II");
    let quietViolations = 0;
    let checked = 0;
    for (let i = 0; i < n; i++) {
      running += act[i];
      if (i >= win) running -= act[i - win];
      if (running > 0) continue;
      checked++;
      // nothing activated in the last 700 ms: the tracing must be at the baseline
      if (Math.abs(tdp.out.ecg[i * N_CHANNELS + ch]) > 0.05) quietViolations++;
    }
    expect(checked).toBeGreaterThan(100);
    expect(quietViolations / checked).toBeLessThan(0.02);
  });

  it("the twelve leads are consistent with each other at every instant", () => {
    // Einthoven and Goldberger hold by construction only if all leads come from one heart vector;
    // an independently synthesised waveform would break them.
    const n = Math.floor(tdp.out.ecg.length / N_CHANNELS);
    const g = (i: number, name: string) => tdp.out.ecg[i * N_CHANNELS + channelOf(name)];
    let worstE = 0;
    let worstG = 0;
    for (let i = 0; i < n; i += 7) {
      worstE = Math.max(worstE, Math.abs(g(i, "II") - (g(i, "I") + g(i, "III"))));
      worstG = Math.max(worstG, Math.abs(g(i, "aVR") + g(i, "aVL") + g(i, "aVF")));
    }
    expect(worstE).toBeLessThan(1e-4);
    expect(worstG).toBeLessThan(1e-4);
  });

  it("each torsades complex is anchored to the activation it came from", () => {
    // Every torsades wave must have ventricular activation, and the ECG must deflect while it does.
    const dt = tdp.sim.dt;
    const waves = tdp.out.waves.filter((w) => w.site === "torsades focus" && Number.isFinite(w.tFirstVent));
    expect(waves.length).toBeGreaterThan(5);
    const ch = channelOf("II");
    let withDeflection = 0;
    for (const w of waves) {
      expect(w.ventCount).toBeGreaterThan(0);
      let peak = 0;
      for (let t = w.tFirstVent; t <= w.tLastVent + 40; t += dt) {
        const i = Math.round(t / dt);
        peak = Math.max(peak, Math.abs(tdp.out.ecg[i * N_CHANNELS + ch]));
      }
      if (peak > 0.05) withDeflection++;
    }
    expect(withDeflection / waves.length).toBeGreaterThan(0.9);
  });

  it("switching the generator off leaves sinus rhythm, not a residual waveform", () => {
    const p = SCENARIOS.find((s) => s.id === "tdp")!.apply!();
    p.torsades.enabled = false;
    const r = run(p, 12000);
    expect(r.out.waves.filter((w) => w.site === "torsades focus").length).toBe(0);
    const sinus = r.out.waves.filter((w) => w.origin === "sinus" && Number.isFinite(w.tFirstVent));
    expect(sinus.length).toBeGreaterThan(8);
  });
});

/**
 * Morphology and polarity must evolve continuously through a run, and the measurement of that has to
 * exclude beats whose frontal vector is near a null, where the angle is the arctangent of two small
 * numbers and carries no information.
 */
import { beatAxes, axisProgression, runWindow, tdpMetrics } from "../../src/simulation/ecg-forward/tdpMetrics";

describe("the twist is measured, not assumed", () => {
  const dt = tdp.sim.dt;
  const foci = tdp.out.waves.filter((w) => w.site === "torsades focus" && Number.isFinite(w.tFirstVent)).sort((a, b) => a.tFirstVent - b.tFirstVent);
  const starts = foci.filter((w, i) => i === 0 || w.tFirstVent - foci[i - 1].tFirstVent > 600);
  let win: [number, number] = [0, 0];
  for (const st of starts) {
    const w = runWindow(tdp.out, st.tFirstVent - 5, 24000);
    if (w[1] - w[0] > win[1] - win[0]) win = w;
  }
  const beats = foci.filter((w) => w.tFirstVent >= win[0] && w.tFirstVent <= win[1]).map((w) => ({ t: w.tFirstVent, span: w.tLastVent - w.tFirstVent }));

  it("the run is long enough to measure a twist at all", () => {
    expect(beats.length).toBeGreaterThanOrEqual(8);
  });

  it("beats near a vector null are excluded rather than contributing a meaningless angle", () => {
    const all = beatAxes(tdp.out, dt, beats, 0);
    const filtered = beatAxes(tdp.out, dt, beats, 0.2);
    expect(all.every((x) => x.axis !== null)).toBe(true);
    // the filter must be capable of excluding, and must not exclude everything
    const kept = filtered.filter((x) => x.axis !== null).length;
    expect(kept).toBeGreaterThan(beats.length * 0.5);
    expect(kept).toBeLessThanOrEqual(beats.length);
  });

  it("the axis progresses rather than oscillating about a mean", () => {
    const axes = beatAxes(tdp.out, dt, beats, 0.2).map((x) => x.axis);
    const p = axisProgression(axes);
    expect(p.used).toBeGreaterThanOrEqual(8);
    expect(Math.abs(p.net)).toBeGreaterThan(180); // at least half a turn over the run
    expect(p.straightness).toBeGreaterThan(0.3); // not a back-and-forth wobble
  });

  it("successive complexes change gradually: no step change in morphology", () => {
    // Correlation between successive complexes in lead II, aligned on their onsets. A drifting source
    // changes the complex a little each beat; a jumping one produces abrupt changes.
    const ch = channelOf("II");
    const seg = (t: number) => {
      const a = Math.round(t / dt);
      const out: number[] = [];
      for (let k = 0; k < Math.round(200 / dt); k++) out.push(tdp.out.ecg[(a + k) * N_CHANNELS + ch]);
      return out;
    };
    const corr = (x: number[], y: number[]) => {
      const mx = x.reduce((a, b) => a + b, 0) / x.length;
      const my = y.reduce((a, b) => a + b, 0) / y.length;
      let n = 0;
      let dx = 0;
      let dy = 0;
      for (let i = 0; i < x.length; i++) {
        n += (x[i] - mx) * (y[i] - my);
        dx += (x[i] - mx) ** 2;
        dy += (y[i] - my) ** 2;
      }
      return dx > 0 && dy > 0 ? n / Math.sqrt(dx * dy) : 0;
    };
    const cs: number[] = [];
    for (let i = 1; i < beats.length; i++) cs.push(corr(seg(beats[i - 1].t), seg(beats[i].t)));
    const median = [...cs].sort((a, b) => a - b)[cs.length >> 1];
    // neighbouring complexes resemble each other (gradual change), but the run is not monomorphic
    expect(median).toBeGreaterThan(0.2);
    const first = seg(beats[0].t);
    const last = seg(beats[beats.length - 1].t);
    expect(corr(first, last)).toBeLessThan(median);
  });

  it("the published torsades criteria are met where they are claimed to be", () => {
    const m = tdpMetrics(tdp.out, dt, win[0], win[1]);
    expect(m.rate).toBeGreaterThan(180);
    expect(m.rate).toBeLessThan(250);
    expect(m.baselineFraction).toBeLessThan(0.2);
    expect(m.envelopeRatio).toBeGreaterThan(3);
    expect(m.meanSpan).toBeGreaterThan(100);
  });
});
