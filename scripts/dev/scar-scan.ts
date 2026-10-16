/**
 * Scan scar/isthmus parameters and programmed-stimulation coupling for sustained re-entry.
 * npx tsx scripts/dev/scar-scan.ts
 * Builds the anatomical model once and reuses it for every configuration.
 */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { CT } from "../../src/simulation/core/model";

const m = buildCardiacModel();
const W = computeLeadField(m);
const T = 11000;
const S1 = 600;
const nS1 = 8;
const t0 = 2000;

interface Res {
  cfg: string;
  sustained: boolean;
  cl: number;
  cv: number;
  nBeats: number;
}

function run(iCv: number, iApd: number, bCv: number, s2: number, s3: number | null): Res {
  const p = cloneParams(DEFAULT_PARAMS);
  p.ventricles.scar = true;
  p.ventricles.isthmusCvFactor = iCv;
  p.ventricles.isthmusApdFactor = iApd;
  p.ventricles.borderCvFactor = bCv;
  const sim = new Simulator(m, sanitizeParams(p as unknown as Record<string, unknown>), W);
  const node = m.ectopicSites["scar-border"];
  const times = [...Array(nS1).keys()].map((i) => t0 + S1 * i);
  const last = times[times.length - 1];
  times.push(last + s2);
  if (s3) times.push(last + s2 + s3);
  for (const t of times) sim.stimulate(node, t);
  sim.run(T);
  const o = sim.drain();
  const probe = m.ectopicSites["rvot"];
  const ts: number[] = [];
  let lastVent = 0;
  for (let k = 0; k < o.recT.length; k++) {
    if (o.recNode[k] === probe) ts.push(o.recT[k]);
    if (m.cellType[o.recNode[k]] === CT.VENTRICULAR) lastVent = Math.max(lastVent, o.recT[k]);
  }
  const after = times[times.length - 1] + 200;
  const late = ts.filter((t) => t > after);
  const ivs = late.slice(1).map((t, i) => t - late[i]);
  const mean = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : NaN;
  const sd = ivs.length ? Math.sqrt(ivs.reduce((a, b) => a + (b - mean) ** 2, 0) / ivs.length) : NaN;
  return {
    cfg: `iCv=${iCv} iApd=${iApd} bCv=${bCv} S2=${s2}${s3 ? " S3=" + s3 : ""}`,
    sustained: lastVent > T - 400,
    cl: mean,
    cv: (100 * sd) / mean,
    nBeats: late.length,
  };
}

const out: Res[] = [];
for (const iCv of [0.08, 0.12, 0.2])
  for (const iApd of [1.15, 1.35, 1.55])
    for (const bCv of [0.2, 0.3, 0.5])
      for (const s2 of [260, 300, 340]) {
        const r = run(iCv, iApd, bCv, s2, null);
        out.push(r);
        if (r.sustained) console.log(`SUSTAINED ${r.cfg} CL=${r.cl.toFixed(0)} cv=${r.cv.toFixed(0)}% n=${r.nBeats}`);
      }
console.log(`\n${out.filter((r) => r.sustained).length}/${out.length} sustained`);
const near = out.filter((r) => r.nBeats > 3).sort((a, b) => b.nBeats - a.nBeats).slice(0, 12);
console.log("most activity:");
for (const r of near) console.log(`  ${r.cfg} n=${r.nBeats} CL=${r.cl.toFixed(0)} sustained=${r.sustained}`);
