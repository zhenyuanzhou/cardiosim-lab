/**
 * Tune the torsades generator against the quantitative criteria in ecg-forward/tdpMetrics.ts.
 * usage: tsx tdp-tune.ts <floors> <twistDegs> <pairOffsets> <pathSites> [margins] [cvAmplitudes]
 */
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { run } from "../../tests/helpers/sim";
import { tdpMetrics, runWindow, type TdpMetrics } from "../../src/simulation/ecg-forward/tdpMetrics";
import type { SimParams } from "../../src/simulation/core/params";

const base = SCENARIOS.find((x) => x.id === "tdp")!.apply!;

export function measure(edit: (p: SimParams) => void, ms = 24000): { m: TdpMetrics; run: number } {
  const p = base();
  edit(p);
  const r = run(p, ms);
  const foci = r.out.waves.filter((w) => w.site === "torsades focus" && Number.isFinite(w.tFirstVent)).sort((x, y) => x.tFirstVent - y.tFirstVent);
  const starts = foci.filter((w, i) => i === 0 || w.tFirstVent - foci[i - 1].tFirstVent > 600);
  let [a, b] = [0, 0];
  for (const st of starts) {
    const [x, y] = runWindow(r.out, st.tFirstVent - 5, ms);
    if (y - x > b - a) [a, b] = [x, y];
  }
  return { m: tdpMetrics(r.out, r.sim.dt, a, b), run: b - a };
}

/** How far each measured value is outside its target band (0 = inside). */
export function score(m: TdpMetrics, runMs: number): number {
  const out = (x: number, lo: number, hi: number) => (x < lo ? (lo - x) / lo : x > hi ? (x - hi) / hi : 0);
  return (
    out(m.rate, 180, 250) +
    out(m.baselineFraction, 0, 0.15) +
    out(m.nodesPer5s, 0.8, 4) + // spindles of 5–20 beats
    out(m.envelopeRatio, 3, 50) +
    out(m.axisSpan, 180, 5000) +
    out(m.meanSpan, 100, 400) +
    out(m.extremaPerBeat, 1, 3) +
    out(runMs, 2000, 20000)
  );
}

const fmt = (m: TdpMetrics, runMs: number) =>
  `run ${runMs.toFixed(0)} ms | CL ${m.cl.toFixed(0)} (${m.rate.toFixed(0)}/min) | base ${(100 * m.baselineFraction).toFixed(0)}% | nodes/5s ${m.nodesPer5s.toFixed(1)} | env ${m.envelopeRatio.toFixed(1)} | axis ${m.axisSpan.toFixed(0)}° | span ${m.meanSpan.toFixed(0)} | extrema ${m.extremaPerBeat.toFixed(1)} | beats ${m.beats}`;

if (process.argv[1].endsWith("tdp-tune.ts")) {
  const list = (v: string | undefined, d: string) => (v ?? d).split(",").map(Number);
  const results: { label: string; s: number }[] = [];
  for (const floor of list(process.argv[2], "0.6"))
    for (const drift of list(process.argv[3], "22"))
      for (const pair of list(process.argv[4], "45"))
        for (const ring of list(process.argv[5], "48"))
          for (const margin of list(process.argv[6], "10"))
          for (const cvAmp of list(process.argv[7], "0.5")) {
            const { m, run: rm } = measure((p) => {
              p.restitution.apdFloor = floor;
              p.restitution.cvAmplitude = cvAmp;
              p.torsades = { ...p.torsades, twistDeg: drift, pairOffset: pair, pathSites: ring, margin };
            });
            const s = score(m, rm);
            const label = `floor${floor} twist${drift} pair${pair} path${ring} margin${margin} cv${cvAmp}`;
            results.push({ label, s });
            console.log(`${label}: ${fmt(m, rm)} | score ${s.toFixed(2)}`);
          }
  results.sort((a, b) => a.s - b.s);
  console.log("\nbest:");
  for (const r of results.slice(0, 5)) console.log(`  ${r.s.toFixed(2)}  ${r.label}`);
}
