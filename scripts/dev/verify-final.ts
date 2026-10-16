/** Verify the chosen configurations: spontaneous behaviour, baseline ECG, induced rhythm. */
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams, DEFAULT_PARAMS, cloneParams, type SimParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";
import { analyseMorphology } from "../../src/simulation/ecg-forward/morphology";
import { CT } from "../../src/simulation/core/model";
const m = buildCardiacModel();
const W = computeLeadField(m);
const med = (x:number[]) => x.slice().sort((a,b)=>a-b)[Math.floor(x.length/2)];

function scarVT(floor: number): SimParams {
  const p = cloneParams(DEFAULT_PARAMS);
  p.restitution.apdFloor = floor;
  p.ventricles.scar = true;
  p.ventricles.isthmusCvFactor = 0.08;
  p.ventricles.borderCvFactor = 0.2;
  p.ventricles.isthmusApdFactor = 1.3;
  return sanitizeParams(p as unknown as Record<string, unknown>);
}
function vf(): SimParams {
  const p = cloneParams(DEFAULT_PARAMS);
  p.restitution.apdFloor = 0.79;
  p.ventricles.heterogeneity = 0.2;
  return sanitizeParams(p as unknown as Record<string, unknown>);
}
function report(name: string, p: SimParams, stim: ((s: Simulator) => void) | null, probeMetric: boolean) {
  const sim = new Simulator(m, p, W);
  stim?.(sim);
  sim.run(13000);
  const o = sim.drain();
  let lastVent = 0, re = 0;
  for (let k = 0; k < o.recT.length; k++) if (m.cellType[o.recNode[k]] === CT.VENTRICULAR) lastVent = Math.max(lastVent, o.recT[k]);
  for (const w of o.waves) if (w.origin === "reentry") re++;
  const beats = measureBeats(o.ecg, sim.dt, 0, o.waves);
  const qt = beats.map(b=>b.qt).filter((x):x is number=>x!==null);
  const qrs = beats.map(b=>b.qrs).filter((x):x is number=>x!==null);
  let cl = NaN, cvp = NaN, disp = NaN;
  const after = 7000;
  if (probeMetric) {
    const probes = ["rvot","lv-apex","septum"].map(s=>m.ectopicSites[s]);
    const all: number[] = [];
    for (const pr of probes) { const ts:number[]=[]; for (let k=0;k<o.recT.length;k++) if (o.recNode[k]===pr && o.recT[k]>after) ts.push(o.recT[k]); ts.sort((a,b)=>a-b); for(let i=1;i<ts.length;i++) all.push(ts[i]-ts[i-1]); }
    cl = all.reduce((a,b)=>a+b,0)/all.length;
    cvp = 100*Math.sqrt(all.reduce((a,b)=>a+(b-cl)**2,0)/all.length)/cl;
  }
  const acts = o.waves.filter(w=>Number.isFinite(w.tFirstVent)&&w.tFirstVent>after).map(w=>w.tFirstVent).sort((a,b)=>a-b);
  const ivs = acts.slice(1).map((t,i)=>t-acts[i]);
  const waveCl = ivs.length? ivs.reduce((a,b)=>a+b,0)/ivs.length : NaN;
  disp = analyseMorphology(o.ecg, sim.dt, acts).axisDispersion;
  console.log(`${name.padEnd(30)} re=${String(re).padStart(3)} sust=${String(lastVent>12600).padEnd(5)} waveCL=${waveCl.toFixed(0)} ${probeMetric?`localCL=${cl.toFixed(0)} var=${cvp.toFixed(0)}%`:""} disp=${disp.toFixed(0)}° QT=${qt.length?med(qt).toFixed(0):"-"} QRS=${qrs.length?med(qrs).toFixed(0):"-"}`);
}
const pes = (s: Simulator) => { const n = m.ectopicSites["scar-border"]; const t=[...Array(8).keys()].map(i=>2000+500*i); t.push(t[7]+260); for (const x of t) s.stimulate(n,x); };
const burst = (s: Simulator) => { const n = m.ectopicSites["rv-apex"]; for (let i=0;i<14;i++) s.stimulate(n,3000+i*240); };

console.log("--- scar VT, floor 0.85 ---");
report("spontaneous (no stimulation)", scarVT(0.85), null, false);
report("programmed stimulation", scarVT(0.85), pes, false);
console.log("--- scar VT, floor 0.70 ---");
report("spontaneous (no stimulation)", scarVT(0.70), null, false);
report("programmed stimulation", scarVT(0.70), pes, false);
console.log("--- VF, floor 0.79 het 0.2 ---");
report("spontaneous (no burst)", vf(), null, true);
report("burst induced", vf(), burst, true);
