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
