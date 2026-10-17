/**
 * Scenario validation (spec §6 criterion 7): each test checks the *mechanistic signature* of a
 * registry scenario from the simulator's own records and the measured ECG — not just that a
 * waveform changed. Test names are referenced verbatim by `validation` in the registry.
 */
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { run, median, params } from "../helpers/sim";
import type { WaveInfo } from "../../src/simulation/core/engine";
import { RG } from "../../src/simulation/core/model";
import { model } from "../helpers/sim";
import { pace, TP06_DEFAULT_MODS, type TP06Mods } from "../../src/simulation/cellular/tp06";
import { DRUG_BY_ID, drugMods } from "../../src/simulation/cellular/drugs";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
import { N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";

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
    // Typical (slow–fast) AVNRT: CL 317 ± 43 ms, HA 45.8 ± 7.7 ms (Katritsis et al. 2015, Europace 17:1099).
    expect(median(cl)).toBeGreaterThan(317 - 2 * 43);
    expect(median(cl)).toBeLessThan(317 + 2 * 43);
    expect(Math.max(...cl.slice(2)) - Math.min(...cl.slice(2))).toBeLessThan(10); // regular
    // retrograde atrial activation falls within / at the end of the QRS (no separate P wave):
    // QRS onset → atrial onset of the next circuit wave, compared with the QRS duration.
    const va = re.slice(2, -1).map((w, i) => re[i + 3].tFirstAtrial - w.tFirstVent);
    expect(median(va)).toBeGreaterThanOrEqual(0);
    expect(median(va)).toBeLessThanOrEqual(median(re.map(truthQrs)));
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

describe("Group D — scar re-entry, polymorphic VT and fibrillation", () => {
  const qtOf = (id: string) => median(sc(id).beats.map((b) => b.qt).filter((x): x is number => x !== null));
  /** Beat instants and axis dispersion of the tachycardia in the last part of a run. */
  const tachy = (id: string, ms = 14000, from = 0.65) => {
    const r = sc(id, ms);
    const acts = r.waves.filter((w) => Number.isFinite(w.tFirstVent) && w.tFirstVent > ms * from).map((w) => w.tFirstVent).sort((a, b) => a - b);
    const ivs = acts.slice(1).map((t, i) => t - acts[i]);
    const cl = ivs.reduce((a, b) => a + b, 0) / ivs.length;
    const reentry = r.waves.filter((w) => w.origin === "reentry").length;
    return { acts, cl, reentry, disp: analyseMorphology(r.out.ecg, r.sim.dt, acts).axisDispersion };
  };
  /** Local activation interval at three separated ventricular sites — the clinical measurement. */
  const localInterval = (id: string, ms = 14000) => {
    const r = sc(id, ms);
    const nodes = ["rvot", "lv-apex", "septum"].map((s) => model.ectopicSites[s]);
    const all: number[] = [];
    for (const n of nodes) {
      const ts: number[] = [];
      for (let k = 0; k < r.out.recT.length; k++) if (r.out.recNode[k] === n && r.out.recT[k] > ms * 0.65) ts.push(r.out.recT[k]);
      ts.sort((a, b) => a - b);
      for (let i = 1; i < ts.length; i++) all.push(ts[i] - ts[i - 1]);
    }
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    const sd = Math.sqrt(all.reduce((a, b) => a + (b - mean) ** 2, 0) / all.length);
    return { mean, cvPct: (100 * sd) / mean, n: all.length };
  };
  /** The same substrate with the inducing burst removed — must stay in sinus rhythm. */
  const quiet = (id: string) => {
    const p = SCENARIOS.find((x) => x.id === id)!.apply!();
    p.ectopy = { ...p.ectopy, site: "none" };
    return run(p, 12000);
  };

  it("scar-related VT", () => {
    const t = tachy("vt-scar");
    expect(t.reentry).toBeGreaterThan(5); // genuine re-entry, not repeated ectopy
    expect(t.cl).toBeGreaterThan(240);
    expect(t.cl).toBeLessThan(500); // clinical post-infarct VT range
    expect(t.disp).toBeLessThan(30); // monomorphic: one repeating activation sequence
    // and it must NOT start by itself — a scar substrate makes VT inducible, not spontaneous
    expect(quiet("vt-scar").waves.filter((w) => w.origin === "reentry").length).toBe(0);
  });

  it("polymorphic VT", () => {
    const t = tachy("pvt");
    expect(t.reentry).toBeGreaterThan(5);
    expect(t.cl).toBeGreaterThan(240);
    expect(t.cl).toBeLessThan(500);
    expect(t.disp).toBeGreaterThan(40); // changing QRS, unlike the monomorphic scenario
    expect(t.disp).toBeGreaterThan(tachy("vt-scar").disp + 20);
    expect(quiet("pvt").waves.filter((w) => w.origin === "reentry").length).toBe(0);
  });

  it("ventricular fibrillation", () => {
    const t = tachy("vf");
    expect(t.reentry).toBeGreaterThan(20); // many simultaneous wavelets
    // Local activation interval against human VF in vivo: 218 ± 24 ms (Nair et al. 2012),
    // dominant frequency 4.5–6.4 Hz (Bradley et al. 2011).
    const l = localInterval("vf");
    expect(l.mean).toBeGreaterThan(218 - 48); // within 2 SD of the measured mean
    expect(l.mean).toBeLessThan(218 + 48);
    expect(1000 / l.mean).toBeGreaterThan(3.5); // dominant-frequency sanity check
    expect(1000 / l.mean).toBeLessThan(7);
    expect(l.cvPct).toBeGreaterThan(5); // irregular, unlike monomorphic VT (≈ 1 %)
    expect(t.disp).toBeGreaterThan(40);
    expect(quiet("vf").waves.filter((w) => w.origin === "reentry").length).toBe(0);
  });

  it("torsades de pointes", () => {
    const r = sc("tdp", 26000);
    const beats = r.waves.filter((w) => w.site === "torsades focus" && Number.isFinite(w.tFirstVent)).map((w) => w.tFirstVent).sort((a, b) => a - b);
    const runs: number[][] = [];
    let cur: number[] = [];
    for (const t of beats) {
      if (cur.length && t - cur[cur.length - 1] > 900) {
        runs.push(cur);
        cur = [];
      }
      cur.push(t);
    }
    if (cur.length) runs.push(cur);
    const long = runs.filter((x) => x.length >= 8);
    expect(long.length).toBeGreaterThanOrEqual(1);
    const first = long[0];
    // self-terminating: sinus resumes after the run
    expect(r.waves.some((w) => w.origin === "sinus" && w.tFirstVent > first[first.length - 1] + 200 && w.tFirstVent < first[first.length - 1] + 3000)).toBe(true);

    const merged: number[] = [];
    for (const t of first) if (!merged.length || t - merged[merged.length - 1] > 80) merged.push(t);
    const ivs = merged.slice(1).map((t, i) => t - merged[i]);
    const cl = ivs.reduce((a, b) => a + b, 0) / ivs.length;
    // Rate sits at the SLOW edge of the clinical range (200–250 /min) because organised capture
    // fails above ≈ 176 /min in this engine — a documented limitation, pinned here.
    expect(60000 / cl).toBeGreaterThan(150);
    expect(60000 / cl).toBeLessThan(200);
    // every beat captures (no dropped beats within the run)
    expect(Math.max(...ivs)).toBeLessThan(450);

    // The hallmark that IS reproduced: the amplitude in one lead waxes and wanes repeatedly.
    const amps = merged.map((t, k) => {
      const a = Math.round(t / r.sim.dt);
      const b = Math.round(Math.min(t + 220, merged[k + 1] ?? t + 240) / r.sim.dt);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = a; i < b; i++) {
        const v = r.out.ecg[i * N_CHANNELS + 1];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      return hi - lo;
    });
    const mx = Math.max(...amps);
    let dips = 0;
    let below = false;
    for (const a of amps) {
      if (a < 0.5 * mx && !below) {
        dips++;
        below = true;
      }
      if (a >= 0.5 * mx) below = false;
    }
    expect(dips).toBeGreaterThanOrEqual(3); // repeated swelling and collapse, not a single fade
    expect(mx / Math.min(...amps)).toBeGreaterThan(3);

    // the axis turns, and far more coherently than in fibrillation
    const mo = analyseMorphology(r.out.ecg, r.sim.dt, first);
    expect(Math.max(...mo.axes) - Math.min(...mo.axes)).toBeGreaterThan(90);

    // QT is prolonged (the clinical setting, though the model does not derive the foci from it)
    expect(median(r.beats.map((b) => b.qt).filter((x): x is number => x !== null))).toBeGreaterThan(qtOf("nsr") + 15);
  });

  it("re-entry cycle length is set by the refractory floor (documented limitation)", () => {
    // This engine's functional re-entry has no excitable gap, so CL ≈ erpRatio × floor × APDref.
    // The scenarios rely on that relationship for calibration, so it is pinned here.
    const p = params({ restitution: { apdFloor: 0.79 }, ventricles: { heterogeneity: 0.2 } });
    const predicted = p.ventricles.erpRatio * p.restitution.apdFloor * p.ventricles.apd;
    const l = localInterval("vf");
    expect(Math.abs(l.mean - predicted) / predicted).toBeLessThan(0.2);
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

  // Global repolarisation measures on the heart-vector magnitude, like Johannesen et al. 2014.
  const repol = (id: string) => {
    const r = sc(id, 7000);
    const dt = r.sim.dt;
    const vm = (t: number) => {
      const i = Math.round(t / dt) * N_CHANNELS;
      return Math.hypot(r.out.ecg[i + 12], r.out.ecg[i + 13], r.out.ecg[i + 14]);
    };
    const xs = r.beats.slice(1, -1).map((b) => {
      const J = b.qrsOff;
      const te = b.qrsOn + b.qt!;
      let tp = J + 40;
      let best = -1;
      for (let t = J + 40; t < te; t += dt) if (vm(t) > best) [best, tp] = [vm(t), t];
      return { qt: b.qt!, jtp: tp - J, tpte: te - tp, pr: b.pr! };
    });
    const m = (k: "qt" | "jtp" | "tpte" | "pr") => median(xs.map((x) => x[k]));
    return { qt: m("qt"), jtp: m("jtp"), tpte: m("tpte"), pr: m("pr") };
  };
  // 95 % CIs of the placebo-corrected peak effects (Johannesen et al. 2014, Clin Pharmacol Ther 96:549)
  const within = (x: number, lo: number, hi: number, slack = 3) => {
    expect(x).toBeGreaterThanOrEqual(lo - slack);
    expect(x).toBeLessThanOrEqual(hi + slack);
  };
  it("drug dofetilide", () => {
    const b = repol("nsr");
    const d = repol("drug-dofetilide");
    within(d.qt - b.qt, 72.2, 86.3);
    within(d.jtp - b.jtp, 32.8, 46.2);
    within(d.tpte - b.tpte, 33.0, 46.9);
    expect(Math.abs(qrs("drug-dofetilide") - qrs("nsr"))).toBeLessThanOrEqual(4);
  });

  it("drug quinidine", () => {
    const b = repol("nsr");
    const d = repol("drug-quinidine");
    within(d.qt - b.qt, 70.9, 85.2);
    within(d.jtp - b.jtp, 22.4, 35.9);
    within(d.tpte - b.tpte, 42.8, 56.8);
  });

  it("drug flecainide", () => {
    // Class Ic: QRS widens through reduced conduction velocity (TP06 mapping; no matched human study here).
    expect(qrs("drug-flecainide")).toBeGreaterThan(qrs("nsr") + 4);
  });

  it("drug verapamil", () => {
    // In man: no significant QTc, J–Tpeak or Tpeak–Tend change; PR +32.1 ms (26.7–37.4).
    const b = repol("nsr");
    const d = repol("drug-verapamil");
    within(d.qt - b.qt, -1.8, 12.2);
    within(d.jtp - b.jtp, -9.0, 4.3);
    within(d.tpte - b.tpte, -2.2, 11.7);
    within(d.pr - b.pr, 26.7, 37.4);
    expect(Math.abs(qrs("drug-verapamil") - qrs("nsr"))).toBeLessThanOrEqual(4);
  });

  // ---- potassium -------------------------------------------------------------------------------
  const lead = (id: string, name: string) => {
    const r = sc(id);
    const ch = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"].indexOf(name);
    return { r, x: (t: number) => r.out.ecg[Math.round(t / r.sim.dt) * N_CHANNELS + ch] };
  };
  /** T (and U) analysis of one beat in one lead: peaks after the QRS, T amplitude and TS/A (Corsi 2017). */
  const tWave = (id: string, name: string) => {
    const { r, x } = lead(id, name);
    const w = vent(r.waves).filter((v) => v.tFirstVent > 2000)[1];
    const nextV = vent(r.waves).find((v) => v.tFirstVent > w.tFirstVent + 200)!.tFirstVent;
    const base = x(w.tFirstVent - 15);
    const ys: number[] = [];
    for (let t = w.tLastVent + 30; t < Math.min(nextV - 260, w.tFirstVent + 650); t += r.sim.dt) ys.push(x(t) - base); // stop before the next P wave
    const peaks: { i: number; y: number }[] = [];
    for (let i = 2; i < ys.length - 2; i++) if (ys[i] > ys[i - 1] && ys[i] >= ys[i + 1] && ys[i] > 0.03) peaks.push({ i, y: ys[i] });
    const top = ys.indexOf(Math.max(...ys));
    let slope = 0;
    for (let i = top; i < ys.length - 1; i++) slope = Math.max(slope, (ys[i] - ys[i + 1]) / r.sim.dt);
    let pAmp = 0;
    const pEnd = w.tFirstAtrial + 0.8 * (w.tFirstVent - w.tFirstAtrial); // P wave of this beat, before the QRS
    const pBase = x(w.tFirstAtrial - 10);
    for (let t = w.tFirstAtrial; t < pEnd; t += r.sim.dt) pAmp = Math.max(pAmp, x(t) - pBase);
    return { amp: ys[top], tsa: (slope * 1000) / ys[top], peaks, pAmp, ys, dt: r.sim.dt };
  };
  const pr = (id: string) => median(sc(id).beats.map((b) => b.pr).filter((x): x is number => x !== null));

  it("potassium hyperk", () => {
    // Marriott ch. 10: peaked T first, then PR and QRS prolongation and P flattening.
    const n = ["V2", "V3", "V4"].map((l) => tWave("nsr", l));
    const h = ["V2", "V3", "V4"].map((l) => tWave("hyperk", l));
    for (let k = 0; k < 3; k++) {
      expect(h[k].amp).toBeGreaterThan(1.25 * n[k].amp); // taller
      expect(h[k].tsa).toBeGreaterThan(1.1 * n[k].tsa); // narrower: T slope/amplitude ratio rises (Corsi et al. 2017)
    }
    expect(pr("hyperk")).toBeGreaterThan(pr("nsr") + 10);
    expect(qrs("hyperk")).toBeGreaterThan(qrs("nsr") + 10);
    expect(tWave("hyperk", "II").pAmp).toBeLessThan(tWave("nsr", "II").pAmp);
  });

  it("potassium hyperk-severe", () => {
    expect(pr("hyperk-severe")).toBeGreaterThan(pr("nsr") + 40);
    expect(qrs("hyperk-severe")).toBeGreaterThan(qrs("nsr") + 40);
    expect(tWave("hyperk-severe", "II").pAmp).toBeLessThan(0.9 * tWave("nsr", "II").pAmp); // flatter P (TP06: −16 % amplitude; P loss is not reproduced)
    expect(tWave("hyperk-severe", "V3").amp).toBeGreaterThan(1.5 * tWave("nsr", "V3").amp);
  });

  it("potassium hypok", () => {
    // Marriott ch. 10: "the reversal in the relative amplitudes of the T and U waves is the most
    // characteristic change": two positive waves after the QRS, the later (U) larger than the T.
    for (const l of ["V2", "V3"]) {
      const t = tWave("hypok", l);
      expect(t.peaks.length, l).toBeGreaterThanOrEqual(1);
      const last = t.peaks[t.peaks.length - 1];
      // everything more than 100 ms before the U peak (the flattened T) is lower than the U wave
      const earlyMax = Math.max(0, ...t.ys.slice(0, Math.max(1, last.i - Math.round(100 / t.dt))));
      expect(last.y, l).toBeGreaterThan(earlyMax);
      expect(last.y, l).toBeGreaterThan(0.1);
      expect(tWave("hypok", l).amp).toBeGreaterThan(0); // not inverted
    }
    expect(tWave("hypok", "II").pAmp).toBeGreaterThan(tWave("nsr", "II").pAmp); // larger P
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
