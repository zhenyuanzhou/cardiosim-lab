/**
 * Serum calcium → ventricular repolarisation, from human data rather than from the ionic model.
 *
 * WHY NOT THE IONIC MODEL. In TP06 (and in ORd and Grandi) the action potential *lengthens* when
 * extracellular Ca²⁺ is raised, which is the opposite of the clinical QT–calcium relationship.
 * Measured in this implementation at CL 1000 ms, 30 beats (scripts/dev/cao.ts):
 *
 *     [Ca²⁺]o (mM)     1.0    1.5    2.0    2.5    3.0
 *     APD90 epi (ms)   255    283    306    324    337
 *     APD90 M   (ms)   301    351    393    426    451
 *     APD90 endo (ms)  245    274    299    317    331
 *
 * Bartolucci, Passini & Severi (Front Physiol 2020;11:314, doi:10.3389/fphys.2020.00314) show that
 * this inversion is a known defect of models whose L-type Ca²⁺ calcium-dependent inactivation (CDI)
 * sits in the saturated part of its sensitivity curve, and build a revised model (BPS2020) to fix
 * it. Re-implementing BPS2020 is out of scope here, so the *direction and size* of the tissue
 * effect are taken from human measurements instead, and the ionic model's disagreement is shown to
 * the user rather than hidden.
 *
 * HUMAN SLOPES (QT, not QTc unless stated; per 0.1 mmol/L **decrease** in serum calcium):
 *   +3.01 ms (95% CI 2.03–3.99)  total serum Ca²⁺, Mendelian randomisation, UK Biobank, n = 76 226
 *                                 Young et al. Circ Genom Precis Med 2021;14:e003231
 *                                 doi:10.1161/CIRCGEN.120.003231  ← used here (causal estimate)
 *   +2.23 ms                      total serum Ca²⁺, observational meta-analysis, n = 153 014
 *                                 (reported in the same paper)
 *   +8.55 ms (95% CI 2.13–14.97)  *ionised* Ca²⁺, QTc, incident haemodialysis, n = 330
 *                                 Kim et al. BMC Nephrol 2019;20:133 doi:10.1186/s12882-019-1282-5
 *
 * The slope used is therefore 30.1 ms per mmol/L of total serum calcium, applied as an additive
 * shift of the ventricular APD (QT ≈ APD + activation spread, so ΔQT ≈ ΔAPD).
 *
 * EXTRAPOLATION WARNING. All three slopes come from populations whose calcium lies in or near the
 * reference range, and the relationship is assumed linear. Applied to overt hypo- or
 * hypercalcaemia the model will understate the change: the ionised-calcium slope above is roughly
 * threefold steeper than the total-calcium slope, so the true effect at the extremes is probably
 * larger than this model shows. This is stated in the scenario text and in
 * docs/SCIENTIFIC_LIMITATIONS.md.
 */

/** Mid-reference-range total serum calcium (mmol/L); the model's baseline. */
export const CALCIUM_REFERENCE = 2.4;

/** ms of QT change per mmol/L **decrease** in total serum calcium (Young et al. 2021). */
export const CALCIUM_QT_SLOPE = 30.1;

/** 95 % CI of the slope, for display. */
export const CALCIUM_QT_SLOPE_CI: [number, number] = [20.3, 39.9];

/**
 * Additive ventricular APD shift (ms) for a serum total calcium concentration (mmol/L).
 * Negative = shorter APD (hypercalcaemia), positive = longer (hypocalcaemia).
 */
export function calciumApdShift(serumCalcium: number): number {
  return CALCIUM_QT_SLOPE * (CALCIUM_REFERENCE - serumCalcium);
}

/** True when the concentration is outside the range the slope was measured over. */
export function calciumOutOfRange(serumCalcium: number): boolean {
  return serumCalcium < 2.1 || serumCalcium > 2.7;
}

// ================================================================================================
// POTASSIUM
// ================================================================================================
/**
 * Extracellular potassium → tissue, in two parts.
 *
 * 1. FROM THE TP06 CELL MODEL (scripts/dev/k-table.ts; mean of epi/M/endo cells, CL 1000 ms, 30 beats,
 *    the same protocol as the other ionic scenarios): APD scale, conduction-velocity scale
 *    (√ dV/dt_max, cable theory), AP-amplitude scale and resting potential. Conduction is scaled in
 *    atria, His–Purkinje system and ventricles alike (all depend on the same Na⁺ availability), which
 *    is what lengthens PR and QRS and flattens the P wave; the amplitude scale also applies to atria
 *    (smaller P in hyperkalaemia, larger P in hypokalaemia — Marriott ch. 10).
 *
 * 2. CALIBRATED AP SHAPE. TP06 reproduces the *direction* of the phase-3 change (steeper with high K⁺
 *    as IKr and IK1 rise; slower with low K⁺), but mapped onto the tissue it changes the ECG hardly at
 *    all: at 8 mM the T wave grows ≈ 20 % and does not narrow, and at 3 mM no U wave appears
 *    (scripts/dev/k-try*.ts). The textbook morphology therefore needs a calibrated amplification:
 *      • phase-3 logistic width × (TP06 width ratio)^γ, γ = 3.6 above 5.4 mM and 2.4 below. At 7 mM
 *        this makes the V2–V4 T waves 1.35–1.6× taller and raises their slope/amplitude ratio (TS/A)
 *        by ≈ 10–25 % — short of the ≈ × 2 between 5.4 and 8 mM implied by the dialysis relation of
 *        Corsi et al. 2017 (Sci Rep 7:42492, r = 0.72; K ≈ 0.66·TS/A + 2.72), because in this tissue
 *        model the T-wave width is dominated by the spatial dispersion of repolarisation, which K⁺
 *        hardly changes in TP06;
 *      • plateau level and slope follow the TP06 fits directly (scripts/dev/ap-shape-fit.py);
 *      • below 5.4 mM a slow terminal repolarisation component (fraction f, midpoint delayed by d·APD,
 *        width 0.035·APD) is added. A U wave arises from small voltage differences between AP tails
 *        (Ritsema van Eck, Kors & van Herpen, Cardiovasc Res 2005;67:256), and TP06 shows the tail
 *        lengthening as K⁺ falls (APD90→97: 10 ms at 5.4, 14 ms at 3, 20 ms at 2.5 mM). Its size is
 *        calibrated so that at 3.0 mM the U wave exceeds the flattened T wave — the reversal Marriott
 *        calls the most characteristic hypokalaemic change — and it fuses with the T wave at milder
 *        levels. f = 0.45·s and d = 0.30·s with s = (5.4 − K)/(5.4 − 3.0), clamped to 0…1.
 *    The clinical correlation between serum K⁺ and T-wave features is weak (r ≤ 0.2 for T amplitude in
 *    routine ECGs, Kim et al. 2018 doi:10.1155/2018/3054316; hyperkalaemic changes in only ≈ 46 % of
 *    patients at 6–9.3 mmol/L), so no amplitude–concentration curve exists to fit; the calibration
 *    reproduces morphology, not a dose–response.
 */
export const POTASSIUM_REFERENCE = 5.4;
// K (mM): TP06 apdScale, cvScale, ampScale, vRest; phase-3 width (fraction of APD), plateau P0, plateau slope (TP06 fits)
const K_TABLE: [number, number, number, number, number, number, number, number][] = [
  [2.5, 1.06, 1.121, 1.215, -104.4, 0.0545, 1.1, 0.2295],
  [3.0, 1.044, 1.112, 1.168, -100.1, 0.047, 1.068, 0.2435],
  [3.5, 1.031, 1.094, 1.128, -96.5, 0.043, 1.044, 0.256],
  [4.0, 1.022, 1.062, 1.091, -93.2, 0.039, 1.02, 0.268],
  [4.5, 1.013, 1.045, 1.057, -90.3, 0.0355, 0.995, 0.279],
  [5.4, 1.0, 1.0, 1.0, -85.8, 0.032, 0.969, 0.289],
  [6.0, 0.993, 0.933, 0.962, -83.1, 0.0295, 0.95, 0.295],
  [7.0, 0.982, 0.802, 0.901, -79.2, 0.027, 0.92, 0.3035],
  [8.0, 0.971, 0.658, 0.852, -75.8, 0.024, 0.894, 0.3085],
  [9.0, 0.959, 0.534, 0.816, -72.7, 0.023, 0.87, 0.312],
];
const G_HYPER = 3.6;
const G_HYPO = 2.4;
export interface PotassiumEffect {
  apdScale: number;
  cvScale: number;
  ampScale: number;
  vRest: number;
  repolWidthScale: number;
  plateauScale: number;
  plateauSlopeScale: number;
  tailFrac: number;
  tailDelay: number;
  tailWidth: number;
}
export function potassiumEffect(k: number): PotassiumEffect {
  const K = Math.min(9, Math.max(2.5, k));
  let i = 0;
  while (i < K_TABLE.length - 2 && K > K_TABLE[i + 1][0]) i++;
  const a = K_TABLE[i];
  const b = K_TABLE[i + 1];
  const f = (K - a[0]) / (b[0] - a[0]);
  const L = (c: number) => a[c] + (b[c] - a[c]) * f;
  const ref = K_TABLE[5];
  const wRatio = L(5) / ref[5];
  const s = Math.min(1, Math.max(0, (POTASSIUM_REFERENCE - K) / (POTASSIUM_REFERENCE - 3.0)));
  return {
    apdScale: L(1),
    cvScale: L(2),
    ampScale: L(3),
    vRest: L(4),
    repolWidthScale: Math.pow(wRatio, K >= POTASSIUM_REFERENCE ? G_HYPER : G_HYPO),
    plateauScale: L(6) / ref[6],
    plateauSlopeScale: L(7) / ref[7],
    tailFrac: 0.45 * s,
    tailDelay: 0.3 * s,
    tailWidth: 0.035,
  };
}
