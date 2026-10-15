import { ANATOMY } from "../../src/simulation/tissue/anatomy";
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams } from "../../src/simulation/core/params";
import { writeFileSync } from "fs";
const over = JSON.parse(process.argv[2] ?? "{}");
Object.assign(ANATOMY, over.anatomy ?? {});
import { CS_COVERAGE } from "../../src/simulation/conduction/conductionSystem";
Object.assign(CS_COVERAGE, over.cs ?? {});
const m = buildCardiacModel();
const P = sanitizeParams(over.params ?? {});
const sim = new Simulator(m, P);
sim.run(3800);
const out = sim.drain();
const w = out.waves.sort((a, b) => a.id - b.id).filter(w => w.origin === "sinus")[3];
const dt = sim.dt;
const qOn = w.tFirstVent, qOff = w.tLastVent + 6, tEnd = w.tVentRepolEnd + 40;
const area = (k: number, a: number, b: number) => { let s = 0; for (let t = a; t < b; t += dt) s += out.ecg[Math.round(t / dt) * 15 + k] * dt; return s; };
const axis = (a: number, b: number) => (Math.atan2(area(5, a, b) / 1.5, area(0, a, b) / Math.sqrt(3)) * 180) / Math.PI;
const names = ["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"];
const ext = (k: number, a: number, b: number) => { let mn = 0, mx = 0; for (let t = a; t < b; t += dt) { const v = out.ecg[Math.round(t / dt) * 15 + k]; mn = Math.min(mn, v); mx = Math.max(mx, v); } return [mx, mn].map(v => +v.toFixed(2)); };
console.log("nodes", m.n, "vent", m.counts.ventricular, "QRS(model)", (w.tLastVent - w.tFirstVent).toFixed(0), "HV", (w.tFirstVent - w.tHisProximal).toFixed(0), "PR", (w.tFirstVent - w.tFirstAtrial).toFixed(0), "QT(model)", (w.tVentRepolEnd - w.tFirstVent).toFixed(0), "last", m.region[w.lastVentNode]);
console.log("QRS axis", axis(qOn, qOff).toFixed(0), "T axis", axis(qOff + 60, tEnd).toFixed(0), "P axis", axis(w.tFirstAtrial, w.tLastAtrial + 10).toFixed(0));
console.log("QRS R/S", names.map((n, k) => `${n}:${ext(k, qOn, qOff).join("/")}`).join(" "));
console.log("T max/min", names.map((n, k) => `${n}:${ext(k, qOff + 60, tEnd).join("/")}`).join(" "));
writeFileSync("tune-ecg.json", JSON.stringify({ ecg: Array.from(out.ecg), n: out.sampleCount, dt }));
console.log("beat t0", w.t0);
const pa=(c:number)=>area(c,qOn,qOff); console.log("dipole QRS frontal angle", (Math.atan2(pa(13),pa(12))*180/Math.PI).toFixed(0), "Pz", pa(14).toFixed(1), "Px",pa(12).toFixed(1),"Py",pa(13).toFixed(1));
{
  const bands = new Array(10).fill(0).map(() => [0, 0]);
  for (let k = 0; k < out.recT.length; k++) {
    if (out.recWave[k] !== w.id) continue;
    const i = out.recNode[k];
    if (m.cellType[i] !== 5) continue;
    const b = Math.min(9, Math.floor(m.apicobasal[i] * 10));
    bands[b][0] += out.recT[k] - w.tFirstVent; bands[b][1]++;
  }
  console.log("AT by base→apex band:", bands.map(([s, c]) => (c ? (s / c).toFixed(0) + "(" + c + ")" : "-")).join(" "));
}
