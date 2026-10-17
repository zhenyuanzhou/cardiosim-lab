/**
 * Acute regional (supply) ischaemia: coronary territories and the action-potential changes inside them.
 *
 * Territories. The LV is divided into the AHA 17-segment model (Cerqueira et al., Circulation 2002;
 * 105:539) on the idealised anatomy: three levels along the long axis (basal, mid, apical thirds plus
 * an apical cap) and six (basal, mid) or four (apical) circumferential sectors measured from the
 * mid-septum. Each culprit lesion of Marriott's "seven culprit risk areas" (Practical
 * Electrocardiography, 13th ed., Table 8.2) is mapped to the segments it typically supplies, using the
 * standard AHA vessel assignment (LAD 1, 2, 7, 8, 13, 14, 17; RCA 3, 4, 9, 10, 15; LCx 5, 6, 11, 12, 16)
 * with the usual variants: diagonal branches take the anterolateral wall, a wrap-around mid/distal LAD
 * takes the whole apex, a dominant LCx gives the posterior descending artery (inferior wall), and a
 * proximal RCA lesion includes the right-ventricular free wall. Segment edges are soft (logistic,
 * ≈ 6° and ≈ 3 % of the long axis), which gives a narrow border zone.
 *
 * Action-potential change. Marriott ch. 6 (after ECGSIM): in acute ischaemia the AP (1) shortens,
 * (2) loses amplitude, and (3) depolarises late (slow conduction); leads facing the region then show,
 * respectively, a taller T wave, ST elevation and a more positive QRS — the Sclarovsky–Birnbaum grades
 * 1–3. The size of each change is taken from the TP06 cell model under the cellular conditions of
 * phase-1a ischaemia used in human-heart simulations (Ko 9.9 mM, INa and ICaL × 0.85; Mena-Tobar,
 * Ferrero & Rodríguez, CinC 2015) with the same mapping protocol as the other ionic scenarios
 * (scripts/dev/k-table.ts): APD × 0.895, AP amplitude × 0.781, conduction velocity × 0.448, resting
 * potential −85.8 → −70.3 mV. The APD change agrees with human monophasic APs during LAD balloon
 * occlusion (260 → 236 ms, × 0.91; Taggart et al., Circulation 1996). TP06 has no ATP-sensitive K⁺
 * current, which would shorten the APD further.
 */
import type { SimParams } from "./params";
import { CT, RG } from "./model";

export const CULPRITS = ["none", "lad-prox", "lad-diag", "lad-mid", "lcx-nondominant", "lcx-dominant", "rca-prox", "rca-distal"] as const;
export type Culprit = (typeof CULPRITS)[number];

export const CULPRIT_LABELS: Record<Culprit, string> = {
  none: "None",
  "lad-prox": "Proximal LAD",
  "lad-diag": "Main diagonal (LAD)",
  "lad-mid": "Mid-to-distal LAD (wrap-around)",
  "lcx-nondominant": "Non-dominant LCx",
  "lcx-dominant": "Dominant LCx",
  "rca-prox": "Proximal RCA (with RV branches)",
  "rca-distal": "Distal RCA",
};

/** AHA segments supplied by each culprit lesion, and whether the RV free wall is included. */
export const CULPRIT_TERRITORY: Record<Culprit, { segments: number[]; rv: boolean }> = {
  none: { segments: [], rv: false },
  "lad-prox": { segments: [1, 2, 6, 7, 8, 12, 13, 14, 17], rv: false },
  "lad-diag": { segments: [6, 12], rv: false },
  "lad-mid": { segments: [7, 13, 14, 15, 16, 17], rv: false },
  "lcx-nondominant": { segments: [5, 6, 11, 12], rv: false },
  "lcx-dominant": { segments: [3, 4, 5, 9, 10, 11, 15, 16], rv: false },
  "rca-prox": { segments: [3, 4, 9, 10, 15], rv: true },
  "rca-distal": { segments: [3, 4, 9, 10, 15], rv: false },
};

/**
 * AP changes at the centre of the ischaemic zone. APD, conduction and resting potential are the TP06
 * response to the phase-1a milieu (see header). The amplitude loss is CALIBRATED: TP06 gives × 0.781,
 * which produced only ≈ 0.6 of the ST elevation measured during 1-minute balloon occlusion in man;
 * × 0.655 makes the mean of the proximal and mid LAD maxima equal the measured LAD median of 0.26 mV
 * (Haeberlin et al., J Electrocardiol 2014;47:29, 19-lead ECG, n = 45). The RCA (0.20 mV, lead III) and
 * LCx (0.04 mV, V6) values of the same study are then independent checks (tests/physiology/ischaemia.test.ts).
 * TP06 lacks the ATP-sensitive K⁺ current, which lowers the plateau, so a larger loss is expected.
 */
export const ISCHAEMIC_AP = { apdScale: 0.895, ampScale: 0.655, ampScaleTP06: 0.781, cvScale: 0.448, restShift: 15.5 } as const;

export interface IschaemiaGeometry {
  n: number;
  pos: ArrayLike<number>;
  cellType: ArrayLike<number>;
  region: ArrayLike<number>;
  apicobasal: ArrayLike<number>;
  frame: { baseCenter: ArrayLike<number>; axis: ArrayLike<number>; septalDir: ArrayLike<number>; anteriorDir: ArrayLike<number> };
}

const sig = (x: number) => 1 / (1 + Math.exp(-x));
const window1 = (x: number, a: number, b: number, s: number) => sig((x - a) / s) - sig((x - b) / s);
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const ANG_S = 6; // degrees
const LEV_S = 0.03; // fraction of the long axis

/** Soft AHA-segment membership (index 1–17) of a point with long-axis fraction ab and angle phi. */
export function segmentWeights(ab: number, phi: number): Float64Array {
  const w = new Float64Array(18);
  const lv = [window1(ab, -10, 1 / 3, LEV_S), window1(ab, 1 / 3, 2 / 3, LEV_S), window1(ab, 2 / 3, 0.92, LEV_S), window1(ab, 0.92, 10, LEV_S)];
  const ring6 = [90, 30, -30, -90, -150, 150]; // segments 1–6 (basal) / 7–12 (mid)
  const ring4 = [90, 0, -90, 180]; // 13–16
  for (let k = 0; k < 6; k++) {
    const d = wrap(phi - ring6[k]);
    const a = window1(d, -30, 30, ANG_S);
    w[1 + k] = lv[0] * a;
    w[7 + k] = lv[1] * a;
  }
  for (let k = 0; k < 4; k++) w[13 + k] = lv[2] * window1(wrap(phi - ring4[k]), -45, 45, ANG_S);
  w[17] = lv[3];
  return w;
}

/** Long-axis fraction and circumferential angle (deg; 0 = mid-septum, +90 anterior, ±180 lateral, −90 inferior). */
export function lvCoordinates(g: IschaemiaGeometry, i: number): { ab: number; phi: number } {
  const F = g.frame;
  const r = [g.pos[3 * i] - F.baseCenter[0], g.pos[3 * i + 1] - F.baseCenter[1], g.pos[3 * i + 2] - F.baseCenter[2]];
  const a = r[0] * F.septalDir[0] + r[1] * F.septalDir[1] + r[2] * F.septalDir[2];
  const b = r[0] * F.anteriorDir[0] + r[1] * F.anteriorDir[1] + r[2] * F.anteriorDir[2];
  return { ab: g.apicobasal[i], phi: (Math.atan2(b, a) * 180) / Math.PI };
}

const cache = new WeakMap<object, Map<Culprit, Float32Array>>();
/** Ischaemic weight 0…1 of every node for a culprit lesion (ventricular myocardium only). */
export function ischaemiaField(g: IschaemiaGeometry, culprit: Culprit): Float32Array {
  let byC = cache.get(g.pos as object);
  if (!byC) cache.set(g.pos as object, (byC = new Map()));
  const hit = byC.get(culprit);
  if (hit) return hit;
  const out = new Float32Array(g.n);
  const T = CULPRIT_TERRITORY[culprit];
  if (T.segments.length || T.rv) {
    for (let i = 0; i < g.n; i++) {
      if (g.cellType[i] !== CT.VENTRICULAR) continue;
      if (g.region[i] === RG.RV) {
        out[i] = T.rv ? 1 : 0;
        continue;
      }
      const { ab, phi } = lvCoordinates(g, i);
      const w = segmentWeights(ab, phi);
      let m = 0;
      for (const s of T.segments) m += w[s];
      out[i] = Math.min(1, m);
    }
  }
  byC.set(culprit, out);
  return out;
}

/**
 * Per-node AP modifiers for the current parameters. grade 0 = off; 1 = APD shortening only (hyperacute T);
 * 2 = + loss of AP amplitude (ST elevation); 3 = + slow conduction (QRS distortion, "tombstoning").
 */
export function ischaemiaModifiers(g: IschaemiaGeometry, p: Pick<SimParams, "ischaemia">) {
  const n = g.n;
  const apd = new Float32Array(n).fill(1);
  const amp = new Float32Array(n).fill(1);
  const cv = new Float32Array(n).fill(1);
  const rest = new Float32Array(n);
  const { culprit, grade } = p.ischaemia;
  if (culprit === "none" || grade <= 0) return { field: null as Float32Array | null, apd, amp, cv, rest };
  const field = ischaemiaField(g, culprit);
  const A = ISCHAEMIC_AP;
  for (let i = 0; i < n; i++) {
    const m = field[i];
    if (m <= 0) continue;
    apd[i] = 1 + (A.apdScale - 1) * m;
    if (grade >= 2) {
      amp[i] = 1 + (A.ampScale - 1) * m;
      rest[i] = A.restShift * m;
    }
    if (grade >= 3) cv[i] = 1 + (A.cvScale - 1) * m;
  }
  return { field, apd, amp, cv, rest };
}
