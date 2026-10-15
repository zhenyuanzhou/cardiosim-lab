import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { DEFAULT_PARAMS } from "../../src/simulation/core/params";
const m = buildCardiacModel();
const sim = new Simulator(m, DEFAULT_PARAMS);
const t1 = performance.now();
sim.run(5000);
console.log("run 5s ms", (performance.now() - t1).toFixed(0));
