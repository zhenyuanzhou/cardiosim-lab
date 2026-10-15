/**
 * Builds the complete Phase-1 cardiac model: voxelised atrial and ventricular myocardium,
 * fibre field, transmural/apicobasal coordinates, the specialised conduction system and
 * lumped SA/AV nodes. The result is immutable; parameter-dependent quantities (delays,
 * APDs) are derived separately in `derive.ts` so that geometry is built once.
 */
import { ANATOMY, VX, classify, fromLocal, makeFrame, toLocal } from "./anatomy";
import { CT, EK, RG, type CardiacModel, type Probe, type Region } from "../core/model";
import { cross, dist, normalize, scale, add, sub, type Vec3 } from "../core/vec";
import { buildConductionSystem } from "../conduction/conductionSystem";

export interface Builder {
  pos: number[];
  cellType: number[];
  region: number[];
  transmural: number[];
  apicobasal: number[];
  fiber: number[];
  edges: number[]; // i, j, kind triples (undirected)
  edgeLen: number[];
}

export function addNode(B: Builder, p: Vec3, cellType: number, region: number, ab = 0): number {
  const id = B.cellType.length;
  B.pos.push(p[0], p[1], p[2]);
  B.cellType.push(cellType);
  B.region.push(region);
  B.transmural.push(0);
  B.apicobasal.push(ab);
  B.fiber.push(0, 0, 0);
  return id;
}

export function addEdge(B: Builder, i: number, j: number, kind: number, len?: number): void {
  if (i === j) return;
  B.edges.push(i, j, kind);
  if (len === undefined) {
    const dx = B.pos[3 * i] - B.pos[3 * j];
    const dy = B.pos[3 * i + 1] - B.pos[3 * j + 1];
    const dz = B.pos[3 * i + 2] - B.pos[3 * j + 2];
    len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  B.edgeLen.push(len);
}

export const nodePos = (B: Builder, i: number): Vec3 => [B.pos[3 * i], B.pos[3 * i + 1], B.pos[3 * i + 2]];

const cache = new Map<number, CardiacModel>();

export function buildCardiacModel(h = 2.5): CardiacModel {
  const hit = cache.get(h);
  if (hit) return hit;
  const f = makeFrame();
  const A = ANATOMY;

  // ---- 1. Bounding box of the anatomy in torso coordinates ------------------
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const l of [-55, A.lvOuterL + 2])
    for (const a of [-45, A.rvCenterA + A.rvRa + 2])
      for (const b of [-50, 50]) {
        const p = fromLocal(f, l, a, b);
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p[k]);
          hi[k] = Math.max(hi[k], p[k]);
        }
      }
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1;
  const ny = Math.ceil((hi[1] - lo[1]) / h) + 1;
  const nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const nvox = nx * ny * nz;
  const vclass = new Uint8Array(nvox);
  const vl = new Float32Array(nvox);
  const vnode = new Int32Array(nvox).fill(-1);
  const idx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  const B: Builder = { pos: [], cellType: [], region: [], transmural: [], apicobasal: [], fiber: [], edges: [], edgeLen: [] };

  // ---- 2. Voxel classification and node creation ----------------------------
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const p: Vec3 = [lo[0] + i * h, lo[1] + j * h, lo[2] + k * h];
        const [l, a, b] = toLocal(f, p);
        const c = classify(l, a, b);
        const v = idx(i, j, k);
        vclass[v] = c;
        vl[v] = l;
        if (c === VX.LV_WALL || c === VX.RV_WALL) {
          let region: Region = c === VX.LV_WALL ? RG.LV : RG.RV;
          if (c === VX.LV_WALL) {
            // Septum: LV wall facing the RV (short-axis angle within ±55° of the septal direction)
            const phi = Math.atan2(b, a);
            const da = a - A.rvCenterA;
            const inRvOuter = (da * da) / (A.rvRa * A.rvRa) + (b * b) / (A.rvRb * A.rvRb) + (l * l) / (A.rvL * A.rvL) <= 1;
            if (inRvOuter && Math.abs(phi) < (55 * Math.PI) / 180) region = RG.SEPTUM;
          }
          vnode[v] = addNode(B, p, CT.VENTRICULAR, region, Math.min(1, Math.max(0, l / A.lvOuterL)));
        } else if (c === VX.RA_WALL || c === VX.LA_WALL) {
          vnode[v] = addNode(B, p, CT.ATRIAL, c === VX.RA_WALL ? RG.RA : RG.LA);
        }
      }
  const nMyo = B.cellType.length;

  // ---- 3. Myocardial edges (26-neighbourhood for propagation, 6 for lead field) --
  const lfI: number[] = [];
  const lfJ: number[] = [];
  const offsets: [number, number, number][] = [];
  for (let dk = -1; dk <= 1; dk++)
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        // only "forward" half so each undirected edge appears once
        if (dk > 0 || (dk === 0 && (dj > 0 || (dj === 0 && di > 0)))) offsets.push([di, dj, dk]);
      }
  const isVent = (c: number) => c === VX.LV_WALL || c === VX.RV_WALL;
  const isAtr = (c: number) => c === VX.RA_WALL || c === VX.LA_WALL;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v = idx(i, j, k);
        const n0 = vnode[v];
        if (n0 < 0) continue;
        const c0 = vclass[v];
        for (const [di, dj, dk] of offsets) {
          const ii = i + di;
          const jj = j + dj;
          const kk = k + dk;
          if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
          const w = idx(ii, jj, kk);
          const n1 = vnode[w];
          if (n1 < 0) continue;
          const c1 = vclass[w];
          const sameGroup = (isVent(c0) && isVent(c1)) || (isAtr(c0) && isAtr(c1));
          if (!sameGroup) continue; // atria and ventricles are electrically insulated
          const kind = isVent(c0) ? EK.VENT : EK.ATRIAL;
          addEdge(B, n0, n1, kind, h * Math.sqrt(di * di + dj * dj + dk * dk));
          if (Math.abs(di) + Math.abs(dj) + Math.abs(dk) === 1) {
            lfI.push(n0);
            lfJ.push(n1);
          }
        }
      }

  // ---- 4. Surfaces: endocardium (LV/RV) and epicardium ----------------------
  const endoLV: number[] = [];
  const endoRV: number[] = [];
  const isEndo = new Uint8Array(nMyo);
  const isEpi = new Uint8Array(nMyo);
  const face: [number, number, number][] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const v = idx(i, j, k);
        const n0 = vnode[v];
        if (n0 < 0 || !isVent(vclass[v])) continue;
        let lv = false;
        let rv = false;
        let epi = false;
        for (const [di, dj, dk] of face) {
          const w = idx(i + di, j + dj, k + dk);
          const c = vclass[w];
          if (c === VX.LV_CAVITY) lv = true;
          else if (c === VX.RV_CAVITY) rv = true;
          else if (c === VX.OUTSIDE && vl[w] >= 0.5 * h) epi = true;
        }
        if (lv) endoLV.push(n0);
        if (rv) endoRV.push(n0);
        if (lv || rv) isEndo[n0] = 1;
        if (epi) isEpi[n0] = 1;
      }

  // ---- 5. Transmural coordinate via graph distances ------------------------------
  const tmpAdj = buildCsr(nMyo, B.edges, B.edgeLen, (kind) => kind === EK.VENT);
  const dEndo = dijkstraMulti(nMyo, tmpAdj, isEndo);
  const dEpi = dijkstraMulti(nMyo, tmpAdj, isEpi);
  for (let n = 0; n < nMyo; n++) {
    if (B.cellType[n] !== CT.VENTRICULAR) continue;
    const a = dEndo[n];
    const b = dEpi[n];
    let e = 0.5;
    if (Number.isFinite(a) && Number.isFinite(b)) e = a + b > 0 ? a / (a + b) : 0.5;
    else if (Number.isFinite(a)) e = Math.min(1, a / 10); // septum without epicardium: endo-like
    B.transmural[n] = e;
  }

  // ---- 6. Fibre field: helix angle +60° (endo) → −60° (epi) ---------------------
  for (let n = 0; n < nMyo; n++) {
    if (B.cellType[n] !== CT.VENTRICULAR) continue;
    const p = nodePos(B, n);
    const [l, a, b] = toLocal(f, p);
    // radial direction from the relevant chamber axis
    const rvFree = B.region[n] === RG.RV;
    const ar = rvFree ? a - A.rvCenterA : a;
    const radial = normalize(add(scale(f.u0, ar), scale(f.u1, b)));
    void l;
    const circ = normalize(cross(f.d, radial));
    const alpha = ((60 - 120 * B.transmural[n]) * Math.PI) / 180;
    const fib = normalize(add(scale(circ, Math.cos(alpha)), scale(f.d, Math.sin(alpha))));
    B.fiber[3 * n] = fib[0];
    B.fiber[3 * n + 1] = fib[1];
    B.fiber[3 * n + 2] = fib[2];
  }

  // ---- 7. Conduction system, SA node, AV node --------------------------------------
  const cs = buildConductionSystem(B, f, { endoLV, endoRV, nMyo });

  // ---- 8. Recentre on the ventricular centroid ---------------------------------------
  let cx = 0,
    cy = 0,
    cz = 0,
    cnt = 0;
  for (let n = 0; n < nMyo; n++)
    if (B.cellType[n] === CT.VENTRICULAR) {
      cx += B.pos[3 * n];
      cy += B.pos[3 * n + 1];
      cz += B.pos[3 * n + 2];
      cnt++;
    }
  cx /= cnt;
  cy /= cnt;
  cz /= cnt;
  for (let n = 0; n < B.cellType.length; n++) {
    B.pos[3 * n] -= cx;
    B.pos[3 * n + 1] -= cy;
    B.pos[3 * n + 2] -= cz;
  }
  const shift: Vec3 = [cx, cy, cz];

  // ---- 9. Finalise -------------------------------------------------------------
  const n = B.cellType.length;
  const csr = buildCsr(n, B.edges, B.edgeLen, () => true);
  let nAtr = 0,
    nVen = 0;
  for (let i = 0; i < n; i++) {
    if (B.cellType[i] === CT.ATRIAL) nAtr++;
    else if (B.cellType[i] === CT.VENTRICULAR) nVen++;
  }

  const probes: Probe[] = makeProbes(B, f, shift, cs);

  const model: CardiacModel = {
    n,
    gridSpacing: h,
    pos: Float32Array.from(B.pos),
    cellType: Uint8Array.from(B.cellType),
    region: Uint8Array.from(B.region),
    transmural: Float32Array.from(B.transmural),
    apicobasal: Float32Array.from(B.apicobasal),
    fiber: Float32Array.from(B.fiber),
    adjStart: csr.start,
    adjNode: csr.node,
    adjLen: csr.len,
    adjKind: csr.kind,
    lfI: Int32Array.from(lfI),
    lfJ: Int32Array.from(lfJ),
    san: cs.san,
    avn: cs.avn,
    hisProximal: cs.hisProximal,
    hisDistal: cs.hisDistal,
    ventEscape: cs.ventEscape,
    avnAtrialInputs: Int32Array.from(cs.avnInputs),
    links: cs.links,
    ectopicSites: cs.ectopicSites,
    conductionPaths: cs.paths,
    probes,
    frame: { baseCenter: sub(f.base, shift), axis: f.d, septalDir: f.u0, anteriorDir: f.u1 },
    counts: { atrial: nAtr, ventricular: nVen, conduction: n - nAtr - nVen },
  };
  cache.set(h, model);
  return model;
}

interface Csr {
  start: Int32Array;
  node: Int32Array;
  len: Float32Array;
  kind: Uint8Array;
}

function buildCsr(n: number, edges: number[], lens: number[], keep: (kind: number) => boolean): Csr {
  const deg = new Int32Array(n + 1);
  const m = edges.length / 3;
  for (let e = 0; e < m; e++) {
    const i = edges[3 * e];
    const j = edges[3 * e + 1];
    if (i >= n || j >= n || !keep(edges[3 * e + 2])) continue;
    deg[i + 1]++;
    deg[j + 1]++;
  }
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const start = Int32Array.from(deg);
  const fill = Int32Array.from(deg);
  const total = start[n];
  const node = new Int32Array(total);
  const len = new Float32Array(total);
  const kind = new Uint8Array(total);
  for (let e = 0; e < m; e++) {
    const i = edges[3 * e];
    const j = edges[3 * e + 1];
    const k = edges[3 * e + 2];
    if (i >= n || j >= n || !keep(k)) continue;
    const L = lens[e];
    let p = fill[i]++;
    node[p] = j;
    len[p] = L;
    kind[p] = k;
    p = fill[j]++;
    node[p] = i;
    len[p] = L;
    kind[p] = k;
  }
  return { start, node, len, kind };
}

/** Multi-source Dijkstra on edge lengths (small graphs; simple binary heap). */
function dijkstraMulti(n: number, g: Csr, source: Uint8Array): Float64Array {
  const d = new Float64Array(n).fill(Infinity);
  const heap: [number, number][] = [];
  const push = (x: [number, number]) => {
    heap.push(x);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (let i = 0; i < n; i++)
    if (source[i]) {
      d[i] = 0;
      push([0, i]);
    }
  while (heap.length) {
    const [di, i] = pop();
    if (di > d[i]) continue;
    for (let p = g.start[i]; p < g.start[i + 1]; p++) {
      const j = g.node[p];
      const nd = di + g.len[p];
      if (nd < d[j]) {
        d[j] = nd;
        push([nd, j]);
      }
    }
  }
  return d;
}

function makeProbes(
  B: Builder,
  f: ReturnType<typeof makeFrame>,
  shift: Vec3,
  cs: ReturnType<typeof buildConductionSystem>,
): Probe[] {
  const nearest = (target: Vec3, pred: (i: number) => boolean): number => {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < B.cellType.length; i++) {
      if (!pred(i)) continue;
      const d = dist(nodePos(B, i), target);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
  const T = (p: Vec3): Vec3 => sub(p, shift); // anatomical (pre-shift) → model coords
  const A = ANATOMY;
  const ventAt = (l: number, phi: number, r: number, region: number) =>
    nearest(T(fromLocal(f, l, r * Math.cos(phi), r * Math.sin(phi))), (i) => B.cellType[i] === CT.VENTRICULAR && B.region[i] === region);
  const lvFreePhi = Math.PI; // lateral wall, opposite the septum
  const lMid = 0.5 * A.lvOuterL;
  const rEndo = A.lvInnerR * Math.sqrt(1 - (lMid * lMid) / (A.lvInnerL * A.lvInnerL)) + 1;
  const rEpi = A.lvOuterR * Math.sqrt(1 - (lMid * lMid) / (A.lvOuterL * A.lvOuterL)) - 1;
  const raLat = nearest(T(fromLocal(f, A.ra.l, A.ra.a + A.ra.R, A.ra.b)), (i) => B.cellType[i] === CT.ATRIAL && B.region[i] !== RG.LA);
  const laLat = nearest(T(fromLocal(f, A.la.l, A.la.a - A.la.R, A.la.b)), (i) => B.cellType[i] === CT.ATRIAL && B.region[i] === RG.LA);
  const lBase = 0.12 * A.lvOuterL;
  const rBaseEpi = A.lvOuterR * Math.sqrt(1 - (lBase * lBase) / (A.lvOuterL * A.lvOuterL)) - 1;
  const rvFree = nearest(T(fromLocal(f, 0.45 * A.rvL, A.rvCenterA + A.rvRa - 2, 0)), (i) => B.region[i] === RG.RV);
  return [
    { id: "san", label: "SA node", node: cs.san },
    { id: "ra", label: "RA (lateral wall)", node: raLat },
    { id: "la", label: "LA (lateral wall)", node: laLat },
    { id: "avn", label: "AV node", node: cs.avn },
    { id: "his", label: "His bundle (distal)", node: cs.hisDistal },
    { id: "purk", label: "LV Purkinje (post.)", node: cs.ventEscape },
    { id: "lvendo", label: "LV endo (lateral)", node: ventAt(lMid, lvFreePhi, rEndo, RG.LV) },
    { id: "lvepi", label: "LV epi (lateral)", node: ventAt(lMid, lvFreePhi, rEpi, RG.LV) },
    { id: "lvbase", label: "LV epi (lateral base)", node: ventAt(lBase, lvFreePhi, rBaseEpi, RG.LV) },
    { id: "septum", label: "Septum (LV side)", node: ventAt(lMid, 0, rEndo, RG.SEPTUM) },
    { id: "rv", label: "RV free wall", node: rvFree },
  ];
}
