/** Calibration prototype: baseline template × TP06 ratios (+ optional delayed slow tail). */
import { SHAPES } from "../../src/simulation/cellular/actionPotential";
import { CT } from "../../src/simulation/core/model";
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { DEFAULT_PARAMS, cloneParams } from "../../src/simulation/core/params";
import { N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
import { writeFileSync } from "node:fs";
// name P0r slopeR wR amp apd cv f d wu cvAll
const [name, P0r, sr, wr, amp, apd, cv, f, d, wu, cvAll] = [process.argv[2], ...process.argv.slice(3).map(Number)];
const V = SHAPES[CT.VENTRICULAR];
Object.assign(V, { plateau: V.plateau * P0r, plateauSlope: V.plateauSlope * sr, repolWidth: V.repolWidth * wr, tailFrac: f, tailDelay: d, tailWidth: wu, vPeak: V.vRest + 120 * amp });
const A = SHAPES[CT.ATRIAL]; A.vPeak = A.vRest + (A.vPeak - A.vRest) * amp;
const p = cloneParams(DEFAULT_PARAMS);
p.ventricles.apd = Math.round(p.ventricles.apd * apd); p.ventricles.transmuralGradient = Math.round(p.ventricles.transmuralGradient * apd); p.ventricles.apicobasalGradient = Math.round(p.ventricles.apicobasalGradient * apd);
p.ventricles.cvLongitudinal *= cv;
if (cvAll) { p.atria.cv *= cv; p.hisPurkinje.purkinjeCv *= cv; p.hisPurkinje.lbbCv *= cv; p.hisPurkinje.rbbCv *= cv; p.hisPurkinje.lafCv *= cv; p.hisPurkinje.lpfCv *= cv; p.hisPurkinje.hisDelay /= cv; }
const m = buildCardiacModel(); const sim = new Simulator(m, p); sim.run(6000); const o = sim.drain();
const rows = ["t,I,II,III,aVR,aVL,aVF,V1,V2,V3,V4,V5,V6"];
for (let i = 0; i < o.ecg.length / N_CHANNELS; i++) { const t = i * sim.dt; if (t < 2000 || t >= 4500) continue; rows.push([(t - 2000).toFixed(0), ...Array.from({ length: 12 }, (_, c) => o.ecg[i * N_CHANNELS + c].toFixed(4))].join(",")); }
writeFileSync(`/tmp/claude-0/ko/${name}.csv`, rows.join("\n"));
