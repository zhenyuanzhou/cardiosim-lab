/** Runs TP06 pacing protocols off the main thread (falls back to the main thread if workers fail). */
import IonicWorker from "./ionicWorker?worker&inline";
import { pace, type PacedResult, type TP06Cell, type TP06Mods } from "./tp06";
import type { IonicRequest } from "./ionicWorker";

let worker: Worker | null = null;
let failed = false;
let nextId = 1;
const pending = new Map<number, (r: PacedResult) => void>();

function getWorker(): Worker | null {
  if (failed) return null;
  if (!worker) {
    try {
      worker = new IonicWorker();
      worker.onmessage = (e: MessageEvent<{ id: number; res: PacedResult }>) => {
        pending.get(e.data.id)?.(e.data.res);
        pending.delete(e.data.id);
      };
      worker.onerror = () => {
        failed = true;
      };
    } catch {
      failed = true;
      return null;
    }
  }
  return worker;
}

export function runPacing(cell: TP06Cell, mods: TP06Mods, cl: number, beats: number): Promise<PacedResult> {
  const w = getWorker();
  if (!w) return new Promise((ok) => setTimeout(() => ok(pace(cell, mods, cl, beats)), 0));
  const id = nextId++;
  const req: IonicRequest = { id, cell, mods, cl, beats };
  return new Promise((ok) => {
    pending.set(id, ok);
    w.postMessage(req);
  });
}
