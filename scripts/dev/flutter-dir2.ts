/** Direction of flutter circulation: activation order along the RA septum (inferior→superior = counterclockwise). */
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams } from "../../src/simulation/core/params";
import { CT, RG } from "../../src/simulation/core/model";
const m: any = buildCardiacModel(); const P = m.pos;
const ra: number[] = [], la: number[] = [];
for (let i = 0; i < m.n; i++) if (m.cellType[i] === CT.ATRIAL) (m.region[i] === RG.LA ? la : ra).push(i);
const d2 = (i: number, j: number) => (P[3*i]-P[3*j])**2 + (P[3*i+1]-P[3*j+1])**2 + (P[3*i+2]-P[3*j+2])**2;
const septal = ra.filter((i) => la.some((j) => d2(i, j) < 36));
const sim: any = new Simulator(m, sanitizeParams(SCENARIOS.find((s) => s.id === "flutter")!.apply!() as any));
sim.run(4600); const T = 4600; const cl = 179;
const ph = (i: number) => ((T - sim.lastAct[i]) < cl ? sim.lastAct[i] : NaN);
const pts = septal.map((i) => [P[3*i+1], sim.lastAct[i]]).filter(([, t]) => T - t < cl);
// circular: order of activation by height; report mean activation time in inferior vs superior thirds
pts.sort((a, b) => a[0] - b[0]); const k = Math.floor(pts.length / 3);
const mean = (xs: number[][]) => xs.reduce((s, x) => s + x[1], 0) / xs.length;
console.log(`septal RA nodes ${septal.length}; superior third mean act ${mean(pts.slice(0, k)).toFixed(0)}, middle ${mean(pts.slice(k, 2*k)).toFixed(0)}, inferior third ${mean(pts.slice(2*k)).toFixed(0)}`);
const lat = ra.filter((i) => !septal.includes(i) && P[3*i] < -55);
const lp = lat.map((i) => [P[3*i+1], sim.lastAct[i]]).filter(([, t]) => T - t < cl).sort((a, b) => a[0] - b[0]); const k2 = Math.floor(lp.length / 3);
console.log(`lateral RA nodes ${lat.length}; superior ${mean(lp.slice(0, k2)).toFixed(0)}, middle ${mean(lp.slice(k2, 2*k2)).toFixed(0)}, inferior ${mean(lp.slice(2*k2)).toFixed(0)}`);
