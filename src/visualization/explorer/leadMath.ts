/**
 * Lead geometry for the ECG Vector & Lead Explorer.
 *
 * Limb leads: in this model RA/LA/LL potentials are Einthoven lead-vector projections of the
 * heart dipole P, so each limb lead is EXACTLY V = L · P with the constant lead vectors below
 * (hexaxial angles I 0°, II +60°, III +120°, aVR −150°, aVL −30°, aVF +90°).
 *
 * Precordial leads: computed with the volume-conductor (infinite-medium) lead field of the
 * distributed sources. They are NOT exact dipole projections. For teaching we fit an
 * "effective lead vector" L̂ by least squares (V ≈ L̂ · P) and report how much of the signal
 * the dipole approximation explains (R²); the remainder is non-dipolar (proximity) content.
 */
import { EINTHOVEN, LEAD_NAMES, N_CHANNELS, precordialPositions } from "../../simulation/ecg-forward/leadField";
import type { SimData } from "../../simulation/worker/client";
import type { Vec3 } from "../../simulation/core/vec";

export type LeadId = (typeof LEAD_NAMES)[number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const half = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const E = EINTHOVEN;

export const LIMB_LEAD_VECTORS: Record<string, Vec3> = {
  I: sub(E.LA, E.RA),
  II: sub(E.LL, E.RA),
  III: sub(E.LL, E.LA),
  aVR: sub(E.RA, half(E.LA, E.LL)),
  aVL: sub(E.LA, half(E.RA, E.LL)),
  aVF: sub(E.LL, half(E.RA, E.LA)),
};

export const LEAD_INFO: Record<string, { def: string; positive: string; angle?: number; kind: "bipolar" | "augmented" | "precordial" }> = {
  I: { def: "Φ_LA − Φ_RA", positive: "left arm", angle: 0, kind: "bipolar" },
  II: { def: "Φ_LL − Φ_RA", positive: "left leg", angle: 60, kind: "bipolar" },
  III: { def: "Φ_LL − Φ_LA", positive: "left leg", angle: 120, kind: "bipolar" },
  aVR: { def: "Φ_RA − ½(Φ_LA + Φ_LL)", positive: "right arm", angle: -150, kind: "augmented" },
  aVL: { def: "Φ_LA − ½(Φ_RA + Φ_LL)", positive: "left arm", angle: -30, kind: "augmented" },
  aVF: { def: "Φ_LL − ½(Φ_RA + Φ_LA)", positive: "left leg", angle: 90, kind: "augmented" },
  V1: { def: "Φ_V1 − WCT", positive: "4th ICS, right sternal border", kind: "precordial" },
  V2: { def: "Φ_V2 − WCT", positive: "4th ICS, left sternal border", kind: "precordial" },
  V3: { def: "Φ_V3 − WCT", positive: "midway V2–V4", kind: "precordial" },
  V4: { def: "Φ_V4 − WCT", positive: "5th ICS, mid-clavicular line", kind: "precordial" },
  V5: { def: "Φ_V5 − WCT", positive: "anterior axillary line, level of V4", kind: "precordial" },
  V6: { def: "Φ_V6 − WCT", positive: "mid-axillary line, level of V4", kind: "precordial" },
};

export const isLimb = (l: string) => l in LIMB_LEAD_VECTORS;
export const leadIndex = (l: string) => LEAD_NAMES.indexOf(l as LeadId);
export const PRECORDIAL_POS: Record<string, Vec3> = Object.fromEntries(precordialPositions().map((p, k) => [`V${k + 1}`, p]));

export const LEAD_COLORS: Record<string, string> = {
  I: "#e8a33d",
  II: "#ef6b5b",
  III: "#c77dff",
  aVR: "#6fb3c8",
  aVL: "#f2d16b",
  aVF: "#6cc08b",
  V1: "#ef6b5b",
  V2: "#e8a33d",
  V3: "#6cc08b",
  V4: "#6fb3c8",
  V5: "#f08c3a",
  V6: "#c77dff",
};

export interface LeadFit {
  vec: Vec3;
  r2: number;
}

const fitCache = new Map<string, { version: number; fit: LeadFit }>();

/** Effective lead vector of any lead from the retained data (exact for limb leads). */
export function leadVector(lead: string, data: SimData | null): LeadFit {
  if (isLimb(lead)) return { vec: LIMB_LEAD_VECTORS[lead], r2: 1 };
  if (!data) return { vec: [0, 0, 1], r2: 0 };
  const c = fitCache.get(lead);
  if (c && (c.version === data.version || data.version - c.version < 40)) return c.fit;
  const li = leadIndex(lead);
  const ns = data.sampleEnd - data.sampleOffset;
  const start = Math.max(0, ns - Math.round(8000 / data.dt));
  // normal equations (PᵀP) L = Pᵀ V
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const b = [0, 0, 0];
  let vv = 0;
  let vs = 0;
  let n = 0;
  for (let k = start; k < ns; k++) {
    const o = k * N_CHANNELS;
    const p = [data.ecg[o + 12], data.ecg[o + 13], data.ecg[o + 14]];
    const v = data.ecg[o + li];
    for (let i = 0; i < 3; i++) {
      b[i] += p[i] * v;
      for (let j = 0; j < 3; j++) A[3 * i + j] += p[i] * p[j];
    }
    vv += v * v;
    vs += v;
    n++;
  }
  const L = solve3(A, b);
  // R²
  let res = 0;
  for (let k = start; k < ns; k++) {
    const o = k * N_CHANNELS;
    const est = L[0] * data.ecg[o + 12] + L[1] * data.ecg[o + 13] + L[2] * data.ecg[o + 14];
    const d = data.ecg[o + li] - est;
    res += d * d;
  }
  const mean = n ? vs / n : 0;
  const tot = vv - n * mean * mean;
  const fit = { vec: L, r2: tot > 1e-9 ? Math.max(0, 1 - res / tot) : 0 };
  fitCache.set(lead, { version: data.version, fit });
  return fit;
}

function solve3(A: number[], b: number[]): Vec3 {
  const [a, bb, c, d, e, f, g, h, i] = A;
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return [0, 0, 0];
  const inv = [e * i - f * h, c * h - bb * i, bb * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, bb * g - a * h, a * e - bb * d].map((x) => x / det);
  return [inv[0] * b[0] + inv[1] * b[1] + inv[2] * b[2], inv[3] * b[0] + inv[4] * b[1] + inv[5] * b[2], inv[6] * b[0] + inv[7] * b[1] + inv[8] * b[2]];
}

export const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len3 = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** Heart vector P(t) (mV-equivalent, after the limb transfer factor). */
export const heartVector = (data: SimData, t: number): Vec3 => [data.at(t, 12), data.at(t, 13), data.at(t, 14)];

/** Frontal-plane angle (degrees, hexaxial convention: 0° = lead I, +90° = aVF) of a vector. */
export const frontalAngle = (v: Vec3) => (Math.atan2(v[1], v[0]) * 180) / Math.PI;
