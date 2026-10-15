import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator, type SimOutput } from "../../src/simulation/core/engine";
import { DEFAULT_PARAMS, cloneParams, type SimParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
import { measureBeats } from "../../src/simulation/ecg-forward/measurements";

export const model = buildCardiacModel();
export const W = computeLeadField(model);

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export function params(over: DeepPartial<SimParams> = {}): SimParams {
  const p = cloneParams(DEFAULT_PARAMS);
  for (const [g, v] of Object.entries(over)) {
    if (v && typeof v === "object") Object.assign((p as unknown as Record<string, object>)[g], v);
    else (p as unknown as Record<string, unknown>)[g] = v;
  }
  return p;
}

export function run(p: SimParams, ms: number, setup?: (s: Simulator) => void) {
  const sim = new Simulator(model, p, W);
  setup?.(sim);
  sim.run(ms);
  const out = sim.drain();
  const beats = measureBeats(out.ecg, sim.dt, 0, out.waves);
  return { sim, out, beats, waves: out.waves.sort((a, b) => a.id - b.id) };
}

export const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function activationTimes(out: SimOutput, waveId: number): Map<number, number> {
  const m = new Map<number, number>();
  for (let k = 0; k < out.recT.length; k++) if (out.recWave[k] === waveId) m.set(out.recNode[k], out.recT[k]);
  return m;
}
