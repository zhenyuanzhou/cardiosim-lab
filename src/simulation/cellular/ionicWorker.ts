/// <reference lib="webworker" />
import { pace, type TP06Cell, type TP06Mods } from "./tp06";

export interface IonicRequest {
  id: number;
  cell: TP06Cell;
  mods: TP06Mods;
  cl: number;
  beats: number;
}
self.onmessage = (e: MessageEvent<IonicRequest>) => {
  const r = e.data;
  const res = pace(r.cell, r.mods, r.cl, r.beats);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id: r.id, res }, [res.v.buffer]);
};
