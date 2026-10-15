/**
 * Membrane potential of any cell at any display time, computed from the SAME activation
 * records and the SAME waveform functions the ECG forward model used.
 */
import { CT } from "../simulation/core/model";
import { SHAPES, nodalV, repolMidpoint, ventricularNotchScale, workingA } from "../simulation/cellular/actionPotential";
import type { SimData } from "../simulation/worker/client";
import type { ModelMeta } from "../simulation/worker/protocol";

export function vmAtRecord(meta: ModelMeta, data: SimData, node: number, r: number, t: number): number {
  const ct = meta.cellType[node];
  if (ct === CT.SAN || ct === CT.AVN) {
    const kind = ct === CT.SAN ? "san" : "avn";
    if (r < 0) return kind === "san" ? -62 : -65;
    const tAct = data.recT[r];
    // cycle for the phase-4 ramp: interval to the next activation (if known) else previous interval
    const acts = data.nodeActs[node];
    const pos = acts.indexOf(r);
    let cycle = 800;
    if (pos >= 0 && pos + 1 < acts.length) cycle = data.recT[acts[pos + 1]] - tAct;
    else if (pos > 0) cycle = tAct - data.recT[acts[pos - 1]];
    return nodalV(kind, t - tAct, data.recApd[r], cycle);
  }
  const s = SHAPES[ct];
  if (r < 0) return s.vRest;
  const apd = data.recApd[r];
  const notch = ct === CT.VENTRICULAR ? ventricularNotchScale(meta.transmural[node]) : 1;
  return s.vRest + workingA(s, t - data.recT[r], apd, repolMidpoint(s, apd), notch) * (s.vPeak - s.vRest);
}

export function vmAt(meta: ModelMeta, data: SimData, node: number, t: number): number {
  return vmAtRecord(meta, data, node, data.lastActIndex(node, t), t);
}

/** Normalised activation 0 (rest) … 1 (peak) used for colouring. */
export function normA(meta: ModelMeta, data: SimData, node: number, r: number, t: number): number {
  const ct = meta.cellType[node];
  if (r < 0) return 0;
  if (ct === CT.SAN || ct === CT.AVN) {
    const v = vmAtRecord(meta, data, node, r, t);
    return Math.max(0, Math.min(1, (v + 65) / 75));
  }
  const s = SHAPES[ct];
  const apd = data.recApd[r];
  const notch = ct === CT.VENTRICULAR ? ventricularNotchScale(meta.transmural[node]) : 1;
  return workingA(s, t - data.recT[r], apd, repolMidpoint(s, apd), notch);
}

export function erpRatioFor(ct: number, p: { atria: { erpRatio: number }; ventricles: { erpRatio: number } }): number {
  if (ct === CT.ATRIAL) return p.atria.erpRatio;
  return p.ventricles.erpRatio;
}
