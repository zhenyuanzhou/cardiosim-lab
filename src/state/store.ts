import { create } from "zustand";
import { DEFAULT_PARAMS, cloneParams, type SimParams } from "../simulation/core/params";
import { SimClient } from "../simulation/worker/client";
import type { ParamChange } from "../components/education/explainEngine";
import type { FromWorker } from "../simulation/worker/protocol";

/** The one simulation client shared by every view. */
export const sim = new SimClient();

/**
 * Display clock (high-frequency, mutable; read by canvas views in their animation frames).
 * `t` is SIMULATION time in ms being displayed. Display time advances at `speed` × wall time
 * but never past the last simulated sample.
 */
export const clock = { t: 0, lastWall: 0 };

export type HeartColor = "vm" | "activation" | "state";
export type Tab = "scenarios" | "parameters" | "explain" | "events" | "validation" | "compare" | "about";
export type CompareResult = Extract<FromWorker, { type: "compareResult" }> & { a_params: SimParams; b_params: SimParams };

export interface UIState {
  ready: boolean;
  error: string | null;
  params: SimParams;
  paramChanges: ParamChange[];
  scenarioId: string;
  shownTime: number; // low-frequency copy of clock.t for React text
  playing: boolean;
  speed: number;
  sampleRate: 500 | 1000;
  paperSpeed: 25 | 50;
  gain: 5 | 10 | 20;
  ecgLayout: "12lead" | "leads";
  selectedLeads: string[];
  ecgTool: "inspect" | "calipers";
  calipers: number[];
  heartColor: HeartColor;
  layers: { atria: boolean; ventricles: boolean; conduction: boolean; cutaway: boolean; labels: boolean };
  probes: string[];
  customNode: number | null;
  baselineA: SimParams | null;
  compare: CompareResult | null;
  compareBusy: boolean;
  showCompare: boolean;
  inspectT: number | null;
  tab: Tab;
  theme: "dark" | "light";
  set: (p: Partial<UIState>) => void;
}

export const useStore = create<UIState>((set) => ({
  ready: false,
  error: null,
  params: cloneParams(DEFAULT_PARAMS),
  paramChanges: [],
  scenarioId: "nsr",
  shownTime: 0,
  playing: true,
  speed: 0.5,
  sampleRate: 500,
  paperSpeed: 25,
  gain: 10,
  ecgLayout: "12lead",
  selectedLeads: ["II", "V1", "V5"],
  ecgTool: "inspect",
  calipers: [],
  heartColor: "vm",
  layers: { atria: true, ventricles: true, conduction: true, cutaway: false, labels: true },
  probes: ["san", "ra", "avn", "his", "lvendo", "lvepi"],
  customNode: null,
  baselineA: null,
  compare: null,
  compareBusy: false,
  showCompare: false,
  inspectT: null,
  tab: "parameters",
  theme: "dark",
  set: (p) => set(p),
}));

let changeId = 0;
export const nextChangeId = () => ++changeId;
