/** Scar VT: look for MONOMORPHIC re-entry at a clinical VT cycle length (280-500 ms). */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
import { CT } from "../../src/simulation/core/model";
const m = buildCardiacModel();
const W = computeLeadField(m);
const T = 12000, t0 = 2000;
function go(floor: number, bCv: number, iCv: number, iApd: number, s1: number, s2: number) {
  const p = cloneParams(DEFAULT_PARAMS);
  p.restitution.apdFloor = floor;
  p.ventricles.scar = true;
  p.ventricles.borderCvFactor = bCv;
  p.ventricles.isthmusCvFactor = iCv;
  p.ventricles.isthmusApdFactor = iApd;
  const sim = new Simulator(m, sanitizeParams(p as unknown as Record<string, unknown>), W);
  const node = m.ectopicSites["scar-border"];
  const times = [...Array(8).keys()].map((i) => t0 + s1 * i);
  times.push(times[times.length-1] + s2);
  for (const t of times) sim.stimulate(node, t);
  sim.run(T);
  const o = sim.drain();
  let lastVent = 0, re = 0;
  for (let k = 0; k < o.recT.length; k++) if (m.cellType[o.recNode[k]] === CT.VENTRICULAR) lastVent = Math.max(lastVent, o.recT[k]);
  for (const w of o.waves) if (w.origin === "reentry") re++;
  const after = times[times.length-1] + 400;
  const acts = o.waves.filter((w) => Number.isFinite(w.tFirstVent) && w.tFirstVent > after).map((w) => w.tFirstVent).sort((a,b)=>a-b);
  if (acts.length < 4) return null;
  const ivs = acts.slice(1).map((t,i)=>t-acts[i]);
  const mean = ivs.reduce((a,b)=>a+b,0)/ivs.length;
  const sd = Math.sqrt(ivs.reduce((a,b)=>a+(b-mean)**2,0)/ivs.length);
  const mo = analyseMorphology(o.ecg, sim.dt, acts);
  return { sust: lastVent > T-400, cl: mean, cv: 100*sd/mean, n: acts.length, re, disp: mo.axisDispersion };
}
for (const floor of [0.45, 0.7, 0.85])
  for (const bCv of [0.12, 0.2, 0.35])
    for (const iCv of [0.08, 0.15])
      for (const s2 of [260, 300]) {
        const r = go(floor, bCv, iCv, 1.3, 500, s2);
        if (!r || !r.sust || r.cl > 900) continue;
        const good = r.cl >= 280 && r.cl <= 500 && r.disp < 30 ? "  <== SCAR VT" : "";
        console.log(`floor=${floor} bCv=${bCv} iCv=${iCv} S2=${s2} -> CL=${r.cl.toFixed(0)} var=${r.cv.toFixed(0)}% n=${r.n} re=${r.re} disp=${r.disp.toFixed(0)}°${good}`);
      }
console.log("scar-final complete");
