import { DEFAULT_PARAMS, cloneParams, diffParams, sanitizeParams, type SimParams } from "../simulation/core/params";
import { clock, nextChangeId, sim, useStore } from "./store";
import { seek } from "../visualization/frameLoop";

/** Apply new parameters live at the current display time (the simulation is re-run from there). */
export function applyLive(next: SimParams): void {
  const st = useStore.getState();
  const changes = diffParams(st.params, next);
  if (!changes.length) return;
  const at = Math.max(0, clock.t);
  sim.setParams(next, at);
  st.set({
    params: cloneParams(next),
    paramChanges: [...st.paramChanges, ...changes.map((c) => ({ id: nextChangeId(), path: c.path, from: c.a, to: c.b, at }))].slice(-30),
  });
}

/** Restart the simulation from t = 0 with the given parameters. */
export function restart(next: SimParams, sampleRate?: 500 | 1000): void {
  const st = useStore.getState();
  const sr = sampleRate ?? st.sampleRate;
  sim.restart(next, 1000 / sr);
  clock.t = 0;
  st.set({ params: cloneParams(next), paramChanges: [], inspectT: null, calipers: [], sampleRate: sr, shownTime: 0, playing: true });
}

export function resetDefaults(): void {
  useStore.getState().set({ scenarioId: "nsr" });
  restart(cloneParams(DEFAULT_PARAMS));
}

export function saveScenarioJson(): string {
  const st = useStore.getState();
  return JSON.stringify(
    {
      app: "CardioSim Lab",
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      scenarioId: st.scenarioId,
      sampleRate: st.sampleRate,
      params: st.params,
      note: "Research education and concept demonstration only. Not a clinical or patient-specific model.",
    },
    null,
    2,
  );
}

export function loadScenarioJson(text: string): string | null {
  try {
    const raw = JSON.parse(text);
    const params = sanitizeParams(raw.params ?? raw);
    const sr = raw.sampleRate === 1000 ? 1000 : 500;
    useStore.getState().set({ scenarioId: typeof raw.scenarioId === "string" ? raw.scenarioId : "custom" });
    restart(params, sr);
    return null;
  } catch (e) {
    return `Could not read the file: ${e instanceof Error ? e.message : String(e)}. Expected a CardioSim Lab scenario JSON.`;
  }
}

/** Jump to the previous/next QRS relative to the display time. */
export function jumpBeat(dir: -1 | 1): void {
  const data = sim.data;
  if (!data) return;
  const beats = data.measure();
  const t = clock.t;
  const anchors = beats.map((b) => (b.pOn ?? b.qrsOn - 200) - 60);
  let target: number | undefined;
  if (dir < 0) target = [...anchors].reverse().find((a) => a < t - 30);
  else target = anchors.find((a) => a > t + 30);
  if (target !== undefined) seek(target);
}
