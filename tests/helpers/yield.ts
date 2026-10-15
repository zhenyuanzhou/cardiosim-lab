import { beforeEach } from "vitest";
// Long synchronous simulations block the test worker; yielding a macrotask between tests lets
// Vitest's worker RPC heartbeats through (avoids spurious "Timeout calling onTaskUpdate").
beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 0));
});
