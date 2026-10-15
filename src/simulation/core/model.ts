import type { Vec3 } from "./vec";

/** Cell (action-potential) types. */
export const CT = {
  SAN: 0,
  ATRIAL: 1,
  AVN: 2,
  HIS: 3,
  PURKINJE: 4,
  VENTRICULAR: 5,
} as const;
export type CellType = (typeof CT)[keyof typeof CT];
export const CELL_TYPE_NAMES = ["SA node", "Atrial", "AV node", "His bundle", "Purkinje", "Ventricular"];

/** Anatomical regions (for colouring, selection, event logging). */
export const RG = {
  SAN: 0,
  RA: 1,
  LA: 2,
  CRISTA: 3,
  BACHMANN: 4,
  AVN: 5,
  HIS: 6,
  LBB: 7,
  RBB: 8,
  LAF: 9,
  LPF: 10,
  LSF: 11,
  PURK_LV: 12,
  PURK_RV: 13,
  LV: 14,
  SEPTUM: 15,
  RV: 16,
  ACCESSORY: 17,
  AVN_SLOW: 18,
} as const;
export type Region = (typeof RG)[keyof typeof RG];
export const REGION_NAMES = [
  "SA node",
  "Right atrium",
  "Left atrium",
  "Crista terminalis",
  "Bachmann's bundle",
  "AV node",
  "His bundle",
  "Left bundle branch",
  "Right bundle branch",
  "Left anterior fascicle",
  "Left posterior fascicle",
  "Left septal fascicle",
  "LV Purkinje network",
  "RV Purkinje network",
  "LV free wall",
  "Interventricular septum",
  "RV free wall",
  "Accessory pathway",
  "AV node slow pathway",
];

/** Edge kinds; each kind maps onto a conduction-velocity parameter. */
export const EK = {
  ATRIAL: 0,
  ATRIAL_FAST: 1,
  SAN_EXIT: 2,
  AVN_IN: 3,
  AVN_OUT: 4,
  HIS: 5,
  LBB: 6,
  RBB: 7,
  LAF: 8,
  LPF: 9,
  LSF: 10,
  PURKINJE: 11,
  PMJ: 12,
  VENT: 13,
} as const;

export interface CardiacModel {
  n: number;
  gridSpacing: number;
  pos: Float32Array; // 3n, torso coordinates (mm): x → patient left, y → inferior, z → anterior
  cellType: Uint8Array;
  region: Uint8Array;
  /** 0 = endocardium … 1 = epicardium (ventricular nodes); 0 elsewhere. */
  transmural: Float32Array;
  /** 0 = base … 1 = apex (ventricular & Purkinje nodes). */
  apicobasal: Float32Array;
  fiber: Float32Array; // 3n unit vectors (ventricular nodes), zeros elsewhere
  /** CSR adjacency (directed; every undirected edge is stored both ways). */
  adjStart: Int32Array;
  adjNode: Int32Array;
  adjLen: Float32Array; // geometric length, mm
  adjKind: Uint8Array;
  /** Face-neighbour myocardial edges (i<j) used by the lead-field (forward) model. */
  lfI: Int32Array;
  lfJ: Int32Array;
  /** Lumped special nodes. */
  san: number;
  avn: number;
  hisProximal: number;
  hisDistal: number;
  ventEscape: number;
  /** Nodes on the atrial side of the AV node (used for directional AV nodal conduction). */
  avnAtrialInputs: Int32Array;
  /** Polylines of the conduction system for drawing (node index lists). */
  conductionPaths: { region: Region; nodes: number[] }[];
  /** Representative nodes for the action-potential panel. */
  probes: Probe[];
  /**
   * Lumped directional links (AV node fast pathway = index 0, AV node slow pathway = 1,
   * accessory pathways ≥ 2). Each joins "upper" (atrial) nodes to "lower" nodes.
   */
  links: LumpedLink[];
  /** Named ectopic / pacing sites → node index. */
  ectopicSites: Record<string, number>;
  /** Named node sets for optional arrhythmia substrates (flutter anatomy, scar). */
  substrates: Record<string, Int32Array>;
  /** Frame used to build the anatomy. */
  frame: { baseCenter: Vec3; axis: Vec3; septalDir: Vec3; anteriorDir: Vec3 };
  counts: { atrial: number; ventricular: number; conduction: number };
}

export interface LumpedLink {
  id: string;
  label: string;
  node: number;
  upper: number[];
  lower: number[];
}

export interface Probe {
  id: string;
  label: string;
  node: number;
}
