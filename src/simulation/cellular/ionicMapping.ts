/**
 * Bridge from the TP06 single-cell model to the reduced-order tissue model.
 *
 *   APD scale  = mean APD90(epi, M, endo | modified) / mean APD90(epi, M, endo | baseline)
 *   CV scale   = sqrt( mean dV/dt_max(modified) / mean dV/dt_max(baseline) )
 *
 * The CV relation (CV ∝ √(dV/dt_max)) follows from cable theory for a uniform fibre and is an
 * approximation; the tissue AP *shape* is unchanged (so e.g. a peaked T wave from faster
 * repolarisation is not reproduced). Both factors are applied to the ventricles only.
 */
import type { PacedResult } from "./tp06";
import { cloneParams, type SimParams } from "../core/params";

export interface IonicMapping {
  apdScale: number;
  cvScale: number;
}
export function mapToTissue(base: PacedResult[], mod: PacedResult[]): IonicMapping {
  const m = (xs: PacedResult[], f: (r: PacedResult) => number) => xs.reduce((a, r) => a + f(r), 0) / xs.length;
  return {
    apdScale: m(mod, (r) => r.apd90) / m(base, (r) => r.apd90),
    cvScale: Math.sqrt(m(mod, (r) => r.dvdtMax) / m(base, (r) => r.dvdtMax)),
  };
}
export function applyMapping(p: SimParams, map: IonicMapping, ref: SimParams): SimParams {
  const q = cloneParams(p);
  q.ventricles.apd = Math.round(ref.ventricles.apd * map.apdScale);
  q.ventricles.transmuralGradient = Math.round(ref.ventricles.transmuralGradient * map.apdScale);
  q.ventricles.apicobasalGradient = Math.round(ref.ventricles.apicobasalGradient * map.apdScale);
  q.ventricles.cvLongitudinal = +(ref.ventricles.cvLongitudinal * map.cvScale).toFixed(3);
  return q;
}
