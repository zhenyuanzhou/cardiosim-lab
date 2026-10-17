/**
 * ECG forward model (Layer D).
 *
 * Source model: the primary (impressed) current density J = −σi ∇Vm of the myocardium.
 *
 * 1) Chest electrodes (near field). Infinite, homogeneous, isotropic volume conductor:
 *        φ_e = (1 / 4πσ) ∫ J · (r_e − r') / |r_e − r'|³ dV'
 *            = −K ∫ ∇Vm · (r_e − r') / |r_e − r'|³ dV',      K = σi / (4πσ)
 *    This keeps the strong proximity effect that shapes V1–V6.
 *
 * 2) Limb electrodes (far field). The infinite-medium model badly distorts distant
 *    electrodes (no torso boundary), so RA/LA/LL use the classical lead-vector
 *    approximation: φ_k = c · (u_k · P), where P = ∫ J dV is the heart dipole and u_k are
 *    the Einthoven equilateral-triangle directions (frontal plane). This is the textbook
 *    hexaxial model; it ignores the non-dipolar content of limb potentials.
 *
 * Discretisation: ∇Vm is evaluated on face-neighbour edges of the voxel grid, so
 * ∫ ∇Vm·g dV ≈ h Σ_edges (Vm_j − Vm_i) (r_j − r_i)·g(midpoint). Because both models are
 * linear in Vm they collapse to per-node weights:  y_c(t) = Σ_i W_ic · (Vm_i(t) − Vrest_i),
 * with Σ_i W_ic = 0 (tissue at uniform potential produces no signal).
 *
 * Weight columns: [Px, Py, Pz, V1, V2, V3, V4, V5, V6].
 *
 * Approximations (docs/FIDELITY_MATRIX.md): no torso boundary, lungs, blood pool or
 * anisotropic conductivity; scalar torso transfer factors per electrode group; SA/AV
 * nodal and Purkinje mass ignored; point electrodes at idealised positions.
 *
 * Lead construction follows the standard electrode definitions, so Einthoven's law
 * (II = I + III) and aVR + aVL + aVF = 0 hold exactly by construction.
 */
import type { CardiacModel } from "../core/model";
import type { Vec3 } from "../core/vec";

/** σi/(4πσ) with σi ≈ 0.17 S/m (bulk intracellular) and σ ≈ 0.2 S/m (torso, order of magnitude). */
export const K_FORWARD = 0.17 / (4 * Math.PI * 0.2);
/** Effective distance (mm) used to scale the limb lead-vector model to infinite-medium units. */
export const LIMB_EFFECTIVE_DISTANCE = 150;

export const PRECORDIAL_NAMES = ["V1", "V2", "V3", "V4", "V5", "V6"] as const;
export const LEAD_NAMES = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"] as const;
export type LeadName = (typeof LEAD_NAMES)[number];
/** Additional chest leads: right-sided (mirror images of V3–V6) and posterior (V7–V9). */
export const EXTRA_LEAD_NAMES = ["V3R", "V4R", "V5R", "V6R", "V7", "V8", "V9"] as const;
/** Every lead the model computes, in channel order of the leads (12 standard, then the extra chest leads). */
export const ALL_LEAD_NAMES = [...LEAD_NAMES, ...EXTRA_LEAD_NAMES] as const;
/** Number of chest electrodes (6 standard + 7 extra). */
export const N_CHEST = 13;
/** Number of lead-field columns: dipole (3) + chest electrodes. */
export const N_COLS = 3 + N_CHEST;
export const N_LEADS = 12;
/**
 * Output channels per sample: [I … V6 (0–11), Px, Py, Pz (12–14), V3R … V9 (15–21)]. The heart
 * vector keeps its historical channels 12–14; the extra chest leads follow it.
 */
export const N_CHANNELS = 22;
/** Channel index of any lead name (standard or extra), −1 if unknown. */
export function channelOf(name: string): number {
  const i = LEAD_NAMES.indexOf(name as LeadName);
  if (i >= 0) return i;
  const j = EXTRA_LEAD_NAMES.indexOf(name as (typeof EXTRA_LEAD_NAMES)[number]);
  return j >= 0 ? 15 + j : -1;
}

/** Einthoven frontal-plane unit vectors (x → left, y → inferior). */
export const EINTHOVEN: Record<"RA" | "LA" | "LL", Vec3> = {
  RA: [-Math.sqrt(3) / 2, -0.5, 0],
  LA: [Math.sqrt(3) / 2, -0.5, 0],
  LL: [0, 1, 0],
};

/** Chest geometry (mm, model frame): elliptical cross-section and electrode levels. */
export const CHEST = {
  midlineX: -45, // sternal midline relative to the ventricular centroid (heart lies left of midline)
  centerZ: -40,
  halfWidth: 160,
  halfDepth: 125, // calibrated: precordial amplitudes (SCIENTIFIC_LIMITATIONS.md, "ECG amplitudes"); was 105
  ics4Y: -5, // 4th intercostal space level (V1, V2)
  ics5Y: 18, // 5th intercostal space level (V4–V6)
  sternalHalfWidth: 22,
  midclavicular: 90, // distance left of midline
  anteriorAxillary: 125,
};

/**
 * Chest electrode positions (mm) in the model frame (origin = ventricular centroid; x → left,
 * y → inferior, z → anterior). V1/V2 at the 4th intercostal space either side of the
 * sternum, V4 at the 5th intercostal space in the mid-clavicular line, V3 midway, V5 anterior
 * axillary and V6 mid-axillary lines at the level of V4 (standard placement).
 */
export function precordialPositions(): Vec3[] {
  const C = CHEST;
  const chest = (dxFromMidline: number, y: number): Vec3 => {
    const u = Math.min(1, Math.abs(dxFromMidline / C.halfWidth));
    return [C.midlineX + dxFromMidline, y, C.centerZ + C.halfDepth * Math.sqrt(1 - u * u)];
  };
  const v2 = chest(C.sternalHalfWidth, C.ics4Y);
  const v4 = chest(C.midclavicular, C.ics5Y);
  return [
    chest(-C.sternalHalfWidth, C.ics4Y),
    v2,
    chest((C.sternalHalfWidth + C.midclavicular) / 2, (C.ics4Y + C.ics5Y) / 2),
    v4,
    chest(C.anteriorAxillary, C.ics5Y),
    chest(C.halfWidth - 0.01, C.ics5Y),
  ];
}

/**
 * Right-sided and posterior electrodes (mm, model frame), at the level of V4–V6 (5th intercostal space):
 * V3R–V6R are the mirror images of V3–V6 across the sternal midline; V7 posterior axillary, V8
 * mid-scapular and V9 left paraspinal line on the back. The back positions are nominal points on the
 * idealised elliptical chest.
 */
export function extraChestPositions(): Vec3[] {
  const C = CHEST;
  const front = (dx: number, y: number): Vec3 => {
    const u = Math.min(1, Math.abs(dx / C.halfWidth));
    return [C.midlineX + dx, y, C.centerZ + C.halfDepth * Math.sqrt(1 - u * u)];
  };
  const back = (dx: number, y: number): Vec3 => {
    const u = Math.min(1, Math.abs(dx / C.halfWidth));
    return [C.midlineX + dx, y, C.centerZ - C.halfDepth * Math.sqrt(1 - u * u)];
  };
  const v3x = (C.sternalHalfWidth + C.midclavicular) / 2;
  const v3y = (C.ics4Y + C.ics5Y) / 2;
  return [
    front(-v3x, v3y), // V3R
    front(-C.midclavicular, C.ics5Y), // V4R
    front(-C.anteriorAxillary, C.ics5Y), // V5R
    front(-(C.halfWidth - 0.01), C.ics5Y), // V6R
    back(C.anteriorAxillary, C.ics5Y), // V7: posterior axillary line
    back(80, C.ics5Y), // V8: mid-scapular line
    back(30, C.ics5Y), // V9: left paraspinal line
  ];
}

/** All chest electrodes in column order: V1–V6, then V3R–V6R, V7–V9. */
export const allChestPositions = (): Vec3[] => [...precordialPositions(), ...extraChestPositions()];

/**
 * Lead-field weights, interleaved [node * N_COLS + column]. `chest` may hold the 6 standard
 * electrodes only (the extra ones are then appended at their default positions) or all 13.
 */
export function computeLeadField(model: CardiacModel, chestIn: Vec3[] = allChestPositions()): Float32Array {
  const chest = chestIn.length >= N_CHEST ? chestIn : [...chestIn, ...extraChestPositions()];
  const W = new Float64Array(model.n * N_COLS);
  const h = model.gridSpacing;
  const P = model.pos;
  const pScale = K_FORWARD / (LIMB_EFFECTIVE_DISTANCE * LIMB_EFFECTIVE_DISTANCE);
  for (let e = 0; e < model.lfI.length; e++) {
    const i = model.lfI[e];
    const j = model.lfJ[e];
    const dx = P[3 * j] - P[3 * i];
    const dy = P[3 * j + 1] - P[3 * i + 1];
    const dz = P[3 * j + 2] - P[3 * i + 2];
    // Dipole: P = −h Σ (Vm_j − Vm_i)(r_j − r_i)  (scaled to mV at the effective distance)
    const d = [dx, dy, dz];
    for (let c = 0; c < 3; c++) {
      const v = pScale * h * d[c];
      W[j * N_COLS + c] -= v;
      W[i * N_COLS + c] += v;
    }
    const mx = 0.5 * (P[3 * j] + P[3 * i]);
    const my = 0.5 * (P[3 * j + 1] + P[3 * i + 1]);
    const mz = 0.5 * (P[3 * j + 2] + P[3 * i + 2]);
    for (let k = 0; k < N_CHEST; k++) {
      const rx = chest[k][0] - mx;
      const ry = chest[k][1] - my;
      const rz = chest[k][2] - mz;
      const r2 = rx * rx + ry * ry + rz * rz;
      const inv3 = 1 / (r2 * Math.sqrt(r2));
      const c = K_FORWARD * h * (dx * rx + dy * ry + dz * rz) * inv3;
      // φ = −K h Σ (Vm_j − Vm_i)(Δr·g)  →  coefficient of Vm_j is −c, of Vm_i is +c
      W[j * N_COLS + 3 + k] -= c;
      W[i * N_COLS + 3 + k] += c;
    }
  }
  return Float32Array.from(W);
}

/**
 * Column sums (y = Σ W·x) → N_CHANNELS output channels. `col` holds [Px,Py,Pz,V1..V6,V3R..V9] (unscaled).
 * Writes [I, II, III, aVR, aVL, aVF, V1..V6, Px, Py, Pz, V3R..V6R, V7..V9] into `out` at offset `o`.
 */
export function columnsToChannels(col: ArrayLike<number>, limbGain: number, chestGain: number, out: Float32Array | number[], o = 0): void {
  const px = col[0] * limbGain;
  const py = col[1] * limbGain;
  const pz = col[2] * limbGain;
  const E = EINTHOVEN;
  const RA = E.RA[0] * px + E.RA[1] * py;
  const LA = E.LA[0] * px + E.LA[1] * py;
  const LL = E.LL[0] * px + E.LL[1] * py;
  const wct = (RA + LA + LL) / 3;
  out[o + 0] = LA - RA; // I
  out[o + 1] = LL - RA; // II
  out[o + 2] = LL - LA; // III
  out[o + 3] = RA - 0.5 * (LA + LL); // aVR (Goldberger)
  out[o + 4] = LA - 0.5 * (RA + LL); // aVL
  out[o + 5] = LL - 0.5 * (RA + LA); // aVF
  for (let k = 0; k < 6; k++) out[o + 6 + k] = col[3 + k] * chestGain - wct; // V1..V6 vs Wilson central terminal
  out[o + 12] = px;
  out[o + 13] = py;
  out[o + 14] = pz;
  for (let k = 6; k < N_CHEST; k++) out[o + 9 + k] = col[3 + k] * chestGain - wct; // V3R … V9 → channels 15–21
}
