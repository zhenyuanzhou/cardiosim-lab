import { describe, expect, it } from "vitest";
import { median, params, run } from "../helpers/sim";
import { apdFromDI, apdInfFromRef, steadyStateApd } from "../../src/simulation/cellular/actionPotential";

describe("rate dependence", () => {
  it("restitution map reproduces the human steady-state APD–CL slope (~23 ms per 100 ms, Franz 1988)", () => {
    const inf = apdInfFromRef(300);
    const a400 = steadyStateApd(inf, 300, 400);
    const a1000 = steadyStateApd(inf, 300, 1000);
    const slope = (a1000 - a400) / 600;
    expect(a1000).toBeCloseTo(300, 0);
    expect(slope).toBeGreaterThan(0.2);
    expect(slope).toBeLessThan(0.27);
  });
  it("APD increases monotonically with diastolic interval (above the numerical floor)", () => {
    const inf = apdInfFromRef(300);
    let prev = 0;
    for (const di of [50, 100, 200, 400, 800, 1600]) {
      const a = apdFromDI(inf, 300, di);
      expect(a).toBeGreaterThanOrEqual(prev);
      if (di >= 400) expect(a).toBeGreaterThan(prev);
      prev = a;
    }
  });
  it("faster sinus rate shortens QT and lengthens AV nodal conduction (recovery dynamics)", () => {
    const slow = run(params(), 8000);
    const fast = run(params({ sinus: { vagalTone: 0, sympatheticTone: 0, intrinsicRate: 150 } }), 8000);
    const qt = (r: typeof slow) => median(r.beats.filter((b) => b.qt !== null).map((b) => b.qt!));
    const ah = (r: typeof slow) => median(r.waves.filter((w) => Number.isFinite(w.tAvnOut)).slice(2).map((w) => w.tAvnOut - w.tAvnIn));
    expect(qt(fast)).toBeLessThan(qt(slow) - 40);
    // at the same autonomic reference the AV node is slower when it has less time to recover
    const slowNoAuto = run(params({ sinus: { vagalTone: 0, sympatheticTone: 0, intrinsicRate: 60 } }), 8000);
    expect(ah(fast)).toBeGreaterThan(ah(slowNoAuto));
  });
  it("vagal tone slows the sinus rate and prolongs PR", () => {
    const a = run(params(), 8000);
    const b = run(params({ sinus: { vagalTone: 0.9 } }), 8000);
    const rr = (r: typeof a) => median(r.beats.filter((x) => x.rr).map((x) => x.rr!));
    const pr = (r: typeof a) => median(r.beats.filter((x) => x.pr).map((x) => x.pr!));
    expect(rr(b)).toBeGreaterThan(rr(a) + 200);
    expect(pr(b)).toBeGreaterThan(pr(a));
  });
});
