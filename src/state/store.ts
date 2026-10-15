import { create } from "zustand";
import { DEFAULT_PARAMS, cloneParams, type SimParams } from "../simulation/core/params";
import { SimClient } from "../simulation/worker/client";
import type { ParamChange } from "../components/education/explainEngine";
import type { FromWorker } from "../simulation/worker/protocol";
import type { ActivationDisplay, HeartLayers, Highlight } from "../visualization/heart/HeartScene";

/** The one simulation client shared by every view. */
export const sim = new SimClient();

/**
 * Display clock (high-frequency, mutable; read by canvas views in their animation frames).
 * `t` is SIMULATION time in ms being displayed. Display time advances at `speed` × wall time
 * but never past the last simulated sample.
 */
export const clock = { t: 0, lastWall: 0 };

export type Mode = "simulator" | "explorer" | "split";
export interface TorsoLayers {
  torso: boolean;
  electrodes: boolean;
  leadAxes: boolean;
  projection: boolean;
  heart: boolean;
  sensitivity: boolean;
}
export type Tab = "scenarios" | "parameters" | "explain" | "lessons" | "ionic" | "events" | "validation" | "compare" | "about";
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
  heartLayers: HeartLayers;
  heartOpacity: number;
  activationDisplay: ActivationDisplay;
  highlight: Highlight | null;
  customLabel: string;
  probes: string[];
  customNode: number | null;
  baselineA: SimParams | null;
  compare: CompareResult | null;
  compareBusy: boolean;
  showCompare: boolean;
  inspectT: number | null;
  tab: Tab;
  theme: "dark" | "light";
  mode: Mode;
  maximized: string | null;
  present: boolean;
  explorerLeads: string[];
  torsoLayers: TorsoLayers;
  experimentId: string | null;
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
  heartLayers: {
    anatomy: true,
    pathways: true,
    activation: true,
    repolarization: true,
    refractory: false,
    vectors: false,
    mesh: false,
    labels: true,
    atria: true,
    ventricles: true,
  },
  heartOpacity: 0.62,
  activationDisplay: "live",
  highlight: null,
  customLabel: "Selected cell",
  probes: ["san", "ra", "avn", "his", "lvendo", "lvepi"],
  customNode: null,
  baselineA: null,
  compare: null,
  compareBusy: false,
  showCompare: false,
  inspectT: null,
  tab: "parameters",
  theme: "dark",
  mode: "simulator",
  maximized: null,
  present: false,
  explorerLeads: ["II"],
  torsoLayers: { torso: true, electrodes: true, leadAxes: true, projection: true, heart: true, sensitivity: false },
  experimentId: null,
  set: (p) => set(p),
}));

let changeId = 0;
export const nextChangeId = () => ++changeId;
