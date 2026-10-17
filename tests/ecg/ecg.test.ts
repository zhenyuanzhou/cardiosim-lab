import { describe, expect, it } from "vitest";
import { median, model, params, run, W } from "../helpers/sim";
import { N_COLS, N_CHANNELS, LEAD_NAMES, channelOf } from "../../src/simulation/ecg-forward/leadField";
import { CT } from "../../src/simulation/core/model";

const base = run(params(), 8000);
const nS = base.out.ecg.length / N_CHANNELS;
const x = (s: number, l: number) => base.out.ecg[s * N_CHANNELS + l];

describe("lead system", () => {
  it("satisfies Einthoven's law and the Goldberger identity exactly", () => {
    let e = 0;
    let g = 0;
    for (let s = 0; s < nS; s++) {
      e = Math.max(e, Math.abs(x(s, 1) - (x(s, 0) + x(s, 2))));
      g = Math.max(g, Math.abs(x(s, 3) + x(s, 4) + x(s, 5)));
    }
    expect(e).toBeLessThan(1e-5);
    expect(g).toBeLessThan(1e-5);
  });

  it("lead-field weights sum to zero (uniform tissue potential gives no signal)", () => {
    for (let c = 0; c < N_COLS; c++) {
      let s = 0;
      let a = 0;
      for (let i = 0; i < model.n; i++) {
        s += W[i * N_COLS + c];
        a += Math.abs(W[i * N_COLS + c]);
      }
      expect(Math.abs(s)).toBeLessThan(1e-6 * a + 1e-9);
    }
  });

  it("a wavefront travelling toward the chest gives positive anterior-lead deflections", () => {
    const col = new Array(N_COLS).fill(0);
    for (let i = 0; i < model.n; i++) if (model.cellType[i] === CT.VENTRICULAR && model.pos[3 * i + 2] < 0) for (let c = 0; c < N_COLS; c++) col[c] += W[i * N_COLS + c] * 120;
    expect(col[2]).toBeGreaterThan(0); // Pz (anterior)
    expect(col[3 + 1]).toBeGreaterThan(0); // V2
  });

  it("is isoelectric when all cells are at rest", () => {
    // the first 40 ms precede the first SA discharge
    for (let s = 0; s < 15; s++) for (let l = 0; l < 12; l++) expect(Math.abs(x(s, l))).toBeLessThan(1e-6);
  });
});

describe("timing coherence", () => {
  it("the QRS starts with the first ventricular activation (earliest lead ≤ 10 ms, every lead ≤ 30 ms)", () => {
    const w = base.waves[4];
    const ons: number[] = [];
    const dt = base.sim.dt;
    for (let l = 0; l < 12; l++) {
      // first sample after P/PR where |dV/dt| exceeds 5 % of the lead's max QRS slope
      let mx = 0;
      for (let t = w.tFirstVent - 20; t < w.tLastVent + 10; t += dt) {
        const s = Math.round(t / dt);
        mx = Math.max(mx, Math.abs(x(s + 1, l) - x(s - 1, l)));
      }
      let on = NaN;
      for (let t = w.tFirstVent - 30; t < w.tLastVent; t += dt) {
        const s = Math.round(t / dt);
        if (Math.abs(x(s + 1, l) - x(s - 1, l)) > 0.05 * mx) {
          on = t;
          break;
        }
      }
      ons.push(on - w.tFirstVent);
    }
    // Global onset (earliest lead) coincides with the first ventricular activation.
    expect(Math.min(...ons.map(Math.abs))).toBeLessThanOrEqual(10);
    // A single lead nearly perpendicular to the initial (septal) forces stays isoelectric at first, so its
    // own onset is later (V5: 24 ms since the v1.4 chest recalibration); none may lag by more than 30 ms.
    for (const d of ons) expect(Math.abs(d)).toBeLessThanOrEqual(30);
  });

  it("signal-derived intervals agree with the activation model (activation map ↔ ECG)", () => {
    const b = base.beats.filter((q) => q.truth && q.qt !== null && q.pr !== null);
    expect(b.length).toBeGreaterThan(5);
    for (const q of b) {
      const t = q.truth!;
      expect(Math.abs(q.qrsOn - t.qrsOn)).toBeLessThanOrEqual(6);
      expect(Math.abs(q.qrs - (t.qrsOff - t.qrsOn))).toBeLessThanOrEqual(10);
      expect(Math.abs(q.pr! - (t.qrsOn - t.pOn!))).toBeLessThanOrEqual(10);
      expect(Math.abs(q.qt! - (t.repolEnd - t.qrsOn))).toBeLessThanOrEqual(20);
    }
  });

  it("measurements are reproducible for deterministic simulations", () => {
    const again = run(params(), 8000);
    expect(JSON.stringify(again.beats)).toBe(JSON.stringify(base.beats));
  });
});

describe("extra chest leads (v1.5.0)", () => {
  it("right-sided leads are small rS complexes and posterior leads are R-dominant", () => {
    const w = base.waves[4];
    const dt = base.sim.dt;
    const pp = (name: string) => {
      const ch = channelOf(name);
      let hi = 0;
      let lo = 0;
      for (let t = w.tFirstVent - 10; t < w.tLastVent + 10; t += dt) {
        const v = x(Math.round(t / dt), ch);
        hi = Math.max(hi, v);
        lo = Math.min(lo, v);
      }
      return { R: hi, S: -lo };
    };
    for (const n of ["V3R", "V4R", "V5R", "V6R"]) {
      const a = pp(n);
      expect(a.S, n).toBeGreaterThan(a.R); // rS: the left ventricle activates away from the right chest
      expect(a.R + a.S, n).toBeLessThan(pp("V1").R + pp("V1").S); // smaller than V1
    }
    for (const n of ["V7", "V8", "V9"]) expect(pp(n).R, n).toBeGreaterThan(pp(n).S);
  });
});

describe("amplitudes (v1.4.0 calibration)", () => {
  it("sinus QRS amplitudes are within a factor of 2 of population medians", () => {
    // Medians, Cleveland Family Study visit 5 (n = 732; sleepdata.org). Remaining misfit is documented
    // in SCIENTIFIC_LIMITATIONS.md ("ECG amplitudes"); the bound guards against the 2–3× error of ≤ v1.3.
    const w = base.waves[4];
    const dt = base.sim.dt;
    const ext = (l: number) => {
      let hi = 0;
      let lo = 0;
      for (let t = w.tFirstVent - 10; t < w.tLastVent + 10; t += dt) {
        const v = x(Math.round(t / dt), l);
        hi = Math.max(hi, v);
        lo = Math.min(lo, v);
      }
      return { R: hi, S: -lo };
    };
    const within2 = (model: number, median: number) => {
      expect(model).toBeGreaterThan(median / 2);
      expect(model).toBeLessThan(median * 2);
    };
    within2(ext(0).R, 0.751); // lead I R
    within2(ext(6 + 1).R, 0.351); // V2 R
    within2(ext(6 + 1).S, 0.937); // V2 S
    within2(ext(6 + 2).R, 0.705); // V3 R
    within2(ext(6 + 3).S, 0.332); // V4 S
    within2(ext(6 + 5).R, 1.083); // V6 R
  });
});

describe("QRS changes with the activation vector", () => {
  const terminalArea = (r: typeof base, lead: number) => {
    const dt = r.sim.dt;
    const vals = r.beats.slice(2, 6).map((b) => {
      let s = 0;
      for (let t = b.qrsOff - 40; t <= b.qrsOff; t += dt) s += r.out.ecg[Math.round(t / dt) * N_CHANNELS + lead] * dt;
      return s;
    });
    return median(vals);
  };
  it("right-bundle failure adds terminal rightward/anterior forces (V1 more positive, lead I more negative)", () => {
    const rbb = run(params({ hisPurkinje: { rbbCv: 0.05 } }), 8000);
    const v1 = LEAD_NAMES.indexOf("V1");
    expect(terminalArea(rbb, v1)).toBeGreaterThan(terminalArea(base, v1));
    expect(terminalArea(rbb, 0)).toBeLessThan(terminalArea(base, 0));
  });
  it("left-bundle failure reverses septal activation (initial forces leftward: lead I initial deflection rises)", () => {
    const lbb = run(params({ hisPurkinje: { lbbCv: 0.05, lafCv: 0.05, lpfCv: 0.05 } }), 8000);
    const initial = (r: typeof base) => {
      const dt = r.sim.dt;
      return median(
        r.beats.slice(2, 6).map((b) => {
          let s = 0;
          for (let t = b.qrsOn; t <= b.qrsOn + 20; t += dt) s += r.out.ecg[Math.round(t / dt) * N_CHANNELS + 0] * dt;
          return s;
        }),
      );
    };
    expect(initial(lbb)).toBeGreaterThan(initial(base));
  });
  it("slower conduction in the left anterior fascicle delays its territory and modestly widens QRS", () => {
    // NOTE: the expected left-axis deviation of LAFB is NOT yet reproduced (Phase 2 calibration item).
    const laf = run(params({ hisPurkinje: { lafCv: 0.05 } }), 8000);
    const qrs = (r: typeof base) => median(r.beats.slice(2).map((b) => b.qrs));
    expect(qrs(laf)).toBeGreaterThan(qrs(base) + 5);
    expect(qrs(laf)).toBeLessThan(130);
  });
});
