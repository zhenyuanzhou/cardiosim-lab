/**
 * Client-side copy of the per-cell AP modifiers the simulator uses, so that every displayed membrane
 * potential (panel B, heart colouring, A/B overlay) matches the waveform that produced the ECG:
 * potassium-dependent shapes and the regional-ischaemia amplitude / resting-potential changes.
 */
import { shapesFor, type Shape } from "../simulation/cellular/actionPotential";
import { ischaemiaModifiers } from "../simulation/core/ischaemia";
import type { SimParams } from "../simulation/core/params";
import type { ModelMeta } from "../simulation/worker/protocol";

export interface ApMods {
  shapes: Record<number, Shape>;
  amp: Float32Array | null;
  rest: Float32Array | null;
  /** Ischaemic weight 0…1 per node (null without ischaemia). */
  field: Float32Array | null;
}
let lastKey = "";
let lastMeta: ModelMeta | null = null;
let last: ApMods | null = null;
export function apModsFor(meta: ModelMeta, p: SimParams): ApMods {
  const key = `${p.electrolytes.serumPotassium}|${p.ventricles.phase3Scale}|${p.ischaemia.culprit}|${p.ischaemia.grade}`;
  if (last && key === lastKey && meta === lastMeta) return last;
  const m = ischaemiaModifiers(meta as unknown as Parameters<typeof ischaemiaModifiers>[0], p);
  last = { shapes: shapesFor(p), amp: m.field ? m.amp : null, rest: m.field ? m.rest : null, field: m.field };
  lastKey = key;
  lastMeta = meta;
  return last;
}
/** Membrane potential of a working cell from its normalised activation A. */
export function vmOf(mods: ApMods, ct: number, node: number, A: number): number {
  const s = mods.shapes[ct];
  const r = mods.rest ? mods.rest[node] : 0;
  const amp = mods.amp ? mods.amp[node] : 1;
  return s.vRest + r + A * (s.vPeak - s.vRest) * amp;
}
