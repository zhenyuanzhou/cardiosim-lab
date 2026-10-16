/** Tune the APD floor so fibrillation cycle length matches human VF (218 ± 24 ms, Nair 2012). */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { CT } from "../../src/simulation/core/model";
const m = buildCardiacModel();
const W = computeLeadField(m);
const T = 12000, BURST = 3000;
function run(floor: number, het: number, nb = 14, cycle = 200) {
  const p = cloneParams(DEFAULT_PARAMS);
  p.restitution.apdFloor = floor;
  p.ventricles.heterogeneity = het;
  const sim = new Simulator(m, sanitizeParams(p as unknown as Record<string, unknown>), W);
  const node = m.ectopicSites["rv-apex"];
  for (let i = 0; i < nb; i++) sim.stimulate(node, BURST + i * cycle);
  sim.run(T);
  const o = sim.drain();
  const probes = ["rvot", "lv-apex", "septum"].map((s) => m.ectopicSites[s]);
  const series = probes.map(() => [] as number[]);
  let lastVent = 0, re = 0;
  for (let k = 0; k < o.recT.length; k++) {
    const i = probes.indexOf(o.recNode[k]);
    if (i >= 0) series[i].push(o.recT[k]);
    if (m.cellType[o.recNode[k]] === CT.VENTRICULAR) lastVent = Math.max(lastVent, o.recT[k]);
  }
  for (const w of o.waves) if (w.origin === "reentry") re++;
  const after = BURST + nb * cycle + 600;
  const all: number[] = [];
  for (const s of series) { const l = s.filter((t) => t > after); for (let i = 1; i < l.length; i++) all.push(l[i] - l[i - 1]); }
  const mean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : NaN;
  const sd = all.length ? Math.sqrt(all.reduce((a, b) => a + (b - mean) ** 2, 0) / all.length) : NaN;
  return { sustained: lastVent > T - 400, cl: mean, cvPct: (100 * sd) / mean, n: all.length, re };
}
for (const floor of [0.6, 0.7, 0.79, 0.85]) {
  for (const het of [0.2, 0.3, 0.4]) {
    const r = run(floor, het);
    console.log(`floor=${floor} het=${het} -> sustained=${r.sustained} CL=${r.cl.toFixed(0)} var=${r.cvPct.toFixed(0)}% n=${r.n} reentry=${r.re}`);
  }
}
