/**
 * Torsades episode control: cancellation, parameter changes, deterministic replay and the substrate
 * gate.
 *
 * These exist because an independent review found that switching the generator off did not stop an
 * episode already under way: the whole run was scheduled in advance, so disabling it prevented future
 * scheduling only, and twelve further stimuli still fired. Reading the code while reproducing that
 * also showed the episode state was absent from the snapshot, so a checkpoint taken mid-episode
 * replayed differently.
 *
 * The generator is now an explicit state machine (src/simulation/core/torsades.ts) whose queued
 * events carry an epoch token; anything that changes the episode invalidates them.
 */
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { model } from "../helpers/sim";
import { Simulator } from "../../src/simulation/core/engine";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { DEFAULT_PARAMS, cloneParams, sanitizeParams, type SimParams } from "../../src/simulation/core/params";
import { canTrigger, torsadesPath, advanceIndex, angleDiff } from "../../src/simulation/core/torsades";

const W = computeLeadField(model);
const tdpParams = () => SCENARIOS.find((s) => s.id === "tdp")!.apply!();
const sim = (p: SimParams) => new Simulator(model, p, W);
/** Times of every torsades stimulus in a run of `ms`. */
function stimuli(p: SimParams, ms: number): number[] {
  const s = sim(p);
  s.run(ms);
  return s.drain().waves.filter((w) => w.site === "torsades focus").map((w) => w.t0).sort((a, b) => a - b);
}
/** Start of the longest episode in the first `ms`, and a time in the middle of it. */
function episode(ms = 30000): { start: number; mid: number; n: number } {
  const all = stimuli(tdpParams(), ms);
  const starts = all.filter((t, i) => i === 0 || t - all[i - 1] > 600);
  let best = { start: 0, mid: 0, n: 0 };
  for (const st of starts) {
    const e = all.filter((t) => t >= st && t < st + 8000);
    if (e.length > best.n) best = { start: st, mid: e[Math.floor(e.length / 2)], n: e.length };
  }
  return best;
}

describe("torsades episode control", () => {
  const epi = episode();

  it("the scenario produces multi-beat episodes at all", () => {
    expect(epi.n).toBeGreaterThan(5);
  });

  it("disabling the generator mid-episode stops it immediately", () => {
    const s = sim(tdpParams());
    s.run(epi.mid);
    s.drain();
    const off = cloneParams(tdpParams());
    off.torsades.enabled = false;
    s.setParams(off);
    s.run(epi.mid + 4000);
    const after = s.drain().waves.filter((w) => w.site === "torsades focus" && w.t0 > epi.mid);
    expect(after.length).toBe(0);
  });

  it("changing any torsades parameter mid-episode voids the events already queued", () => {
    for (const edit of [
      (p: SimParams) => (p.torsades.twistDeg = 40),
      (p: SimParams) => (p.torsades.beats = 8),
      (p: SimParams) => (p.torsades.margin = 60),
      (p: SimParams) => (p.torsades.pathSites = 24),
    ]) {
      const s = sim(tdpParams());
      s.run(epi.mid);
      s.drain();
      const before = s.tdp.epoch;
      const p = cloneParams(tdpParams());
      edit(p);
      s.setParams(p);
      expect(s.tdp.epoch).toBeGreaterThan(before);
      expect(s.tdp.phase).toBe("idle");
      s.run(epi.mid + 600);
      // the old run is over; anything new has to start from the state machine, not from stale events
      const after = s.drain().waves.filter((w) => w.site === "torsades focus" && w.t0 > epi.mid + 50);
      expect(after.length).toBe(0);
    }
  });

  it("the episode state is carried in the snapshot, so mid-episode replay is identical", () => {
    const a = sim(tdpParams());
    a.run(epi.mid);
    const snap = a.snapshot();
    expect(snap.tdp.phase).toBeDefined();
    a.run(epi.mid + 3000);
    const want = a.drain().waves.filter((w) => w.site === "torsades focus" && w.t0 > epi.mid).map((w) => Math.round(w.t0));
    const b = sim(tdpParams());
    b.run(1500); // make b's state genuinely different before restoring
    b.restore(snap);
    b.run(epi.mid + 3000);
    const got = b.drain().waves.filter((w) => w.site === "torsades focus" && w.t0 > epi.mid).map((w) => Math.round(w.t0));
    expect(got).toEqual(want);
    expect(want.length).toBeGreaterThan(0);
  });

  it("re-enabling after a disable starts a fresh episode rather than resuming the old one", () => {
    const s = sim(tdpParams());
    s.run(epi.mid);
    const off = cloneParams(tdpParams());
    off.torsades.enabled = false;
    s.setParams(off);
    s.run(epi.mid + 2000);
    s.drain();
    s.setParams(cloneParams(tdpParams()));
    expect(s.tdp.phase).toBe("idle");
    s.run(epi.mid + 20000);
    const after = s.drain().waves.filter((w) => w.site === "torsades focus");
    // a new episode is allowed, but it must begin from the long–short sequence, not mid-run
    if (after.length > 0) expect(after[0].t0).toBeGreaterThan(epi.mid + 2000);
  });
});

describe("torsades depends on the substrate", () => {
  it("no episodes occur on a normal-QT substrate, however the generator is configured", () => {
    const p = cloneParams(DEFAULT_PARAMS);
    p.torsades = { ...tdpParams().torsades };
    p.restitution = { ...tdpParams().restitution };
    expect(stimuli(p, 30000).length).toBe(0);
  });

  it("episodes do occur on the long-QT substrate", () => {
    expect(stimuli(tdpParams(), 30000).length).toBeGreaterThan(5);
  });

  it("the gate is the action potential still being in phase 3 at the take-off time", () => {
    expect(canTrigger(420, 390)).toBe(true);
    expect(canTrigger(300, 390)).toBe(false);
  });
});

describe("the source path", () => {
  const p = tdpParams();
  const path = torsadesPath(model, W, p.torsades.pathSites);

  it("covers the requested number of sites and never repeats a node", () => {
    expect(path.length).toBeGreaterThan(p.torsades.pathSites * 0.75);
    expect(new Set(path.map((s) => s.node)).size).toBe(path.length);
  });

  it("advances by a whole site every beat: no repeat-then-jump", () => {
    // The old rule rounded a fractional index, which repeated a site and then skipped one
    // (drift 0.6 on a 16-site ring gave 0 1 1 2 2 3 4 4 5 5 …).
    let k = 0;
    const visited: number[] = [];
    for (let b = 0; b < 40; b++) {
      const n = advanceIndex(path, k, p.torsades.twistDeg);
      expect(n).not.toBe(k);
      visited.push(n);
      k = n;
    }
    for (let i = 1; i < visited.length; i++) expect(visited[i]).not.toBe(visited[i - 1]);
  });

  it("turns the QRS axis by about the requested amount each beat", () => {
    let k = 0;
    const steps: number[] = [];
    for (let b = 0; b < 40; b++) {
      const n = advanceIndex(path, k, p.torsades.twistDeg);
      steps.push(Math.abs(angleDiff(path[n].axis, path[k].axis)));
      k = n;
    }
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    // within a factor of two of the request; the path's angular resolution limits how close it gets
    expect(mean).toBeGreaterThan(p.torsades.twistDeg * 0.5);
    expect(mean).toBeLessThan(p.torsades.twistDeg * 2);
  });
});

describe("saved scenarios from before v1.7", () => {
  it("the old drift/ringSize pair is converted into a twist rate", () => {
    const p = sanitizeParams({ torsades: { enabled: true, drift: 0.6, ringSize: 16, margin: 10, pairOffset: 45, beats: 34, every: 10, coupling: 390 } });
    expect(p.torsades.enabled).toBe(true);
    expect(p.torsades.twistDeg).toBeCloseTo((360 * 0.6) / 16, 3);
  });

  it("a file already using the new field is left alone", () => {
    const p = sanitizeParams({ torsades: { twistDeg: 30 } });
    expect(p.torsades.twistDeg).toBe(30);
  });
});
