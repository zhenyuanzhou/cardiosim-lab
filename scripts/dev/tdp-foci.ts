/** Two-foci torsades: test site pairs and cycle lengths against the defining features. */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";
const m = buildCardiacModel(); const W = computeLeadField(m);
const pairs: [string,string][] = [["rv-apex","lv-anterobasal"],["rvot","lv-apex"],["lv-lateral","septum"],["rv-apex","lv-lateral"],["lv-inferobasal","rvot"]];
for (const [A,B] of pairs) for (const [ca,cb] of [[250,270],[250,280],[260,290]]) {
  const p = cloneParams(DEFAULT_PARAMS);
  p.ventricles.apd = Math.round(300*1.173); p.ventricles.transmuralGradient = Math.round(25*1.173); p.ventricles.apicobasalGradient = Math.round(-30*1.173);
  p.torsades = { enabled: true, siteA: A as never, siteB: B as never, cycleA: ca, cycleB: cb, beats: 16, every: 6, coupling: 390 };
  const sim = new Simulator(m, sanitizeParams(p as unknown as Record<string,unknown>), W);
  sim.run(20000); const o = sim.drain();
  const tw = o.waves.filter(w=>w.site==="torsades focus"&&Number.isFinite(w.tFirstVent)).sort((a,b)=>a.tFirstVent-b.tFirstVent);
  // split into episodes (gap > 700 ms)
  const eps: number[][] = []; let cur: number[] = [];
  for (const w of tw) { if (cur.length && w.tFirstVent - cur[cur.length-1] > 700) { eps.push(cur); cur=[]; } cur.push(w.tFirstVent); }
  if (cur.length) eps.push(cur);
  const runs = eps.filter(e=>e.length>=6);
  if (!runs.length) { console.log(`${A}+${B} ${ca}/${cb}: no run`); continue; }
  const r = runs[0];
  const ivs = r.slice(1).map((t,i)=>t-r[i]); const cl = ivs.reduce((a,b)=>a+b,0)/ivs.length;
  const mo = analyseMorphology(o.ecg, sim.dt, r);
  // sinus resumes after the run?
  const after = o.waves.filter(w=>w.origin==="sinus"&&Number.isFinite(w.tFirstVent)&&w.tFirstVent>r[r.length-1]+300&&w.tFirstVent<r[r.length-1]+3000).length;
  const qt = measureBeats(o.ecg, sim.dt, 0, o.waves).map(b=>b.qt).filter((x):x is number=>x!==null).sort((a,b)=>a-b);
  console.log(`${(A+"+"+B).padEnd(26)} ${ca}/${cb}: episodes=${runs.length} beats=${r.length} CL=${cl.toFixed(0)} (${(60000/cl).toFixed(0)}/min) disp=${mo.axisDispersion.toFixed(0)}° rot=${mo.meanRotation.toFixed(0)}°/b cons=${(100*mo.rotationConsistency).toFixed(0)}% sinusResumes=${after>0} QTmed=${qt[Math.floor(qt.length/2)]}`);
}
