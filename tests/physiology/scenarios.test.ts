/**
 * Scenario validation (spec §6 criterion 7): each test checks the *mechanistic signature* of a
 * registry scenario from the simulator's own records and the measured ECG — not just that a
 * waveform changed. Test names are referenced verbatim by `validation` in the registry.
 */
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { run, median } from "../helpers/sim";
import type { WaveInfo } from "../../src/simulation/core/engine";
import { RG } from "../../src/simulation/core/model";
import { model } from "../helpers/sim";
import { pace, TP06_DEFAULT_MODS, type TP06Mods } from "../../src/simulation/cellular/tp06";
import { DRUG_BY_ID, drugMods } from "../../src/simulation/cellular/drugs";

const cellCache = new Map<string, ReturnType<typeof pace>>();
/** Pace one epicardial TP06 cell with the given modifications (cached across tests). */
function paceCell(mods: Partial<TP06Mods>, cl = 1000, beats = 30) {
  const key = JSON.stringify([mods, cl, beats]);
  if (!cellCache.has(key)) cellCache.set(key, pace("epi", { ...TP06_DEFAULT_MODS, ...mods }, cl, beats));
  return cellCache.get(key)!;
}

const cache = new Map<string, ReturnType<typeof run>>();
function sc(id: string, ms = 8000) {
  const key = `${id}:${ms}`;
  if (!cache.has(key)) {
    const s = SCENARIOS.find((x) => x.id === id)!;
    cache.set(key, run(s.apply!(), ms));
  }
  return cache.get(key)!;
}
const vent = (ws: WaveInfo[]) => ws.filter((w) => Number.isFinite(w.tFirstVent)).sort((a, b) => a.tFirstVent - b.tFirstVent);
const nsr = () => sc("nsr");
const nsrCycle = () => {
  const v = vent(nsr().waves);
  return v[3].tFirstVent - v[2].tFirstVent;
};
const truthQrs = (w: WaveInfo) => w.tLastVent - w.tFirstVent;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("Group A — brady/conduction scenarios", () => {
  it("sinus bradycardia", () => {
    const { beats } = sc("brady");
    expect(median(beats.slice(1).map((b) => b.hr!))).toBeLessThan(60);
    expect(median(beats.map((b) => b.pr!))).toBeGreaterThan(120);
  });
  it("sinus tachycardia", () => {
    const { beats } = sc("tachy");
    expect(median(beats.slice(1).map((b) => b.hr!))).toBeGreaterThan(100);
    expect(median(beats.slice(1, -1).map((b) => b.qt!))).toBeLessThan(median(nsr().beats.slice(1, -1).map((b) => b.qt!)) - 40);
  });
  it("sinus arrest", () => {
    const { waves, beats } = sc("sinus-arrest");
    expect(waves.filter((w) => w.origin === "sinus").length).toBe(0);
    const v = vent(waves);
    expect(v.every((w) => w.origin === "junctional")).toBe(true);
    const rr = v.slice(1).map((w, i) => w.tFirstVent - v[i].tFirstVent);
    for (const r of rr) expect(Math.abs(r - 60000 / 45)).toBeLessThan(10);
    expect(Math.max(...beats.map((b) => b.qrs))).toBeLessThan(110);
    expect(beats.every((b) => b.pr === null)).toBe(true);
  });
  it("SA exit block", () => {
    const { waves } = sc("sa-exit");
    const blocked = waves.filter((w) => w.saExitBlocked);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((w) => !Number.isFinite(w.tFirstAtrial))).toBe(true);
    const v = vent(waves);
    const rr = v.slice(1).map((w, i) => w.tFirstVent - v[i].tFirstVent);
    const c = nsrCycle();
    expect(rr.some((r) => Math.abs(r - 2 * c) < 10)).toBe(true);
  });
  it("first-degree AV block", () => {
    const { beats } = sc("avb1");
    expect(Math.min(...beats.map((b) => b.pr!))).toBeGreaterThan(200);
    expect(Math.abs(median(beats.map((b) => b.qrs)) - median(nsr().beats.map((b) => b.qrs)))).toBeLessThanOrEqual(4);
  });
  it("Mobitz I", () => {
    const { waves } = sc("mobitz1", 9000);
    const sinus = waves.filter((w) => w.origin === "sinus").sort((a, b) => a.t0 - b.t0);
    const iBlock = sinus.findIndex((w, i) => i >= 2 && w.avnBlocked);
    expect(iBlock).toBeGreaterThan(1);
    // AH increases progressively within the group that ends in the block
    const ah = sinus.slice(0, iBlock).map((w) => w.tAvnOut - w.tAvnIn);
    for (let i = 1; i < ah.length; i++) expect(ah[i]).toBeGreaterThan(ah[i - 1]);
    // the first conducted beat after the block has the shortest AH of the next group
    const next = sinus.slice(iBlock + 1).filter((w) => Number.isFinite(w.tAvnOut));
    expect(next[0].tAvnOut - next[0].tAvnIn).toBeLessThan(ah[ah.length - 1]);
  });
  it("Mobitz II", () => {
    const { waves, beats } = sc("mobitz2");
    expect(waves.filter((w) => w.infraHisBlocked).length).toBeGreaterThanOrEqual(2);
    expect(waves.filter((w) => w.avnBlocked).length).toBe(0);
    const prs = beats.map((b) => b.pr!).filter((x) => x !== null);
    expect(Math.max(...prs) - Math.min(...prs)).toBeLessThanOrEqual(4);
  });
  it("2:1 AV block", () => {
    const { waves } = sc("avb-2to1");
    const sinus = waves.filter((w) => w.origin === "sinus").sort((a, b) => a.t0 - b.t0);
    const pattern = sinus.map((w) => (w.infraHisBlocked ? "B" : "C")).join("");
    expect(pattern).toMatch(/(CB){3,}/);
  });
  it("complete AV block, junctional escape", () => {
    const { waves, beats } = sc("chb-junctional");
    const v = vent(waves);
    expect(v.every((w) => w.origin === "junctional")).toBe(true);
    expect(waves.filter((w) => w.origin === "sinus" && Number.isFinite(w.tFirstAtrial)).length).toBeGreaterThan(v.length);
    // narrow escape complexes (model truth; the detector may merge a dissociated P with a QRS)
    expect(median(v.map(truthQrs))).toBeLessThan(median(vent(nsr().waves).map(truthQrs)) + 6);
    expect(median(beats.map((b) => b.qrs))).toBeLessThan(110);
  });
  it("complete infra-Hisian block, ventricular escape", () => {
    const { waves } = sc("chb-ventricular");
    const v = vent(waves);
    expect(v.length).toBeGreaterThanOrEqual(3);
    expect(v.every((w) => w.origin === "ventricular-escape")).toBe(true);
    expect(median(v.map(truthQrs))).toBeGreaterThan(median(vent(nsr().waves).map(truthQrs)) + 25);
    expect(Math.abs(v[2].tFirstVent - v[1].tFirstVent - 2000)).toBeLessThan(10);
  });
});

describe("Group B — premature beats", () => {
  it("PAC", () => {
    const { waves } = sc("pac");
    const v = vent(waves);
    const i = v.findIndex((w) => w.origin === "ectopic");
    expect(i).toBeGreaterThan(0);
    expect(Number.isFinite(v[i].tAvnOut)).toBe(true); // conducted through the AV node
    const around = v[i + 1].tFirstVent - v[i - 1].tFirstVent;
    expect(around).toBeLessThan(2 * nsrCycle() - 50); // non-compensatory (SA node reset)
  });
  it("PVC with compensatory pause", () => {
    const { waves } = sc("pvc");
    const v = vent(waves);
    const i = v.findIndex((w) => w.origin === "ectopic");
    expect(i).toBeGreaterThan(0);
    expect(Number.isFinite(v[i].tFirstAtrial)).toBe(false);
    expect(Math.abs(v[i + 1].tFirstVent - v[i - 1].tFirstVent - 2 * nsrCycle())).toBeLessThan(12);
    expect(waves.some((w) => w.origin === "sinus" && w.avnBlocked)).toBe(true); // concealed retrograde conduction
    expect(truthQrs(v[i])).toBeGreaterThan(truthQrs(v[i - 1]) + 40);
  });
  it("bigeminy", () => {
    const v = vent(sc("bigeminy").waves).map((w) => (w.origin === "ectopic" ? "E" : "N")).join("");
    expect(v).toMatch(/(NE){3,}/);
  });
  it("trigeminy", () => {
    const v = vent(sc("trigeminy").waves).map((w) => (w.origin === "ectopic" ? "E" : "N")).join("");
    expect(v).toMatch(/(NNE){2,}/);
  });
  it("couplet", () => {
    const v = vent(sc("couplet").waves).map((w) => (w.origin === "ectopic" ? "E" : "N")).join("");
    expect(v).toMatch(/NEEN/);
  });
  it("interpolated PVC", () => {
    const { waves, beats } = sc("pvc-interpolated");
    const v = vent(waves);
    const i = v.findIndex((w) => w.origin === "ectopic");
    expect(i).toBeGreaterThan(0);
    expect(v[i + 1].origin).toBe("sinus");
    // no compensatory pause: the sinus cycle is only lengthened by the (concealment-prolonged) PR
    expect(v[i + 1].tFirstVent - v[i - 1].tFirstVent).toBeLessThan(1.5 * nsrCycle());
    // concealed retrograde penetration prolongs the next PR
    const b = beats.find((x) => x.truth?.waveId === v[i + 1].id)!;
    expect(b.pr!).toBeGreaterThan(median(nsr().beats.map((x) => x.pr!)) + 50);
  });
});

describe("Group C — supraventricular", () => {
  it("focal atrial tachycardia", () => {
    const { waves } = sc("focal-at");
    const ect = waves.filter((w) => w.origin === "ectopic" && Number.isFinite(w.tFirstAtrial)).sort((a, b) => a.t0 - b.t0);
    expect(ect.length).toBeGreaterThan(12);
    const cl = ect.slice(1).map((w, i) => w.t0 - ect[i].t0);
    expect(Math.abs(median(cl) - 400)).toBeLessThan(5);
    expect(waves.filter((w) => w.origin === "sinus" && w.t0 > 1500).length).toBe(0); // SA node overdriven
  });
  it("AVNRT", () => {
    const { waves } = sc("avnrt");
    const re = waves.filter((w) => w.origin === "retrograde" && Number.isFinite(w.tFirstVent)).sort((a, b) => a.t0 - b.t0);
    expect(re.length).toBeGreaterThanOrEqual(8);
    expect(re.every((w) => w.avnPath === "avn-slow" && w.site === "avn-fast")).toBe(true);
    const cl = re.slice(1).map((w, i) => w.tFirstVent - re[i].tFirstVent);
    expect(median(cl)).toBeGreaterThan(250);
    expect(median(cl)).toBeLessThan(500);
    expect(Math.max(...cl.slice(2)) - Math.min(...cl.slice(2))).toBeLessThan(10); // regular
  });
  it("orthodromic AVRT", () => {
    const { waves } = sc("avrt-ortho");
    const re = waves.filter((w) => w.origin === "retrograde" && Number.isFinite(w.tFirstVent)).sort((a, b) => a.t0 - b.t0);
    expect(re.length).toBeGreaterThanOrEqual(8);
    expect(re.every((w) => w.site === "ap-left-lateral" && Number.isFinite(w.tAvnOut))).toBe(true);
    expect(median(re.map(truthQrs))).toBeLessThan(median(vent(nsr().waves).map(truthQrs)) + 6); // narrow
  });
  it("antidromic AVRT", () => {
    const { waves } = sc("avrt-anti");
    const re = waves.filter((w) => w.origin === "retrograde" && Number.isFinite(w.tFirstVent)).sort((a, b) => a.t0 - b.t0);
    expect(re.length).toBeGreaterThanOrEqual(8);
    expect(re.every((w) => w.site === "avn-fast" && Number.isFinite(w.tApOut))).toBe(true);
    expect(median(re.map(truthQrs))).toBeGreaterThan(median(vent(nsr().waves).map(truthQrs)) + 40); // wide
  });
  it("pre-excitation", () => {
    const { waves, beats } = sc("preexcitation");
    const v = vent(waves);
    expect(v.every((w) => w.tApOut < w.tAvnOut)).toBe(true);
    const b = beats.slice(1);
    expect(median(b.map((x) => x.pr!))).toBeLessThan(120);
    expect(median(b.map((x) => x.qrs))).toBeGreaterThan(110);
    expect(median(b.map((x) => x.pr!))).toBeLessThan(median(nsr().beats.map((x) => x.pr!)) - 40);
  });
});

describe("Group C — atrial flutter and fibrillation", () => {
  const atrialTimes = (out: ReturnType<typeof run>["out"], site: string, after: number) => {
    const node = model.ectopicSites[site];
    const ts: number[] = [];
    for (let k = 0; k < out.recT.length; k++) if (out.recNode[k] === node && out.recT[k] > after) ts.push(out.recT[k]);
    return ts;
  };
  const ivs = (ts: number[]) => ts.slice(1).map((t, i) => t - ts[i]);
  const cvOf = (xs: number[]) => {
    const m = mean(xs);
    return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) / m;
  };
  it("atrial flutter", () => {
    const { out, waves } = sc("flutter", 9000);
    expect(waves.filter((w) => w.origin === "reentry").length).toBeGreaterThan(20);
    const ia = ivs(atrialTimes(out, "ra-high", 4000));
    expect(ia.length).toBeGreaterThan(15);
    expect(cvOf(ia)).toBeLessThan(0.03); // regular macro-re-entry
    const rate = 60000 / median(ia);
    expect(rate).toBeGreaterThan(250);
    expect(rate).toBeLessThan(360);
    // the tricuspid-annulus obstacle never activates (anatomical circuit)
    const cap = new Set(model.substrates.tvCap);
    for (let k = 0; k < out.recT.length; k++) expect(cap.has(out.recNode[k])).toBe(false);
    // AV node filters: ventricular rate is a fraction of the atrial rate
    const iv = ivs(atrialTimes(out, "rv-apex", 4000));
    expect(median(iv)).toBeGreaterThan(1.8 * median(ia));
  });
  it("atrial fibrillation", () => {
    const { out } = sc("af", 10000);
    const ia = ivs(atrialTimes(out, "ra-high", 3000));
    expect(cvOf(ia)).toBeGreaterThan(0.08); // irregular atrial activation
    expect(median(ia)).toBeGreaterThan(140);
    expect(median(ia)).toBeLessThan(260);
    const iv = ivs(atrialTimes(out, "rv-apex", 3000));
    expect(cvOf(iv)).toBeGreaterThan(0.1); // irregularly irregular ventricular response
  });
  it("atrial fibrillation persists after the PV trigger stops (re-entrant maintenance)", () => {
    const s = SCENARIOS.find((x) => x.id === "af")!;
    const p = s.apply!();
    const r = run(p, 16000, (sim) => {
      sim.run(6000);
      const q = structuredClone(p);
      q.ectopy.site = "none";
      sim.setParams(q);
    });
    const ia = ivs(atrialTimes(r.out, "ra-high", 8000));
    expect(ia.length).toBeGreaterThan(20);
    expect(cvOf(ia)).toBeGreaterThan(0.08);
  });
});

describe("Group D — ventricular", () => {
  it("focal VT", () => {
    const { waves } = sc("vt-focal");
    const v = vent(waves).filter((w) => w.t0 > 1000);
    expect(v.filter((w) => w.origin === "ectopic").length / v.length).toBeGreaterThan(0.9);
    const ect = v.filter((w) => w.origin === "ectopic");
    expect(Math.abs(median(ect.slice(1).map((w, i) => w.t0 - ect[i].t0)) - 60000 / 170)).toBeLessThan(5);
    expect(waves.filter((w) => w.origin === "sinus" && Number.isFinite(w.tFirstAtrial) && w.t0 > 1000).length).toBeGreaterThan(5); // AV dissociation
  });
});

describe("Bundle branch block", () => {
  it("RBBB", () => {
    const n = vent(nsr().waves)[2];
    const r = vent(sc("rbbb").waves)[2];
    expect(truthQrs(r)).toBeGreaterThan(truthQrs(n) + 25);
    // the right bundle is reached only late and retrogradely (from RV myocardium / Purkinje)
    expect(!Number.isFinite(r.tFirstRBB) || r.tFirstRBB > r.tFirstVent).toBe(true);
    expect(model.region[r.lastVentNode]).toBe(RG.RV);
  });
  it("LBBB", () => {
    const n = vent(nsr().waves)[2];
    const l = vent(sc("lbbb").waves)[2];
    expect(truthQrs(l)).toBeGreaterThan(truthQrs(n) + 25);
    expect(!Number.isFinite(l.tFirstLBB) || l.tFirstLBB > l.tFirstVent).toBe(true);
    expect([RG.RV, RG.SEPTUM]).toContain(model.region[l.firstVentNode]);
    expect(model.region[l.lastVentNode]).toBe(RG.LV);
    // detector-measured QRS meets the conventional LBBB width criterion (≥ 140 ms, Strauss et al. 2011)
    expect(median(sc("lbbb").beats.map((b) => b.qrs))).toBeGreaterThanOrEqual(140);
  });
});

describe("Group E — electrolytes, triggered activity and drugs", () => {
  const qt = (id: string) => median(sc(id).beats.map((b) => b.qt).filter((x): x is number => x !== null));
  const qrs = (id: string) => median(sc(id).beats.map((b) => b.qrs).filter((x): x is number => x !== null));

  it("calcium hyperca", () => {
    // Serum Ca 2.4 → 3.2 mmol/L: QT shortens by the measured human slope (30.1 ms per mmol/L),
    // i.e. ≈ 24 ms, and QRS is unchanged (Young et al. 2021 found no calcium–QRS association).
    const d = qt("nsr") - qt("hyperca");
    expect(d).toBeGreaterThan(14);
    expect(d).toBeLessThan(40);
    expect(Math.abs(qrs("hyperca") - qrs("nsr"))).toBeLessThanOrEqual(4);
  });

  it("calcium hypoca", () => {
    const d = qt("hypoca") - qt("nsr");
    expect(d).toBeGreaterThan(14);
    expect(d).toBeLessThan(40);
    expect(Math.abs(qrs("hypoca") - qrs("nsr"))).toBeLessThanOrEqual(4);
  });

  it("calcium direction is opposite to the ionic cell model (documented disagreement)", () => {
    // The scenarios must NOT be derived from TP06: in TP06 raising [Ca]o lengthens the AP.
    // This test pins that disagreement so the limitation cannot silently disappear.
    const lo = paceCell({ Cao: 1.0 });
    const hi = paceCell({ Cao: 3.0 });
    expect(hi.apd90).toBeGreaterThan(lo.apd90); // TP06: higher Ca → LONGER APD
    expect(qt("hyperca")).toBeLessThan(qt("nsr")); // scenario: higher Ca → SHORTER QT
  });

  it("EAD/DAD triggered activity", () => {
    // Cell: the published EAD configuration produces a secondary upstroke; IKr block alone does not.
    const ead = paceCell({ tauF: 0.5, gCaL: 2.5, gKs: 0.2 });
    expect(ead.eadCount).toBeGreaterThan(0);
    expect(paceCell({ gKr: 0 }).eadCount).toBe(0);
    // Cell: calcium overload with an RyR leak gives a full triggered beat; without the leak it does not.
    const dad = paceCell({ gCaL: 2, vUp: 4.5, kNaCa: 2.5, vRyRLeak: 0.00018 }, 600, 30);
    expect(dad.triggeredBeat).toBe(true);
    expect(paceCell({ gCaL: 2, vUp: 4.5, kNaCa: 2.5 }, 600, 30).triggeredBeat).toBe(false);
    // Tissue: late-coupled ectopic beats on a prolonged QT, alternating with sinus beats.
    const v = vent(sc("ead-dad").waves).filter((w) => w.t0 > 1500);
    const ect = v.filter((w) => w.origin === "ectopic");
    expect(ect.length).toBeGreaterThan(3);
    expect(qt("ead-dad")).toBeGreaterThan(qt("nsr") + 30);
  });

  it("drug dofetilide", () => {
    // Selective IKr block: QT lengthens, QRS unchanged.
    expect(qt("drug-dofetilide")).toBeGreaterThan(qt("nsr") + 25);
    expect(Math.abs(qrs("drug-dofetilide") - qrs("nsr"))).toBeLessThanOrEqual(4);
  });

  it("drug quinidine", () => {
    expect(qt("drug-quinidine")).toBeGreaterThan(qt("nsr") + 20);
  });

  it("drug flecainide", () => {
    // Class Ic: QRS widens through reduced conduction velocity.
    expect(qrs("drug-flecainide")).toBeGreaterThan(qrs("nsr") + 4);
  });

  it("drug verapamil", () => {
    // Balanced ICaL block outweighs hERG block: QT SHORTENS despite appreciable IKr affinity.
    expect(qt("drug-verapamil")).toBeLessThan(qt("nsr") - 40);
    expect(Math.abs(qrs("drug-verapamil") - qrs("nsr"))).toBeLessThanOrEqual(4);
  });

  it("drug block fractions match the published IC50 values", () => {
    // Hill equation, h = 1, at the stated multiple of free Cmax (Crumb et al. 2016 Table 1 and 2).
    const dof = drugMods(DRUG_BY_ID.dofetilide, 1);
    expect(dof.gKr).toBeCloseTo(1 - 2.1 / (2.1 + 2), 6); // IC50 0.002 µM = 2 nM, free Cmax 2.1 nM → ≈ 51 % block
    expect(dof.gCaL).toBe(1); // above the highest concentration tested → no block
    const ver = drugMods(DRUG_BY_ID.verapamil, 1);
    expect(1 - ver.gCaL).toBeGreaterThan(1 - ver.gKr); // ICaL block exceeds IKr block
  });
});

describe("registry consistency", () => {
  it("validated scenarios meet all eight criteria and every runnable scenario names its validation", () => {
    for (const s of SCENARIOS) {
      if (s.status === "validated") expect(Object.values(s.criteria).every(Boolean), s.id).toBe(true);
      if (s.status === "unsupported") expect(s.apply, s.id).toBeUndefined();
      if (s.apply) expect(s.validation.length, s.id).toBeGreaterThan(10);
    }
    void mean;
  });
});
