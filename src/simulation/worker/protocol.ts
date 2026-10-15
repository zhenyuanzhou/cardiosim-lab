import type { SimParams } from "../core/params";
import type { SimOutput, WaveInfo } from "../core/engine";
import type { BeatMeasurement } from "../ecg-forward/measurements";
import type { SurfaceMesh } from "../tissue/surfaces";

/** Static model description sent once to the UI thread. */
export interface ModelMeta {
  n: number;
  pos: Float32Array;
  cellType: Uint8Array;
  region: Uint8Array;
  transmural: Float32Array;
  apicobasal: Float32Array;
  conductionPaths: { region: number; nodes: number[] }[];
  probes: { id: string; label: string; node: number }[];
  counts: { atrial: number; ventricular: number; conduction: number };
  san: number;
  avn: number;
  hisProximal: number;
  hisDistal: number;
  ventEscape: number;
  dt: number;
  frame: { axis: number[]; septalDir: number[]; anteriorDir: number[] };
}

export interface CompareRun {
  ecg: Float32Array;
  beats: BeatMeasurement[];
  recT: Float64Array;
  recNode: Int32Array;
  recApd: Float32Array;
  recWave: Int32Array;
  waves: WaveInfo[];
}

export type ToWorker =
  | { type: "init"; params: SimParams; dt: number }
  | { type: "extend"; until: number; epoch: number }
  | { type: "setParams"; params: SimParams; at: number; epoch: number }
  | { type: "restart"; params: SimParams; dt: number; epoch: number }
  | { type: "compare"; a: SimParams; b: SimParams; duration: number; requestId: number };

export type FromWorker =
  | { type: "ready"; meta: ModelMeta; buildMs: number }
  | { type: "surfaces"; surfaces: SurfaceMesh[]; ms: number }
  | { type: "chunk"; epoch: number; out: SimOutput; simTime: number; computeMs: number }
  | {
      type: "truncate";
      epoch: number;
      /** keep activation records with t ≤ keepRecordsUntil */
      keepRecordsUntil: number;
      /** keep samples with absolute index < keepSamplesBelow */
      keepSamplesBelow: number;
      waves: WaveInfo[];
    }
  | {
      type: "compareResult";
      requestId: number;
      dt: number;
      a: CompareRun;
      b: CompareRun;
    }
  | { type: "error"; message: string };
