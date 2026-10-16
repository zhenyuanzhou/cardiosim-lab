/** Scan ventricular heterogeneity + long QT for polymorphic re-entry (PVT/TdP/VF substrates). */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { CT } from "../../src/simulation/core/model";

const m = buildCardiacModel();
const W = computeLeadField(m);
const T = 9000;

function run(het: number, cv: number, apd: number, site: string, coupling: number, runLen: number, rate: number) {
  const p = cloneParams(DEFAULT_PARAMS);
  p.ventricles.heterogeneity = het;
  p.ventricles.cvLongitudinal = cv;
  p.ventricles.apd = apd;
  p.ectopy = { ...p.ectopy, site: site as never, pattern: "run", runLength: runLen, coupling, every: 3, rate };
  const sim = new Simulator(m, sanitizeParams(p as unknown as Record<string, unknown>), W);
  sim.run(T);
  const o = sim.drain();
  const probe = m.ectopicSites["rvot"];
  const ts: number[] = [];
  let lastVent = 0;
  for (let k = 0; k < o.recT.length; k++) {
    if (o.recNode[k] === probe) ts.push(o.recT[k]);
    if (m.cellType[o.recNode[k]] === CT.VENTRICULAR) lastVent = Math.max(lastVent, o.recT[k]);
  }
  const late = ts.filter((t) => t > T * 0.6);
  const ivs = late.slice(1).map((t, i) => t - late[i]);
  const mean = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : NaN;
  const sd = ivs.length ? Math.sqrt(ivs.reduce((a, b) => a + (b - mean) ** 2, 0) / ivs.length) : NaN;
  let reentry = 0;
  for (const w of o.waves) if (w.origin === "reentry") reentry++;
  return { sustained: lastVent > T - 400, cl: mean, cv: (100 * sd) / mean, n: late.length, reentry };
}

for (const het of [0.15, 0.3, 0.45])
  for (const cvv of [0.3, 0.45, 0.6])
    for (const apd of [200, 260, 320])
      for (const [site, coupling, runLen, rate] of [["lv-lateral", 220, 8, 300], ["rv-apex", 200, 10, 350]] as const) {
        const r = run(het, cvv, apd, site, coupling, runLen, rate);
        if (r.sustained || r.reentry > 2)
          console.log(`het=${het} cv=${cvv} apd=${apd} ${site} S=${coupling}x${runLen} -> sust=${r.sustained} CL=${r.cl.toFixed(0)} cvRR=${r.cv.toFixed(0)}% n=${r.n} reentry=${r.reentry}`);
      }
console.log("scan complete");
