import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { computeLeadField, N_COLS, precordialPositions } from "../../src/simulation/ecg-forward/leadField";
const m = buildCardiacModel();
const W = computeLeadField(m);
for (const z0 of [-20, 0, 20]) {
  const col = new Array(N_COLS).fill(0);
  for (let i = 0; i < m.n; i++) if (m.cellType[i] === 5 && m.pos[3 * i + 2] < z0) for (let c = 0; c < N_COLS; c++) col[c] += W[i * N_COLS + c] * 120;
  console.log("front at z=", z0, "(depolarized posterior part, wave moving anterior): Px,Py,Pz", col.slice(0, 3).map((v) => v.toFixed(2)).join(","), " V1..V6", col.slice(3).map((v) => v.toFixed(2)).join(","));
}
console.log(precordialPositions().map(p=>p.map(Math.round)));
