/**
 * Smooth anatomical surfaces for visualisation (no influence on the simulation).
 *
 * The analytic anatomy (anatomy.ts) is sampled on a fine grid (default 1.5 mm), lightly
 * blurred and polygonised with naive surface nets, then Taubin-smoothed. Every vertex is
 * bound to its 4 nearest simulation cells (inverse-distance weights), so the colour of the
 * surface at any instant is interpolated from the SAME cell states that drive the ECG.
 */
import { VX, classify, makeFrame, toLocal } from "./anatomy";
import { CT, type CardiacModel } from "../core/model";
import type { Vec3 } from "../core/vec";

export interface SurfaceMesh {
  name: "ventricles" | "atria";
  positions: Float32Array;
  indices: Uint32Array;
  /** 4 nearest cells per vertex and their normalised weights. */
  vNodes: Int32Array;
  vWeights: Float32Array;
  vRegion: Uint8Array;
}

export function buildSurfaces(model: CardiacModel, h = 1.5): SurfaceMesh[] {
  const f = makeFrame();
  // model coords = torso coords − shift, and baseCenter(model) = 0 − shift
  const shift: Vec3 = [-model.frame.baseCenter[0], -model.frame.baseCenter[1], -model.frame.baseCenter[2]];
  const groups: { name: "ventricles" | "atria"; inside: (c: number) => boolean; ct: number }[] = [
    { name: "ventricles", inside: (c) => c === VX.LV_WALL || c === VX.RV_WALL, ct: CT.VENTRICULAR },
    { name: "atria", inside: (c) => c === VX.RA_WALL || c === VX.LA_WALL, ct: CT.ATRIAL },
  ];
  return groups.map((g) => buildOne(model, f, shift, g.name, g.inside, g.ct, h));
}

function buildOne(
  model: CardiacModel,
  f: ReturnType<typeof makeFrame>,
  shift: Vec3,
  name: "ventricles" | "atria",
  inside: (c: number) => boolean,
  cellType: number,
  h: number,
): SurfaceMesh {
  // bounding box from the group's simulation cells
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const nodes: number[] = [];
  for (let i = 0; i < model.n; i++) {
    if (model.cellType[i] !== cellType) continue;
    nodes.push(i);
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], model.pos[3 * i + k]);
      hi[k] = Math.max(hi[k], model.pos[3 * i + k]);
    }
  }
  for (let k = 0; k < 3; k++) {
    lo[k] -= 6;
    hi[k] += 6;
  }
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1;
  const ny = Math.ceil((hi[1] - lo[1]) / h) + 1;
  const nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const id = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  let field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const p: Vec3 = [lo[0] + i * h + shift[0], lo[1] + j * h + shift[1], lo[2] + k * h + shift[2]];
        const [l, a, b] = toLocal(f, p);
        field[id(i, j, k)] = inside(classify(l, a, b)) ? 1 : 0;
      }
  // separable [1 2 1]/4 blur along each axis
  for (const ax of [0, 1, 2]) {
    const out = new Float32Array(field.length);
    const stride = ax === 0 ? 1 : ax === 1 ? nx : nx * ny;
    const n = ax === 0 ? nx : ax === 1 ? ny : nz;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const c = id(i, j, k);
          const pos = ax === 0 ? i : ax === 1 ? j : k;
          const a = pos > 0 ? field[c - stride] : 0;
          const b = pos < n - 1 ? field[c + stride] : 0;
          out[c] = 0.25 * a + 0.5 * field[c] + 0.25 * b;
        }
    field = out;
  }
  const iso = 0.5;

  // ---- naive surface nets -----------------------------------------------------------
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i: number, j: number, k: number) => (k * (ny - 1) + j) * (nx - 1) + i;
  const verts: number[] = [];
  const cornerOff = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];
  const edges: [number, number][] = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const vals = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const o = cornerOff[c];
          vals[c] = field[id(i + o[0], j + o[1], k + o[2])];
          if (vals[c] > iso) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0,
          sy = 0,
          sz = 0,
          cnt = 0;
        for (const [a, b] of edges) {
          const ia = vals[a] > iso;
          const ib = vals[b] > iso;
          if (ia === ib) continue;
          const t = (iso - vals[a]) / (vals[b] - vals[a]);
          const oa = cornerOff[a];
          const ob = cornerOff[b];
          sx += oa[0] + (ob[0] - oa[0]) * t;
          sy += oa[1] + (ob[1] - oa[1]) * t;
          sz += oa[2] + (ob[2] - oa[2]) * t;
          cnt++;
        }
        cellVert[cid(i, j, k)] = verts.length / 3;
        verts.push(lo[0] + (i + sx / cnt) * h, lo[1] + (j + sy / cnt) * h, lo[2] + (k + sz / cnt) * h);
      }
  const tris: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) tris.push(a, c, b, a, d, c);
    else tris.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        // x-edge (i,j,k)-(i+1,j,k)
        const a = field[id(i, j, k)] > iso;
        const b = field[id(i + 1, j, k)] > iso;
        if (a !== b) quad(cellVert[cid(i, j - 1, k - 1)], cellVert[cid(i, j, k - 1)], cellVert[cid(i, j, k)], cellVert[cid(i, j - 1, k)], a);
      }
  for (let k = 1; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const a = field[id(i, j, k)] > iso;
        const b = field[id(i, j + 1, k)] > iso;
        if (a !== b) quad(cellVert[cid(i - 1, j, k - 1)], cellVert[cid(i - 1, j, k)], cellVert[cid(i, j, k)], cellVert[cid(i, j, k - 1)], a);
      }
  for (let k = 0; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const a = field[id(i, j, k)] > iso;
        const b = field[id(i, j, k + 1)] > iso;
        if (a !== b) quad(cellVert[cid(i - 1, j - 1, k)], cellVert[cid(i, j - 1, k)], cellVert[cid(i, j, k)], cellVert[cid(i - 1, j, k)], a);
      }

  // ---- Taubin smoothing ----------------------------------------------------------------
  const nv = verts.length / 3;
  const P = Float32Array.from(verts);
  const nbr: Set<number>[] = Array.from({ length: nv }, () => new Set<number>());
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
    nbr[a].add(b).add(c);
    nbr[b].add(a).add(c);
    nbr[c].add(a).add(b);
  }
  const lap = (factor: number) => {
    const Q = P.slice();
    for (let v = 0; v < nv; v++) {
      const s = nbr[v];
      if (!s.size) continue;
      let x = 0,
        y = 0,
        z = 0;
      for (const u of s) {
        x += Q[3 * u];
        y += Q[3 * u + 1];
        z += Q[3 * u + 2];
      }
      x /= s.size;
      y /= s.size;
      z /= s.size;
      P[3 * v] += factor * (x - Q[3 * v]);
      P[3 * v + 1] += factor * (y - Q[3 * v + 1]);
      P[3 * v + 2] += factor * (z - Q[3 * v + 2]);
    }
  };
  for (let it = 0; it < 4; it++) {
    lap(0.5);
    lap(-0.53);
  }

  // ---- bind vertices to simulation cells ------------------------------------------------
  const cell = 5;
  const hash = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const n of nodes) {
    const k = key(model.pos[3 * n], model.pos[3 * n + 1], model.pos[3 * n + 2]);
    const arr = hash.get(k);
    if (arr) arr.push(n);
    else hash.set(k, [n]);
  }
  const vNodes = new Int32Array(nv * 4);
  const vWeights = new Float32Array(nv * 4);
  const vRegion = new Uint8Array(nv);
  const best: [number, number][] = [];
  for (let v = 0; v < nv; v++) {
    const x = P[3 * v];
    const y = P[3 * v + 1];
    const z = P[3 * v + 2];
    best.length = 0;
    for (let r = 1; r <= 3 && best.length < 4; r++) {
      best.length = 0;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const cz = Math.floor(z / cell);
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++) {
            const arr = hash.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (!arr) continue;
            for (const n of arr) {
              const d = Math.hypot(model.pos[3 * n] - x, model.pos[3 * n + 1] - y, model.pos[3 * n + 2] - z);
              best.push([d, n]);
            }
          }
    }
    best.sort((p, q) => p[0] - q[0]);
    let wsum = 0;
    for (let q = 0; q < 4; q++) {
      const e = best[Math.min(q, best.length - 1)] ?? [1, nodes[0]];
      const w = 1 / (e[0] + 0.75);
      vNodes[4 * v + q] = e[1];
      vWeights[4 * v + q] = w;
      wsum += w;
    }
    for (let q = 0; q < 4; q++) vWeights[4 * v + q] /= wsum;
    vRegion[v] = model.region[vNodes[4 * v]];
  }
  return { name, positions: P, indices: Uint32Array.from(tris), vNodes, vWeights, vRegion };
}
