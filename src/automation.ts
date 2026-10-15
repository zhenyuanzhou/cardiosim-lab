/**
 * Automation hooks (used by the demo-video recorder and e2e tooling). Exposes read/control
 * access to the running app on `window.__cardiosim`; no simulation state is altered by loading it.
 */
import { clock, sim, useStore } from "./state/store";
import { seek } from "./visualization/frameLoop";
import { applyLive, restart } from "./state/actions";
import { SCENARIOS } from "./simulation/scenarios/scenarios";
import { EXPERIMENTS } from "./visualization/explorer/experiments";
import { DEFAULT_PARAMS, cloneParams } from "./simulation/core/params";

export interface Automation {
  clock: typeof clock;
  sim: typeof sim;
  store: typeof useStore;
  seek: typeof seek;
  restart: typeof restart;
  applyLive: typeof applyLive;
  scenarios: typeof SCENARIOS;
  experiments: typeof EXPERIMENTS;
  defaults: () => ReturnType<typeof cloneParams>;
  /** When set, the A/B view uses this time instead of its own playback clock. */
  abTime?: number;
}

const api: Automation = { clock, sim, store: useStore, seek, restart, applyLive, scenarios: SCENARIOS, experiments: EXPERIMENTS, defaults: () => cloneParams(DEFAULT_PARAMS) };
(window as unknown as { __cardiosim: Automation }).__cardiosim = api;
export default api;
