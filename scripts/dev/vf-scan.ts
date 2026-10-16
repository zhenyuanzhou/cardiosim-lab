/**
 * Search for ventricular substrates that sustain fibrillatory conduction after a burst.
 *
 * Targets (human, in vivo):
 *   VF cycle length 218 ± 24 ms (Nair et al. Am J Physiol 2012, closed-chest VF at DFT testing)
 *   VF dominant frequency 4.5–6.4 Hz (Bradley et al. Circ Arrhythm Electrophysiol 2011)
 * so a mean activation interval of roughly 160–280 ms with marked beat-to-beat variability.
 */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { CT } from "../../src/simulation/core/model";

const m = buildCardiacModel();
const W = computeLeadField(m);
const T = 12000;
const BURST_START = 3000;

function run(het: number, cv: number, apd: number, site: string, cycle: number, n: number) {
  const p = cloneParams(DEFAULT_PARAMS);
  p.ventricles.heterogeneity = het;
  p.ventricles.cvLongitudinal = cv;
  p.ventricles.apd = apd;
  const sim = new Simulator(m, sanitizeParams(p as unknown as Record<string, unknown>), W);
  const node = m.ectopicSites[site];
  for (let i = 0; i < n; i++) sim.stimulate(node, BURST_START + i * cycle);
  sim.run(T);
  const o = sim.drain();
  const burstEnd = BURST_START + n * cycle;
  // activation intervals at three widely separated ventricular probes
  const probes = ["rvot", "lv-apex", "septum"].map((s) => m.ectopicSites[s]).filter((x) => x !== undefined);
  const series = probes.map(() => [] as number[]);
  let lastVent = 0;
  let reentry = 0;
  for (let k = 0; k < o.recT.length; k++) {
    const i = probes.indexOf(o.recNode[k]);
    if (i >= 0) series[i].push(o.recT[k]);
    if (m.cellType[o.recNode[k]] === CT.VENTRICULAR) lastVent = Math.max(lastVent, o.recT[k]);
  }
  for (const w of o.waves) if (w.origin === "reentry") reentry++;
  const after = burstEnd + 500;
  const all: number[] = [];
  for (const s of series) {
    const late = s.filter((t) => t > after);
    for (let i = 1; i < late.length; i++) all.push(late[i] - late[i - 1]);
  }
  const mean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : NaN;
  const sd = all.length ? Math.sqrt(all.reduce((a, b) => a + (b - mean) ** 2, 0) / all.length) : NaN;
  return { sustained: lastVent > T - 400, cl: mean, cvPct: (100 * sd) / mean, n: all.length, reentry };
}

for (const het of [0.2, 0.35, 0.5])
  for (const cvv of [0.25, 0.35, 0.5])
    for (const apd of [170, 210, 250])
      for (const [site, cycle, nb] of [["rv-apex", 150, 12], ["lv-lateral", 130, 16]] as const) {
        const r = run(het, cvv, apd, site, cycle, nb);
        if (r.sustained && r.n > 6) {
          const fit = r.cl >= 160 && r.cl <= 290 ? "  <== VF-LIKE" : "";
          console.log(`het=${het} cv=${cvv} apd=${apd} ${site} burst ${nb}x${cycle} -> CL=${r.cl.toFixed(0)} var=${r.cvPct.toFixed(0)}% n=${r.n} reentry=${r.reentry}${fit}`);
        }
      }
console.log("vf scan complete");
