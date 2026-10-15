/**
 * Idealised cardiac anatomy (Phase 1).
 *
 * The heart is built analytically from truncated ellipsoids/spheres and voxelised on a
 * regular grid. It is NOT patient anatomy: it is a teaching geometry with plausible
 * dimensions and orientation, chosen so that activation sequence and lead geometry are
 * qualitatively correct. All dimensions are in millimetres.
 *
 * Torso coordinate system (used everywhere downstream):
 *   x → patient's left, y → inferior (feet), z → anterior.
 * The final model is translated so that the ventricular centroid is the origin.
 */
import { cross, dot, normalize, perp, scale, add, type Vec3 } from "../core/vec";

export const ANATOMY = {
  // Long axis: frontal-plane angle 45° (left-inferior) with 30° anterior tilt.
  axisFrontalDeg: 45,
  axisAnteriorDeg: 30,
  // Direction (torso coords, before projection ⟂ long axis) from LV centre to septum/RV.
  septalDir: [-0.9, -0.3, 0.4] as [number, number, number],
  // Left ventricle (truncated prolate ellipsoid; base plane at l = 0)
  lvOuterR: 29.5,
  lvOuterL: 82,
  lvInnerR: 19,
  lvInnerL: 77,
  // Right ventricle (crescent wrapped around the LV on the septal side)
  rvCenterA: 18,
  rvRa: 29,
  rvRb: 32,
  rvL: 68,
  rvWall: 3.5,
  // Atria (spherical shells above the AV plane, local coords l/a/b)
  ra: { l: -26, a: 20, b: -12, R: 22, wall: 3 },
  la: { l: -24, a: -14, b: -18, R: 21, wall: 3 },
  avGroove: 4, // mm of electrically inert AV ring between atria and ventricles
};

export interface Frame {
  base: Vec3; // base centre (torso coords, before recentring)
  d: Vec3; // long axis, base → apex
  u0: Vec3; // short-axis unit vector pointing to the septum / RV
  u1: Vec3; // short-axis unit vector, anterior-superior side
}

export function makeFrame(): Frame {
  const th = (ANATOMY.axisFrontalDeg * Math.PI) / 180;
  const el = (ANATOMY.axisAnteriorDeg * Math.PI) / 180;
  const d = normalize([Math.cos(th) * Math.cos(el), Math.sin(th) * Math.cos(el), Math.sin(el)]);
  // RV lies anterior and to the right of the LV.
  const u0 = normalize(perp(ANATOMY.septalDir, d));
  let u1 = normalize(cross(d, u0));
  // u1 should point anterior-superior (z up, y negative)
  if (u1[2] - u1[1] < 0) u1 = scale(u1, -1);
  return { base: [0, 0, 0], d, u0, u1 };
}

export const toLocal = (f: Frame, p: Vec3): [number, number, number] => {
  const r: Vec3 = [p[0] - f.base[0], p[1] - f.base[1], p[2] - f.base[2]];
  return [dot(r, f.d), dot(r, f.u0), dot(r, f.u1)];
};

export const fromLocal = (f: Frame, l: number, a: number, b: number): Vec3 =>
  add(add(add(f.base, scale(f.d, l)), scale(f.u0, a)), scale(f.u1, b));

/** Voxel classification codes. */
export const VX = {
  OUTSIDE: 0,
  LV_WALL: 1,
  RV_WALL: 2,
  LV_CAVITY: 3,
  RV_CAVITY: 4,
  RA_WALL: 5,
  LA_WALL: 6,
  ATRIAL_CAVITY: 7,
} as const;

export function classify(l: number, a: number, b: number): number {
  const A = ANATOMY;
  const lvo = l >= 0 && (a * a + b * b) / (A.lvOuterR * A.lvOuterR) + (l * l) / (A.lvOuterL * A.lvOuterL) <= 1;
  const lvi = (a * a + b * b) / (A.lvInnerR * A.lvInnerR) + (l * l) / (A.lvInnerL * A.lvInnerL) < 1;
  if (l >= 0) {
    if (lvo && !lvi) return VX.LV_WALL;
    if (lvo && lvi) return VX.LV_CAVITY;
    const da = a - A.rvCenterA;
    const rvo = (da * da) / (A.rvRa * A.rvRa) + (b * b) / (A.rvRb * A.rvRb) + (l * l) / (A.rvL * A.rvL) <= 1;
    const t = A.rvWall;
    const rvi =
      (da * da) / ((A.rvRa - t) * (A.rvRa - t)) +
        (b * b) / ((A.rvRb - t) * (A.rvRb - t)) +
        (l * l) / ((A.rvL - t) * (A.rvL - t)) <
      1;
    if (rvo && !rvi) return VX.RV_WALL;
    if (rvi) return VX.RV_CAVITY;
    return VX.OUTSIDE;
  }
  if (l > -A.avGroove) return VX.OUTSIDE;
  const s = (c: { l: number; a: number; b: number }) => (l - c.l) ** 2 + (a - c.a) ** 2 + (b - c.b) ** 2;
  const dRA = s(A.ra);
  const dLA = s(A.la);
  const inRAo = dRA <= A.ra.R ** 2;
  const inLAo = dLA <= A.la.R ** 2;
  const inRAi = dRA < (A.ra.R - A.ra.wall) ** 2;
  const inLAi = dLA < (A.la.R - A.la.wall) ** 2;
  if (inRAi || inLAi) return VX.ATRIAL_CAVITY;
  if (inRAo || inLAo) {
    // Assign the wall voxel to the nearer chamber (shared septum split by the radical plane)
    const pRA = dRA - A.ra.R ** 2;
    const pLA = dLA - A.la.R ** 2;
    return pRA <= pLA ? VX.RA_WALL : VX.LA_WALL;
  }
  return VX.OUTSIDE;
}

/** Point on the LV endocardial surface at level l (mm from base) and short-axis angle phi (rad, 0 = septum). */
export function lvEndoPoint(f: Frame, l: number, phi: number, inset = 0): Vec3 {
  const A = ANATOMY;
  const r = A.lvInnerR * Math.sqrt(Math.max(0, 1 - (l * l) / (A.lvInnerL * A.lvInnerL))) - inset;
  return fromLocal(f, l, r * Math.cos(phi), r * Math.sin(phi));
}

/** Radius of the LV epicardial (outer) surface at level l. */
export function lvOuterRadius(l: number): number {
  const A = ANATOMY;
  return A.lvOuterR * Math.sqrt(Math.max(0, 1 - (l * l) / (A.lvOuterL * A.lvOuterL)));
}
