import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { buildSurfaces } from "../../src/simulation/tissue/surfaces";
const m = buildCardiacModel();
const t0 = performance.now();
const s = buildSurfaces(m);
console.log("ms", (performance.now() - t0).toFixed(0));
for (const x of s) console.log(x.name, "verts", x.positions.length / 3, "tris", x.indices.length / 3);
