/**
 * Drug ion-channel block from measured IC50 values.
 *
 * Potencies are the manual-patch-clamp IC50s of Crumb WJ, Vicente J, Johannesen L, Strauss DG,
 * "An evaluation of 30 clinical drugs against the comprehensive in vitro proarrhythmia assay
 * (CiPA) proposed ion channel panel", J Pharmacol Toxicol Methods 2016;81:251–262
 * (doi:10.1016/j.vascn.2016.03.009), Table 2, together with the free (unbound) therapeutic plasma
 * concentrations in that paper's Table 1.
 *
 * Block model: simple pore block, fraction blocked = C / (C + IC50) — i.e. the Hill equation with
 * a Hill coefficient of 1. Crumb et al. report IC50 but not Hill coefficients for these channels,
 * so h = 1 is an assumption, not a measurement, and it is stated as such in the scenario text.
 * State- and rate-dependent (use-dependent) block, trapping and kinetics are NOT represented;
 * this is the "conductance block" simplification that the CiPA effort itself moved away from.
 *
 * Entries marked `null` were above the highest concentration tested in the source (reported as
 * "> x µM"), and are treated here as no meaningful block at therapeutic exposure.
 *
 * Only channels that exist in this implementation of TP06 are listed. Notably there is NO late
 * sodium current in TP06, so drugs whose main CiPA action is late-INa block (ranolazine,
 * mexiletine) are deliberately absent rather than modelled misleadingly.
 */

export interface DrugBlock {
  id: string;
  name: string;
  /** Free (unbound) therapeutic plasma concentration, nM (Crumb 2016 Table 1). */
  freeCmax: number;
  /** IC50 in µM; null = above the highest concentration tested. */
  ic50: { hERG: number | null; caV12: number | null; naV15: number | null };
  /** CredibleMeds/CiPA torsade risk category, for the teaching text only. */
  tdpRisk: "high" | "intermediate" | "low";
  note: string;
}

export const DRUGS: DrugBlock[] = [
  {
    id: "dofetilide",
    name: "Dofetilide",
    freeCmax: 2.1,
    ic50: { hERG: 0.002, caV12: null, naV15: null },
    tdpRisk: "high",
    note: "Selective IKr blocker; class III. Known torsadogenic risk, dosed with QT monitoring.",
  },
  {
    id: "cisapride",
    name: "Cisapride",
    freeCmax: 2.6,
    ic50: { hERG: 0.01, caV12: null, naV15: null },
    tdpRisk: "high",
    note: "Prokinetic withdrawn from general use for QT prolongation and torsades.",
  },
  {
    id: "sotalol",
    name: "Sotalol",
    freeCmax: 14686.4,
    ic50: { hERG: 86.3, caV12: null, naV15: null },
    tdpRisk: "high",
    note: "IKr blocker with beta-blockade (the beta-blocking action is not modelled here).",
  },
  {
    id: "quinidine",
    name: "Quinidine",
    freeCmax: 842.9,
    ic50: { hERG: 0.3, caV12: null, naV15: null },
    tdpRisk: "high",
    note: "Class Ia: strong IKr block at therapeutic exposure plus sodium-channel block.",
  },
  {
    id: "bepridil",
    name: "Bepridil",
    freeCmax: 31.5,
    ic50: { hERG: 0.2, caV12: 2.8, naV15: 2.9 },
    tdpRisk: "high",
    note: "Multichannel blocker; IKr block dominates at therapeutic exposure.",
  },
  {
    id: "verapamil",
    name: "Verapamil",
    freeCmax: 45.0,
    ic50: { hERG: 0.7, caV12: 0.1, naV15: null },
    tdpRisk: "low",
    note: "Blocks IKr but also ICaL; the balanced block is the classic explanation for its low torsade risk despite hERG affinity.",
  },
  {
    id: "diltiazem",
    name: "Diltiazem",
    freeCmax: 127.5,
    ic50: { hERG: 6.6, caV12: 0.1, naV15: null },
    tdpRisk: "low",
    note: "Predominantly ICaL block. Its main clinical action is AV-nodal, which this model's lumped AV node does not derive from ionic currents.",
  },
  {
    id: "flecainide",
    name: "Flecainide",
    freeCmax: 752.9,
    ic50: { hERG: 0.7, caV12: null, naV15: 6.7 },
    tdpRisk: "intermediate",
    note: "Class Ic: sodium-channel block widens QRS. Use-dependence, which makes the real effect rate-dependent, is not modelled.",
  },
];

export const DRUG_BY_ID: Record<string, DrugBlock> = Object.fromEntries(DRUGS.map((d) => [d.id, d]));

/** Fraction of channels blocked at concentration `conc` (nM) for an IC50 in µM (Hill coefficient 1). */
export function blockFraction(ic50uM: number | null, concNm: number): number {
  if (ic50uM === null || !(ic50uM > 0)) return 0;
  const ic50nM = ic50uM * 1000;
  return concNm / (concNm + ic50nM);
}

/** Conductance multipliers for TP06 at a multiple of the free therapeutic concentration. */
export function drugMods(drug: DrugBlock, xCmax: number): { gKr: number; gCaL: number; gNa: number } {
  const c = drug.freeCmax * xCmax;
  return {
    gKr: 1 - blockFraction(drug.ic50.hERG, c),
    gCaL: 1 - blockFraction(drug.ic50.caV12, c),
    gNa: 1 - blockFraction(drug.ic50.naV15, c),
  };
}
