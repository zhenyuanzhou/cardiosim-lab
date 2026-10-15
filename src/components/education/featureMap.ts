/**
 * Maps an instant on the ECG to the simulated electrical state of the heart at that
 * instant (ECG feature → physiological origin), using the activation records directly.
 * Text avoids one-to-one claims where several processes overlap.
 */
import { CT, REGION_NAMES } from "../../simulation/core/model";
import { SHAPES, repolMidpoint } from "../../simulation/cellular/actionPotential";
import type { SimData } from "../../simulation/worker/client";
import type { ModelMeta } from "../../simulation/worker/protocol";
import type { BeatMeasurement } from "../../simulation/ecg-forward/measurements";

export interface InstantState {
  segment: string;
  origin: string;
  caveat: string;
  atria: { front: number; plateau: number; phase3: number; rest: number };
  ventricles: { front: number; plateau: number; phase3: number; rest: number };
  frontRegion: string | null;
  conduction: string | null;
}

export function describeInstant(meta: ModelMeta, data: SimData, beats: BeatMeasurement[], t: number): InstantState {
  const acc = {
    a: { front: 0, plateau: 0, phase3: 0, rest: 0, n: 0 },
    v: { front: 0, plateau: 0, phase3: 0, rest: 0, n: 0 },
  };
  const frontByRegion = new Map<number, number>();
  for (let i = 0; i < meta.n; i++) {
    const ct = meta.cellType[i];
    if (ct !== CT.ATRIAL && ct !== CT.VENTRICULAR) continue;
    const g = ct === CT.ATRIAL ? acc.a : acc.v;
    g.n++;
    const r = data.lastActIndex(i, t);
    if (r < 0) {
      g.rest++;
      continue;
    }
    const s = SHAPES[ct];
    const tau = t - data.recT[r];
    const apd = data.recApd[r];
    const w = s.repolWidth * apd;
    if (tau < 6) {
      g.front++;
      frontByRegion.set(meta.region[i], (frontByRegion.get(meta.region[i]) ?? 0) + 1);
    } else if (tau < repolMidpoint(s, apd) - 1.5 * w) g.plateau++;
    else if (tau < apd + 2 * w) g.phase3++;
    else g.rest++;
  }
  const pct = (g: typeof acc.a) => ({
    front: (100 * g.front) / Math.max(1, g.n),
    plateau: (100 * g.plateau) / Math.max(1, g.n),
    phase3: (100 * g.phase3) / Math.max(1, g.n),
    rest: (100 * g.rest) / Math.max(1, g.n),
  });
  let frontRegion: string | null = null;
  let best = 0;
  for (const [rg, c] of frontByRegion)
    if (c > best) {
      best = c;
      frontRegion = REGION_NAMES[rg];
    }
  // conduction-system activity (ECG-silent)
  let conduction: string | null = null;
  for (const [node, name] of [
    [meta.avn, "AV node"],
    [meta.hisProximal, "His bundle"],
  ] as [number, string][]) {
    const r = data.lastActIndex(node, t);
    if (r >= 0 && t - data.recT[r] < 70) conduction = conduction ? `${conduction}, ${name}` : name;
  }

  // segment classification from the signal-derived fiducials
  let segment = "Isoelectric (TP) interval";
  for (let k = 0; k < beats.length; k++) {
    const b = beats[k];
    const next = beats[k + 1];
    if (b.pOn !== null && b.pOff !== null && t >= b.pOn && t < b.pOff) segment = "P wave";
    else if (b.pOff !== null && t >= b.pOff && t < b.qrsOn) segment = "PR segment";
    else if (t >= b.qrsOn && t <= b.qrsOff) segment = "QRS complex";
    else if (b.tEnd !== null && t > b.qrsOff && t <= b.tEnd) {
      const stEnd = b.tPeak !== null ? b.qrsOff + (b.tPeak - b.qrsOff) * 0.45 : b.qrsOff + 80;
      segment = t < stEnd ? "ST segment" : "T wave";
    } else if (next && b.tEnd !== null && t > b.tEnd && (next.pOn === null || t < next.pOn)) segment = "Isoelectric (TP) interval";
  }
  const A = pct(acc.a);
  const V = pct(acc.v);
  const f = (x: number) => `${x.toFixed(0)} %`;
  let origin = "";
  let caveat = "";
  switch (segment) {
    case "P wave":
      origin = `Atrial depolarisation: ${f(A.front)} of atrial cells are in their upstroke${frontRegion ? ` (wavefront mainly in ${frontRegion.toLowerCase()})` : ""}; ${f(A.plateau + A.phase3)} already depolarised.`;
      caveat = "SA-node depolarisation precedes the P wave but is ECG-silent (too little tissue).";
      break;
    case "PR segment":
      origin = `Atrial activation is (nearly) complete; the impulse is in the ${conduction ?? "AV junction / His–Purkinje system"}, which is ECG-silent in this model.`;
      caveat = "Atrial repolarisation (Ta wave) starts here and overlaps the PR segment and QRS; the segment is not a pure 'conduction' signal.";
      break;
    case "QRS complex":
      origin = `Ventricular depolarisation: ${f(V.front)} of ventricular cells in their upstroke${frontRegion ? ` (largest share in ${frontRegion.toLowerCase()})` : ""}; ${f(V.plateau + V.phase3)} already activated.`;
      caveat = "Atrial repolarisation also contributes during the QRS. QRS shape reflects the whole activation sequence projected on each lead, not one structure.";
      break;
    case "ST segment":
      origin = `Ventricles mostly in the plateau (phase 2): ${f(V.plateau)} plateau, ${f(V.phase3)} repolarising. Small voltage gradients → near-isoelectric.`;
      caveat = "ST level depends on plateau differences between regions; ischaemic injury currents are not modelled in Phase 1.";
      break;
    case "T wave":
      origin = `Ventricular repolarisation: ${f(V.phase3)} of ventricular cells in phase 3, ${f(V.rest)} recovered.`;
      caveat = "The T wave reflects DIFFERENCES in repolarisation timing (dispersion along all axes), not repolarisation of a single region.";
      break;
    default:
      origin = `Electrical diastole: ${f(V.rest)} of ventricular and ${f(A.rest)} of atrial cells at rest (phase 4).`;
      caveat = "SA-node phase-4 depolarisation continues during this interval but is ECG-silent.";
  }
  return { segment, origin, caveat, atria: A, ventricles: V, frontRegion, conduction };
}
