/**
 * Second scar scan: find a configuration where programmed stimulation induces SUSTAINED
 * monomorphic re-entry at a clinically plausible VT cycle length (roughly 280–500 ms,
 * i.e. 120–215 /min), and where nothing starts spontaneously.
 */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { CT } from "../../src/simulation/core/model";

const m = buildCardiacModel();
const W = computeLeadField(m);
const T = 13000;
const t0 = 2000;

function build(iCv: number, iApd: number, bCv: number) {
  const p = cloneParams(DEFAULT_PARAMS);
  p.ventricles.scar = true;
  p.ventricles.isthmusCvFactor = iCv;
  p.ventricles.isthmusApdFactor = iApd;
  p.ventricles.borderCvFactor = bCv;
  return sanitizeParams(p as unknown as Record<string, unknown>);
}

function analyse(sim: Simulator, from: number) {
  const o = sim.drain();
  const probe = m.ectopicSites["rvot"];
  const ts: number[] = [];
  let lastVent = 0;
  let reentry = 0;
  for (let k = 0; k < o.recT.length; k++) {
    if (o.recNode[k] === probe) ts.push(o.recT[k]);
    if (m.cellType[o.recNode[k]] === CT.VENTRICULAR) lastVent = Math.max(lastVent, o.recT[k]);
  }
  for (const w of o.waves) if (w.origin === "reentry") reentry++;
  const late = ts.filter((t) => t > from);
  const ivs = late.slice(1).map((t, i) => t - late[i]);
  const mean = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : NaN;
  const sd = ivs.length ? Math.sqrt(ivs.reduce((a, b) => a + (b - mean) ** 2, 0) / ivs.length) : NaN;
  return { lastVent, reentry, n: late.length, cl: mean, cvPct: (100 * sd) / mean };
}

/** Spontaneous-arrhythmia check: no stimulation at all. */
function spontaneous(p: ReturnType<typeof build>) {
  const sim = new Simulator(m, p, W);
  sim.run(7000);
  const r = analyse(sim, 3000);
  return r.reentry > 0 || (r.n > 2 && r.cl < 700);
}

const results: string[] = [];
for (const iCv of [0.08, 0.12, 0.18])
  for (const iApd of [1.2, 1.35, 1.5])
    for (const bCv of [0.12, 0.2, 0.3]) {
      const p = build(iCv, iApd, bCv);
      if (spontaneous(p)) {
        results.push(`iCv=${iCv} iApd=${iApd} bCv=${bCv}  SPONTANEOUS — rejected`);
        continue;
      }
      let best = "";
      for (const s1 of [500, 400])
        for (const s2 of [240, 270, 300])
          for (const s3 of [0, 220, 250]) {
            const sim = new Simulator(m, p, W);
            const node = m.ectopicSites["scar-border"];
            const times = [...Array(8).keys()].map((i) => t0 + s1 * i);
            const last = times[times.length - 1];
            times.push(last + s2);
            if (s3) times.push(last + s2 + s3);
            for (const t of times) sim.stimulate(node, t);
            sim.run(T);
            const r = analyse(sim, times[times.length - 1] + 400);
            const sustained = r.lastVent > T - 400 && r.n >= 8 && r.cl < 600;
            if (sustained) {
              const flag = r.cl >= 280 && r.cl <= 520 ? "  <== PLAUSIBLE VT" : "";
              const line = `iCv=${iCv} iApd=${iApd} bCv=${bCv} S1=${s1} S2=${s2}${s3 ? " S3=" + s3 : ""} -> CL=${r.cl.toFixed(0)} cv=${r.cvPct.toFixed(0)}% n=${r.n} reentry=${r.reentry}${flag}`;
              console.log(line);
              if (!best || (r.cl >= 280 && r.cl <= 520)) best = line;
            }
          }
      if (best) results.push(best);
    }
console.log("\n--- summary ---");
for (const r of results) console.log(r);
