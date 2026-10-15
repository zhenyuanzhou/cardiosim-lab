import { describe, expect, it } from "vitest";
import { median, model, params, run, W } from "../helpers/sim";
import { N_COLS, LEAD_NAMES } from "../../src/simulation/ecg-forward/leadField";
import { CT } from "../../src/simulation/core/model";

const base = run(params(), 8000);
const nS = base.out.ecg.length / 15;
const x = (s: number, l: number) => base.out.ecg[s * 15 + l];

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
  it("every lead's QRS starts within 20 ms of the first ventricular activation", () => {
    const w = base.waves[4];
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
      expect(Math.abs(on - w.tFirstVent)).toBeLessThanOrEqual(20);
    }
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

describe("QRS changes with the activation vector", () => {
  const terminalArea = (r: typeof base, lead: number) => {
    const dt = r.sim.dt;
    const vals = r.beats.slice(2, 6).map((b) => {
      let s = 0;
      for (let t = b.qrsOff - 40; t <= b.qrsOff; t += dt) s += r.out.ecg[Math.round(t / dt) * 15 + lead] * dt;
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
          for (let t = b.qrsOn; t <= b.qrsOn + 20; t += dt) s += r.out.ecg[Math.round(t / dt) * 15 + 0] * dt;
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
