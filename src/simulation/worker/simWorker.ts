/// <reference lib="webworker" />
import { SimHost } from "./simHost";
import type { FromWorker, ToWorker } from "./protocol";

const host = new SimHost((m: FromWorker, transfer?: Transferable[]) => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer ?? []);
});
self.onmessage = (e: MessageEvent<ToWorker>) => host.handle(e.data);
