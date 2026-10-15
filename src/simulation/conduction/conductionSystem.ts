/**
 * Specialised conduction system for the Phase-1 model:
 *   SA node (lumped) → atrial exit sites; crista terminalis and Bachmann's bundle
 *   (fast atrial pathways); AV node (lumped, directional, recovery-dependent);
 *   His bundle; right bundle branch with moderator band; left bundle branch with
 *   anterior, posterior and septal fascicles; subendocardial Purkinje networks grown
 *   from fascicle ends (greedy nearest-attachment tree) and coupled to the endocardium
 *   through Purkinje–muscle junctions (PMJs).
 *
 * Topology follows textbook anatomy and the early-activation sites described by
 * Durrer et al. (1970): left septal surface and paraseptal anterior/posterior LV
 * regions in the lower two-thirds; RV near the anterior papillary muscle; basal
 * regions activated last because the Purkinje network spares the base.
 */
import { ANATOMY, fromLocal, lvEndoPoint, lvOuterRadius, type Frame } from "../tissue/anatomy";
import { CT, EK, RG, type Region } from "../core/model";
import { add, dist, normalize, scale, sub, type Vec3 } from "../core/vec";
import { addEdge, addNode, nodePos, type Builder } from "../tissue/buildModel";

/** Purkinje-network coverage (fraction of base→apex distance below which no PMJs exist). */
export const CS_COVERAGE = { lvSeptumMinAB: 0.1, lvFreeMinAB: 0.1, rvMinAB: 0.12, spacing: 5 };

export interface ConductionSystem {
  san: number;
  avn: number;
  hisProximal: number;
  hisDistal: number;
  ventEscape: number;
  avnInputs: number[];
  paths: { region: Region; nodes: number[] }[];
}

export function buildConductionSystem(
  B: Builder,
  f: Frame,
  ctx: { endoLV: number[]; endoRV: number[]; nMyo: number },
): ConductionSystem {
  const A = ANATOMY;
  const nMyo = ctx.nMyo;
  const atrial: number[] = [];
  for (let i = 0; i < nMyo; i++) if (B.cellType[i] === CT.ATRIAL) atrial.push(i);

  const nearest = (list: number[], p: Vec3, pred: (i: number) => boolean = () => true): number => {
    let best = -1;
    let bd = Infinity;
    for (const i of list) {
      if (!pred(i)) continue;
      const d = dist(nodePos(B, i), p);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
  const within = (list: number[], p: Vec3, r: number, minCount = 3): number[] => {
    const scored = list.map((i) => [dist(nodePos(B, i), p), i] as [number, number]).sort((x, y) => x[0] - y[0]);
    const out = scored.filter(([d]) => d <= r).map(([, i]) => i);
    if (out.length < minCount) return scored.slice(0, minCount).map(([, i]) => i);
    return out;
  };
  const abOf = (p: Vec3) => {
    const r = sub(p, f.base);
    const l = r[0] * f.d[0] + r[1] * f.d[1] + r[2] * f.d[2];
    return Math.min(1, Math.max(0, l / A.lvOuterL));
  };
  const paths: { region: Region; nodes: number[] }[] = [];

  // ---- SA node --------------------------------------------------------------------
  const raC = fromLocal(f, A.ra.l, A.ra.a, A.ra.b);
  const laC = fromLocal(f, A.la.l, A.la.a, A.la.b);
  const isRA = (i: number) => B.region[i] !== RG.LA;
  const saSite = nearest(atrial, add(raC, scale(normalize([-0.35, -0.9, -0.25]), A.ra.R)), isRA);
  const saPos = nodePos(B, saSite);
  const san = addNode(B, saPos, CT.SAN, RG.SAN);
  for (const e of within(atrial, saPos, 5)) addEdge(B, san, e, EK.SAN_EXIT, 0);

  // ---- Fast atrial pathways ---------------------------------------------------------
  const markBand = (from: Vec3, to: Vec3, region: Region, centre: Vec3 | null, radius: number) => {
    const steps = 24;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      let p: Vec3 = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
      if (centre) p = add(centre, scale(normalize(sub(p, centre)), radius)); // follow the shell surface
      const c = nearest(atrial, p);
      if (c < 0 || dist(nodePos(B, c), p) > 12) continue;
      const cp = nodePos(B, c);
      for (const i of atrial) if (dist(nodePos(B, i), cp) <= 3.6 && B.region[i] !== RG.SAN) B.region[i] = region;
    }
  };
  const ctEnd = add(raC, scale(normalize([-0.5, 0.75, -0.45]), A.ra.R));
  markBand(saPos, ctEnd, RG.CRISTA, raC, A.ra.R - 1);
  const bbStart = add(raC, scale(normalize([0.1, -0.55, 0.85]), A.ra.R));
  const bbEnd = add(laC, scale(normalize([0.35, -0.6, 0.7]), A.la.R));
  markBand(bbStart, bbEnd, RG.BACHMANN, null, 0);
  const fast = (i: number) => B.region[i] === RG.CRISTA || B.region[i] === RG.BACHMANN;
  for (let e = 0; e < B.edges.length / 3; e++) {
    if (B.edges[3 * e + 2] !== EK.ATRIAL) continue;
    if (fast(B.edges[3 * e]) && fast(B.edges[3 * e + 1])) B.edges[3 * e + 2] = EK.ATRIAL_FAST;
  }

  // ---- AV node (Koch's triangle: RA side of the inferior interatrial septum) ----------
  const kochTarget = fromLocal(f, -7, 6, -16);
  const avnSite = nearest(atrial, kochTarget, isRA);
  const avnSitePos = nodePos(B, avnSite);
  const avnPos = add(avnSitePos, scale(f.d, 3));
  const avn = addNode(B, avnPos, CT.AVN, RG.AVN, abOf(avnPos));
  const avnInputs = within(atrial, avnSitePos, 5).filter(isRA);
  for (const i of avnInputs) addEdge(B, i, avn, EK.AVN_IN, 0);

  // ---- helper to lay a polyline of conduction nodes --------------------------------
  const layPath = (pts: Vec3[], cellType: number, region: Region, kind: number, startNode: number, spacing = 2): number[] => {
    const nodes: number[] = [];
    let prev = startNode;
    let prevPos = startNode >= 0 ? nodePos(B, startNode) : pts[0];
    const dense: Vec3[] = [];
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s];
      const b = pts[s + 1];
      const L = dist(a, b);
      const k = Math.max(1, Math.round(L / spacing));
      for (let q = s === 0 ? 1 : 1; q <= k; q++) {
        const t = q / k;
        dense.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    for (const p of dense) {
      const id = addNode(B, p, cellType, region, abOf(p));
      if (prev >= 0) addEdge(B, prev, id, kind, dist(prevPos, p));
      nodes.push(id);
      prev = id;
      prevPos = p;
    }
    return nodes;
  };

  // ---- His bundle ---------------------------------------------------------------------
  const midSeptA = (l: number) => lvOuterRadius(l) - (A.lvOuterR - A.lvInnerR) / 2;
  const crest = fromLocal(f, 4, midSeptA(4), -3);
  const hisEnd = fromLocal(f, 12, midSeptA(12), 0);
  const his = layPath([avnPos, crest, hisEnd], CT.HIS, RG.HIS, EK.HIS, -1);
  // connect AVN → first His node with the AV-nodal output edge (delay computed dynamically)
  addEdge(B, avn, his[0], EK.AVN_OUT);
  paths.push({ region: RG.HIS, nodes: [avn, ...his] });
  const hisProximal = his[0];
  const hisDistal = his[his.length - 1];

  // ---- Left bundle branch and fascicles ------------------------------------------------
  const Li = A.lvInnerL;
  const L0 = lvEndoPoint(f, 16, 0, 0.5);
  const lbb = layPath([hisEnd, L0], CT.PURKINJE, RG.LBB, EK.LBB, hisDistal);
  paths.push({ region: RG.LBB, nodes: [hisDistal, ...lbb] });
  const lbbEnd = lbb[lbb.length - 1];
  const arc = (l1: number, phi1: number, n = 14): Vec3[] => {
    const pts: Vec3[] = [];
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      pts.push(lvEndoPoint(f, 16 + (l1 - 16) * t, phi1 * t, 0.5));
    }
    return pts;
  };
  const deg = Math.PI / 180;
  const laf = layPath(arc(0.55 * Li, 105 * deg), CT.PURKINJE, RG.LAF, EK.LAF, lbbEnd);
  const lpf = layPath(arc(0.6 * Li, -110 * deg), CT.PURKINJE, RG.LPF, EK.LPF, lbbEnd);
  const lsf = layPath(arc(0.5 * Li, 8 * deg, 8), CT.PURKINJE, RG.LSF, EK.LSF, lbbEnd);
  paths.push({ region: RG.LAF, nodes: [lbbEnd, ...laf] });
  paths.push({ region: RG.LPF, nodes: [lbbEnd, ...lpf] });
  paths.push({ region: RG.LSF, nodes: [lbbEnd, ...lsf] });

  // ---- Right bundle branch and moderator band -----------------------------------------
  const rvSeptA = (l: number) => lvOuterRadius(l) + 1.5;
  const R0 = fromLocal(f, 18, rvSeptA(18), 2);
  const lR1 = 0.52 * A.rvL;
  const R1 = fromLocal(f, lR1, rvSeptA(lR1), 6);
  const lR2 = 0.56 * A.rvL;
  const t = A.rvWall;
  const k2 = Math.sqrt(Math.max(0, 1 - (lR2 * lR2) / ((A.rvL - t) * (A.rvL - t))));
  const th = 25 * deg;
  const R2 = fromLocal(f, lR2, A.rvCenterA + (A.rvRa - t - 1) * k2 * Math.cos(th), (A.rvRb - t - 1) * k2 * Math.sin(th));
  const rbbSept = layPath([hisEnd, R0, R1], CT.PURKINJE, RG.RBB, EK.RBB, hisDistal);
  const rbbMb = layPath([R1, R2], CT.PURKINJE, RG.RBB, EK.RBB, rbbSept[rbbSept.length - 1]);
  paths.push({ region: RG.RBB, nodes: [hisDistal, ...rbbSept, ...rbbMb] });

  // ---- Purkinje networks ---------------------------------------------------------------
  const sample = (cands: number[], spacing: number): number[] => {
    const acc: number[] = [];
    const accPos: Vec3[] = [];
    for (const c of cands) {
      const p = nodePos(B, c);
      let ok = true;
      for (const q of accPos) if (dist(p, q) < spacing) {
        ok = false;
        break;
      }
      if (ok) {
        acc.push(c);
        accPos.push(p);
      }
    }
    return acc;
  };
  const grow = (roots: number[], cands: number[], region: Region): number[] => {
    const treePos: Vec3[] = roots.map((r) => nodePos(B, r));
    const treeId: number[] = [...roots];
    const best = new Float64Array(cands.length).fill(Infinity);
    const bestId = new Int32Array(cands.length).fill(-1);
    const used = new Uint8Array(cands.length);
    const update = (tp: Vec3, tid: number) => {
      for (let c = 0; c < cands.length; c++) {
        if (used[c]) continue;
        const d = dist(nodePos(B, cands[c]), tp);
        if (d < best[c]) {
          best[c] = d;
          bestId[c] = tid;
        }
      }
    };
    for (let r = 0; r < treeId.length; r++) update(treePos[r], treeId[r]);
    const created: number[] = [];
    for (let it = 0; it < cands.length; it++) {
      let m = -1;
      for (let c = 0; c < cands.length; c++) if (!used[c] && (m < 0 || best[c] < best[m])) m = c;
      if (m < 0) break;
      used[m] = 1;
      const myo = cands[m];
      const p = nodePos(B, myo);
      const id = addNode(B, p, CT.PURKINJE, region, abOf(p));
      addEdge(B, bestId[m], id, EK.PURKINJE);
      addEdge(B, id, myo, EK.PMJ, 0);
      paths.push({ region, nodes: [bestId[m], id] });
      created.push(id);
      update(p, id);
    }
    return created;
  };
  const distalHalf = (arr: number[]) => arr.slice(Math.floor(arr.length / 2));
  const lvCands = sample(
    ctx.endoLV.filter((i) => B.apicobasal[i] >= (B.region[i] === RG.SEPTUM ? CS_COVERAGE.lvSeptumMinAB : CS_COVERAGE.lvFreeMinAB)),
    5,
  );
  grow([...distalHalf(laf), ...distalHalf(lpf), ...distalHalf(lsf)], lvCands, RG.PURK_LV);
  const rvCands = sample(
    ctx.endoRV.filter((i) => B.apicobasal[i] >= CS_COVERAGE.rvMinAB),
    5,
  );
  // RBB is an unbranched cord until the moderator band: the RV network arises from its distal end only
  grow([...rbbSept.slice(-2), ...rbbMb.slice(-3)], rvCands, RG.PURK_RV);

  return {
    san,
    avn,
    hisProximal,
    hisDistal,
    ventEscape: lpf[lpf.length - 1],
    avnInputs,
    paths,
  };
}
