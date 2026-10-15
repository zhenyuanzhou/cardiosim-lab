/** Writes docs/scenario-registry.json from the TypeScript registry: npx tsx scripts/export-registry.ts */
import { writeFileSync } from "node:fs";
import { registryJson } from "../src/simulation/scenarios/scenarios";
const rows = registryJson();
writeFileSync("docs/scenario-registry.json", JSON.stringify({ generated: new Date().toISOString(), statusClasses: ["validated", "incomplete", "partial", "placeholder", "unsupported"], scenarios: rows }, null, 2));
const c: Record<string, number> = {};
for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
console.log(c);
