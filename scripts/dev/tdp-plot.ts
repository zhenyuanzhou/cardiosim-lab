import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { run } from "../../tests/helpers/sim";
import { N_CHANNELS } from "../../src/simulation/ecg-forward/leadField";
import { writeFileSync } from "node:fs";
const r = run(SCENARIOS.find((x) => x.id === "tdp")!.apply!(), 20000);
const rows = ["t,I,II,III,aVR,aVL,aVF,V1,V2,V3,V4,V5,V6"];
for (let i = 0; i < r.out.ecg.length / N_CHANNELS; i++) { const t = i * r.sim.dt; if (t < 5000 || t >= 17000) continue;
  rows.push([(t - 5000).toFixed(0), ...Array.from({ length: 12 }, (_, c) => r.out.ecg[i * N_CHANNELS + c].toFixed(4))].join(",")); }
writeFileSync("/tmp/claude-0/tdp/final.csv", rows.join("\n"));
