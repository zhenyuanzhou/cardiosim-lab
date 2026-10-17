/**
 * Scenario registry (machine-readable implementation status, spec §6).
 *
 * Status classes:
 *  - "validated":   all eight completeness criteria met, including an automated test
 *                   (tests/physiology/scenarios.test.ts) that checks the mechanism's signature.
 *  - "incomplete":  mechanism implemented and tested, but an expected ECG/AP feature is not
 *                   reproduced faithfully (documented in `limitations`).
 *  - "partial":     only part of the mechanism is simulated (e.g. a reduced-order proxy).
 *  - "placeholder": listed, no model behind it (none at present — kept for completeness).
 *  - "unsupported": requires model capabilities that do not exist yet; NOT runnable, so no
 *                   misleading waveform is ever shown. No scenario is in this class at present —
 *                   the class is kept so that a future mechanism can be refused honestly again.
 *
 * Every runnable scenario is a parameter set applied to the default model — no waveform is
 * stored anywhere. `apply` always starts from DEFAULT_PARAMS so scenarios are reproducible.
 */
import { DEFAULT_PARAMS, cloneParams, type SimParams } from "../core/params";
import { CALCIUM_REFERENCE, calciumApdShift, potassiumEffect } from "../cellular/electrolytes";
import { CULPRIT_LABELS, CULPRIT_TERRITORY, type Culprit } from "../core/ischaemia";
import { DRUG_BY_ID, drugMods } from "../cellular/drugs";

export type ScenarioStatus = "validated" | "incomplete" | "partial" | "placeholder" | "unsupported";
export type ModelClass = "mechanistic" | "reduced-order" | "illustration" | "none";

/** The eight completeness criteria of spec §6 (true = met). */
export interface Criteria {
  mechanism: boolean;
  initialization: boolean;
  activationSequence: boolean;
  ecg: boolean;
  actionPotential: boolean;
  explanation: boolean;
  validation: boolean;
  ui: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  group: "Baseline" | "A · Brady/conduction" | "B · Premature beats" | "C · Supraventricular" | "D · Ventricular" | "E · Ionic/drug" | "F · Ischaemia (culprit vessel)" | "Conduction (BBB)";
  status: ScenarioStatus;
  modelClass: ModelClass;
  criteria: Criteria;
  mechanism: string;
  structures: string;
  changes: string;
  activation: string;
  ecg: string;
  initiation: string;
  limitations: string;
  /** How the scenario is validated (test name or reason it is not). */
  validation: string;
  /** Suggested leads to inspect. */
  leads: string[];
  /** Chest leads to show in the 12-lead layout when the scenario is loaded (default: standard). */
  chestSet?: "standard" | "right" | "posterior";
  apply?: () => SimParams;
}

const ALL: Criteria = { mechanism: true, initialization: true, activationSequence: true, ecg: true, actionPotential: true, explanation: true, validation: true, ui: true };
const P = (f?: (p: SimParams) => void) => () => {
  const p = cloneParams(DEFAULT_PARAMS);
  f?.(p);
  return p;
};
const T = (name: string) => `Automated test: "${name}" (tests/physiology/scenarios.test.ts).`;

/**
 * Coupling interval of an EAD-triggered beat (ms after the action-potential upstroke), measured in
 * this implementation of TP06 with the Vandersickel 2014 EAD configuration at CL 1000 ms
 * (scripts/dev/ead-timing.ts: secondary takeoff at 393 ms from −9 mV). The DAD-triggered upstroke
 * under calcium overload with an RyR leak was measured at 403 ms at CL 600 ms.
 */
export const EAD_COUPLING = 390;
export const DAD_COUPLING = 403;

// (Every scenario in the registry is now runnable; the "unsupported" helper was removed in v1.2.0.)


/**
 * TP06 → tissue mappings (APD scale, CV scale), derived by pacing TP06 epi/M/endo cells at
 * CL 1000 ms for 30 beats (src/simulation/cellular/ionicMapping.ts; checked by
 * tests/physiology/ionic.test.ts, which recomputes them from the cell model).
 */
export const TP06_MAPPED: Record<string, { mods: Record<string, number>; apdScale: number; cvScale: number }> = {
  ikr50: { mods: { gKr: 0.5 }, apdScale: 1.085, cvScale: 1.0 },
  ikr90: { mods: { gKr: 0.1 }, apdScale: 1.173, cvScale: 1.0 },
  ikr200: { mods: { gKr: 2 }, apdScale: 0.872, cvScale: 1.0 },
  na50: { mods: { gNa: 0.5 }, apdScale: 1.004, cvScale: 0.785 },
  cal50: { mods: { gCaL: 0.5 }, apdScale: 0.771, cvScale: 1.011 },
};

function ionic(id: string, name: string, change: string, key: string, mechanism: string, ecg: string, limits: string): Scenario {
  const m = TP06_MAPPED[key];
  return {
    id,
    name,
    group: "E · Ionic/drug",
    status: "partial",
    modelClass: "reduced-order",
    criteria: { ...ALL, mechanism: false },
    mechanism: `${mechanism} Simulated with the TP06 ionic cell model (Ionic cell tab); the tissue receives APD × ${m.apdScale} and ventricular CV × ${m.cvScale}.`,
    structures: "Ventricular myocytes (ionic model) → ventricular tissue (reduced-order).",
    changes: `${change} in TP06; tissue: ventricular APD and gradients × ${m.apdScale}, longitudinal CV × ${m.cvScale}.`,
    activation: m.cvScale < 0.95 ? "Slower ventricular activation." : "Unchanged activation sequence.",
    ecg,
    initiation: "Immediate.",
    limitations: `Partial: ionic currents act in single cells only; tissue sees scaled APD/CV. ${limits}`,
    validation: T(`TP06 mapping ${key}`),
    leads: ["II", "V2", "V5"],
    apply: P((p) => {
      p.ventricles.apd = Math.round(p.ventricles.apd * m.apdScale);
      p.ventricles.transmuralGradient = Math.round(p.ventricles.transmuralGradient * m.apdScale);
      p.ventricles.apicobasalGradient = Math.round(p.ventricles.apicobasalGradient * m.apdScale);
      p.ventricles.cvLongitudinal = +(p.ventricles.cvLongitudinal * m.cvScale).toFixed(3);
    }),
  };
}


/**
 * Potassium disorders. APD, conduction (atria, His–Purkinje, ventricles) and AP amplitude follow the
 * TP06 cell model; the AP shape that inscribes the T and U waves is calibrated (cellular/electrolytes.ts).
 */
function potassium(id: string, name: string, k: number, ecg: string): Scenario {
  const e = potassiumEffect(k);
  const hyper = k > 5.4;
  return {
    id,
    name,
    group: "E · Ionic/drug",
    status: "partial",
    modelClass: "reduced-order",
    criteria: { ...ALL, mechanism: false },
    mechanism: hyper
      ? `Raised extracellular K⁺ depolarises the resting membrane (TP06: −85.8 → ${e.vRest.toFixed(1)} mV), inactivating Na⁺ channels, so the upstroke is smaller and conduction slower everywhere — atria (flat P), His–Purkinje system (long PR) and ventricles (wide QRS). The K⁺ conductances rise with [K⁺]o, so repolarisation is faster and the APD slightly shorter: the T wave becomes tall and narrow.`
      : `Low extracellular K⁺ hyperpolarises the membrane (TP06: −85.8 → ${e.vRest.toFixed(1)} mV) and lowers the K⁺ conductances, so phase 3 is slower and its terminal part is delayed. Small voltage differences between these late AP tails inscribe the U wave (Ritsema van Eck et al. 2005), which becomes larger than the flattened T wave.`,
    structures: "Atrial and ventricular myocardium, His–Purkinje system.",
    changes: `Extracellular K⁺ 5.4 → ${k.toFixed(1)} mmol/L. TP06: ventricular APD × ${e.apdScale.toFixed(3)}, conduction × ${e.cvScale.toFixed(3)}, AP amplitude × ${e.ampScale.toFixed(3)}. Calibrated shape: phase-3 width × ${e.repolWidthScale.toFixed(2)}${e.tailFrac > 0 ? `, slow terminal component ${Math.round(100 * e.tailFrac)} % delayed by ${Math.round(100 * e.tailDelay)} % of the APD` : ""}.`,
    activation: e.cvScale < 0.95 ? "Slower activation of atria, conduction system and ventricles." : "Activation sequence unchanged (slightly faster conduction).",
    ecg,
    initiation: "Immediate.",
    limitations:
      "Partial. The direction of every change comes from the TP06 cell model, but TP06 mapped onto the tissue changes the T wave very little (taller by ≈ 20 % at 8 mM, no U wave at 3 mM), so the T/U morphology is calibrated rather than emergent. In real patients T-wave features correlate weakly with serum K⁺ (r ≤ 0.2 in routine ECGs; hyperkalaemic changes in only ≈ 46 % at 6–9.3 mmol/L), so the tracing shows the textbook pattern, not a predicted dose–response. 5.4 mmol/L is TP06's reference value, at the upper end of the normal serum range. Sinus-node and AV-nodal effects are not modelled; ST depression in hypokalaemia is not reproduced.",
    validation: T(`potassium ${id}`),
    leads: ["II", "V2", "V3", "V5"],
    apply: P((p) => (p.electrolytes.serumPotassium = k)),
  };
}

/**
 * Acute transmural ischaemia from a culprit coronary lesion (core/ischaemia.ts): the seven culprit
 * risk areas of Marriott Table 8.2, AP changes from TP06 under phase-1a ischaemia (amplitude loss
 * calibrated to human balloon-occlusion ST data).
 */
const ISCH_ECG: Record<Exclude<Culprit, "none">, { st: string; leads: string[]; chest?: "right" | "posterior"; note?: string }> = {
  "lad-prox": { st: "ST elevation V1–V4, I, aVL; reciprocal depression III, aVF.", leads: ["V2", "V3", "V4", "aVL", "III"] },
  "lad-diag": { st: "ST elevation I, aVL with minimal change in V1–V3; reciprocal depression III, aVF (high lateral).", leads: ["I", "aVL", "III", "V2"] },
  "lad-mid": { st: "ST elevation V3–V6, I, II, aVF (wrap-around apex); depression in aVR.", leads: ["V4", "V5", "II", "aVR"] },
  "lcx-nondominant": { st: "ST depression V1–V4 (the mirror image of posterolateral elevation) with little inferior change; ST elevation in posterior leads V7–V9.", leads: ["V2", "V3", "V7", "V8"], chest: "posterior", note: "The circumflex territory lies far from all 12 standard electrodes, so its ischaemia is seen as anterior ST depression; the posterior leads show the elevation directly." },
  "lcx-dominant": { st: "ST elevation II, III, aVF with ST depression V1–V4.", leads: ["II", "III", "aVF", "V3"], chest: "posterior" },
  "rca-prox": { st: "ST elevation II, III, aVF with III > II and reciprocal depression in I and aVL; ST elevation in V1 and in the right-sided leads V3R–V4R (right-ventricular involvement).", leads: ["III", "aVL", "V1", "V4R"], chest: "right" },
  "rca-distal": { st: "ST elevation II, III, aVF with depression in I and aVL; less right-sided elevation than a proximal lesion (no RV branches).", leads: ["III", "aVL", "V4R", "V2"], chest: "right" },
};
function ischaemiaScenario(culprit: Exclude<Culprit, "none">): Scenario {
  const t = CULPRIT_TERRITORY[culprit];
  const e = ISCH_ECG[culprit];
  return {
    id: `isch-${culprit}`,
    name: `Acute ischaemia — ${CULPRIT_LABELS[culprit]}`,
    group: "F · Ischaemia (culprit vessel)",
    status: "partial",
    modelClass: "reduced-order",
    criteria: { ...ALL, mechanism: false },
    mechanism:
      "Occlusion of the artery makes its territory acutely ischaemic through the full wall thickness. The ischaemic myocytes depolarise (TP06 under phase-1a conditions: rest −86 → −70 mV), lose AP amplitude and shorten their APD. During the plateau the ischaemic zone therefore sits at a lower potential than healthy muscle, and the injury current points toward it: leads facing the territory show ST elevation, leads opposite show reciprocal ST depression. The shorter APD makes the T wave taller (hyperacute T).",
    structures: `AHA segments ${t.segments.join(", ")}${t.rv ? " and the right-ventricular free wall" : ""}.`,
    changes: `Culprit ${CULPRIT_LABELS[culprit]}; grade 2 (APD × 0.895 and AP amplitude × 0.655 at the centre of the territory, soft border zone). Raise the grade to 3 in Parameters to add slow conduction in the zone (QRS distortion, tombstoning).`,
    activation: "Unchanged at grade 2; at grade 3 the ischaemic zone activates late.",
    ecg: e.st + (e.note ? ` ${e.note}` : ""),
    initiation: "Immediate (the state after about one minute of occlusion).",
    limitations:
      "Partial. Territories are the standard AHA vessel assignment on an idealised heart, not individual coronary anatomy. The size of the ST shift is calibrated to 1-minute balloon occlusion in man (LAD median 0.26 mV, Haeberlin et al. 2014); established STEMI is often larger. TP06 has no ATP-sensitive K⁺ current, hence the calibrated amplitude loss. Only the acute phase is modelled — no necrosis, Q waves or T-wave inversion, and no reperfusion. The model's precordial R-wave progression is poor (SCIENTIFIC_LIMITATIONS.md), which affects the baseline QRS but not the direction of the ST changes.",
    validation: `Automated test: "ischaemia ${culprit}" (tests/physiology/ischaemia.test.ts).`,
    leads: e.leads,
    chestSet: e.chest,
    apply: P((p) => (p.ischaemia = { culprit, grade: 2 })),
  };
}

/**
 * Drugs with a randomised human ECG study at a clinical dose: Johannesen et al., Clin Pharmacol Ther
 * 2014;96:549 (FDA, n = 22, placebo-corrected peak effects; doi:10.1038/clpt.2014.155). The tissue
 * effect is calibrated to the study's ΔΔQTc, ΔΔJ–Tpeak (early repolarisation), ΔΔTpeak–Tend (late
 * repolarisation) and ΔΔPR, measured here on the vector magnitude of the heart vector like the study's
 * global measures (scripts/dev/drug-cal*.ts): a uniform APD shift (early + late), a slower phase 3
 * (late repolarisation, the cellular effect of IKr block) and, for verapamil, slower AV-nodal conduction.
 * The TP06 cell model is not used for the size of the effect because, mapped to the tissue, it
 * under-predicts hERG-block QT prolongation about threefold and makes verapamil shorten QT markedly —
 * neither seen in man.
 */
export const DRUG_CLINICAL: Record<string, { dose: string; apdShift: number; phase3: number; ahShift: number; target: { qtc: number; jtp: number; tpte: number; pr: number }; model: { qt: number; jtp: number; tpte: number; pr: number }; tp06: string }> = {
  dofetilide: {
    dose: "500 µg single dose (peak plasma 2.7 ng/mL)",
    apdShift: 61.6,
    phase3: 1.59,
    ahShift: 0,
    target: { qtc: 79.3, jtp: 39.5, tpte: 40.0, pr: 0 },
    model: { qt: 78, jtp: 34, tpte: 44, pr: 0 },
    tp06: "TP06 alone (51 % hERG block at the free Cmax) would lengthen the APD by only ≈ 8 % (the gKr × 0.5 mapping gives × 1.085).",
  },
  quinidine: {
    dose: "400 mg quinidine sulfate single dose (peak plasma 1.8 µg/mL)",
    apdShift: 61.2,
    phase3: 1.7,
    ahShift: 0,
    target: { qtc: 78.1, jtp: 29.1, tpte: 49.8, pr: 5.1 },
    model: { qt: 80, jtp: 30, tpte: 50, pr: 0 },
    tp06: "TP06 alone predicts APD × 1.134 at the free Cmax.",
  },
  verapamil: {
    dose: "120 mg single dose (peak plasma 130 ng/mL)",
    apdShift: 0.1,
    phase3: 1.092,
    ahShift: 32,
    target: { qtc: 5.2, jtp: -2.4, tpte: 4.8, pr: 32.1 },
    model: { qt: 4, jtp: 0, tpte: 4, pr: 32 },
    tp06: "TP06 alone predicts marked APD shortening (× 0.73 at 4× the free Cmax) from L-type Ca²⁺ block; in man QTc did not change significantly, while PR lengthened by 32 ms through AV-nodal Ca²⁺-channel block.",
  },
};
function clinicalDrug(id: string, drugId: string): Scenario {
  const d = DRUG_BY_ID[drugId];
  const c = DRUG_CLINICAL[drugId];
  const mods = drugMods(d, 1);
  const pct = (g: number) => `${Math.round((1 - g) * 100)} %`;
  const f = (x: number) => (x > 0 ? `+${x}` : `${x}`);
  return {
    id,
    name: `${d.name} — clinical dose`,
    group: "E · Ionic/drug",
    status: "partial",
    modelClass: "reduced-order",
    criteria: { ...ALL, mechanism: false },
    mechanism:
      `At its free therapeutic concentration ${d.name.toLowerCase()} blocks IKr by ${pct(mods.gKr)}, ICaL by ${pct(mods.gCaL)} and peak INa by ${pct(mods.gNa)} (CiPA IC50 values, Crumb et al. 2016; Hill coefficient 1 assumed). ` +
      (drugId === "verapamil"
        ? "Its hERG block is offset by L-type Ca²⁺ block, so ventricular repolarisation barely changes; the clinically visible effect is slower AV-nodal conduction (a Ca²⁺-dependent tissue)."
        : "hERG (IKr) block slows phase 3, lengthening both early (J–Tpeak) and late (Tpeak–Tend) repolarisation; the inward-current block of quinidine shortens early repolarisation relative to late.") +
      ` ${d.note}`,
    structures: drugId === "verapamil" ? "AV node; ventricular myocardium." : "Ventricular myocardium (repolarisation).",
    changes: `${c.dose}. Tissue, calibrated to the human study: ventricular APD ${f(c.apdShift)} ms, phase-3 width × ${c.phase3}${c.ahShift ? `, AV-nodal conduction time +${c.ahShift} ms` : ""}.`,
    activation: c.ahShift ? "Longer AV-nodal delay; ventricular activation unchanged." : "Activation sequence and timing unchanged.",
    ecg:
      `Human study (placebo-corrected): QTc ${f(c.target.qtc)} ms, J–Tpeak ${f(c.target.jtp)} ms, Tpeak–Tend ${f(c.target.tpte)} ms, PR ${f(c.target.pr)} ms. ` +
      `This model: QT ${f(c.model.qt)}, J–Tpeak ${f(c.model.jtp)}, Tpeak–Tend ${f(c.model.tpte)}, PR ${f(c.model.pr)} ms.` +
      (drugId !== "verapamil" ? " The T wave is broader and lower; the study reported T-wave notching, which is not reproduced." : ""),
    initiation: "Immediate.",
    limitations:
      `Partial: the size of the effect is calibrated to one randomised study in 22 healthy volunteers (Johannesen et al. 2014) at a single dose, not predicted. ${c.tp06} ` +
      `The torsade risk category (${d.tdpRisk}) is clinical knowledge, not a model output. Use-dependence, state-dependent binding and heart-rate effects are not modelled.`,
    validation: T(`drug ${drugId}`),
    leads: ["II", "V2", "V5"],
    apply: P((p) => {
      p.ventricles.apd = Math.round(p.ventricles.apd + c.apdShift);
      p.ventricles.phase3Scale = c.phase3;
      p.avNode.ahMin += c.ahShift;
    }),
  };
}
/**
 * Calcium disorders. These deliberately do NOT come from the ionic cell model: TP06 reproduces the
 * opposite direction of the APD–[Ca²⁺]o relationship (measured in this implementation and shown in
 * the Ionic cell tab). The tissue effect is the measured human QT–calcium slope instead.
 */
function calcium(id: string, name: string, serum: number, dir: "shortens" | "prolongs"): Scenario {
  const shift = calciumApdShift(serum);
  const dq = Math.abs(shift).toFixed(0);
  return {
    id,
    name: `${name} (serum Ca²⁺ ${serum.toFixed(1)} mmol/L)`,
    group: "E · Ionic/drug",
    // "partial", not "validated": the ECG effect is calibrated and tested, but the mechanism is
    // imposed from human measurements rather than simulated from the ionic currents.
    status: "partial",
    modelClass: "reduced-order",
    criteria: { ...ALL, mechanism: false },
    mechanism:
      `Extracellular Ca²⁺ changes the calcium-dependent inactivation of the L-type Ca²⁺ current and so the duration of the plateau: higher calcium ${dir === "shortens" ? "speeds inactivation and shortens" : "slows inactivation and lengthens"} ` +
      `the action potential. The ionic cell model is not used for this scenario — TP06 (like ORd and Grandi) predicts the opposite direction (Bartolucci, Passini & Severi 2020), so the size and sign of the tissue effect are taken from human measurements.`,
    structures: "Ventricular myocardium (repolarisation).",
    changes: `Serum total calcium ${CALCIUM_REFERENCE.toFixed(1)} → ${serum.toFixed(1)} mmol/L; ventricular APD shifted by ${shift > 0 ? "+" : ""}${shift.toFixed(0)} ms (30.1 ms per mmol/L, Young et al. 2021).`,
    activation: "Activation sequence and conduction velocity unchanged — calcium acts on repolarisation only.",
    ecg: `QT ${dir} by about ${dq} ms with an unchanged QRS; the ST segment ${dir === "shortens" ? "shortens so the T wave follows the QRS closely" : "lengthens, separating the T wave from the QRS"}.`,
    initiation: "Immediate.",
    limitations:
      `The slope is linear and was measured in populations whose calcium lies in or near the reference range (Mendelian randomisation, UK Biobank, n = 76 226: 3.01 ms per 0.1 mmol/L, 95% CI 2.03–3.99). Applying it at ${serum.toFixed(1)} mmol/L is extrapolation, and the true change is probably larger: the equivalent slope measured against *ionised* calcium in haemodialysis patients is about threefold steeper (8.55 ms per 0.1 mmol/L). ` +
      `T-wave shape changes and the tall peaked T of severe hypercalcaemia are not reproduced, because the tissue action-potential shape is fixed. No arrhythmia arises from calcium alone in this model.`,
    validation: T(`calcium ${id}`),
    leads: ["II", "V2", "V5"],
    apply: P((p) => (p.electrolytes.serumCalcium = serum)),
  };
}

/**
 * Drug scenarios. Channel block comes from the measured IC50 values in drugs.ts; the resulting
 * TP06 conductance multipliers were paced through the same epi/M/endo protocol as TP06_MAPPED and
 * the tissue APD/CV scalings recorded here (scripts/dev/drug-scan.ts, rechecked by
 * tests/physiology/ionic.test.ts, which recomputes them from the cell model).
 */
export const DRUG_MAPPED: Record<string, { xCmax: number; apdScale: number; cvScale: number }> = {
  dofetilide: { xCmax: 4, apdScale: 1.151, cvScale: 1.0 },
  quinidine: { xCmax: 1, apdScale: 1.134, cvScale: 1.0 },
  flecainide: { xCmax: 4, apdScale: 1.155, cvScale: 0.885 },
  verapamil: { xCmax: 4, apdScale: 0.73, cvScale: 1.014 },
};

function drug(id: string, drugId: string, xCmax: number, kind: "ikr-dominant" | "na-dominant" | "cal-dominant"): Scenario {
  const d = DRUG_BY_ID[drugId];
  const map = DRUG_MAPPED[drugId];
  const mods = drugMods(d, xCmax);
  const pct = (g: number) => `${Math.round((1 - g) * 100)} %`;
  const qt = kind === "cal-dominant" ? "shortens" : "lengthens";
  const ecg =
    kind === "na-dominant"
      ? `QRS widens (ventricular CV × ${map.cvScale}) and QT ${qt}; the QT change is partly the wider QRS.`
      : kind === "cal-dominant"
        ? `QT ${qt} markedly (APD × ${map.apdScale}) with an unchanged QRS.`
        : `QT ${qt} (APD × ${map.apdScale}) with an unchanged QRS — the long-QT pattern of IKr blockade.`;
  return {
    id,
    name: `${d.name} ${xCmax}× free Cmax`,
    group: "E · Ionic/drug",
    status: "partial",
    modelClass: "reduced-order",
    criteria: { ...ALL, mechanism: false },
    mechanism:
      `At ${(d.freeCmax * xCmax).toFixed(1)} nM — ${xCmax}× the free therapeutic plasma concentration — ${d.name.toLowerCase()} blocks IKr by ${pct(mods.gKr)}, ICaL by ${pct(mods.gCaL)} and peak INa by ${pct(mods.gNa)}. ` +
      `Block is computed from the measured IC50 values of the CiPA ion-channel panel (Crumb et al. 2016) with the Hill equation at a Hill coefficient of 1, applied to the TP06 cell, and the resulting APD and upstroke changes are mapped onto the tissue. ${d.note}`,
    structures: "Ventricular myocytes (ionic model) → ventricular tissue (reduced-order).",
    changes: `IKr × ${mods.gKr.toFixed(2)}, ICaL × ${mods.gCaL.toFixed(2)}, INa × ${mods.gNa.toFixed(2)} in TP06; tissue APD × ${map.apdScale}, ventricular CV × ${map.cvScale}.`,
    activation: map.cvScale < 0.95 ? "Slower ventricular activation — the activation sequence is unchanged but takes longer." : "Activation sequence and timing unchanged.",
    ecg,
    initiation: "Immediate.",
    limitations:
      `Partial: block is treated as a fixed reduction in conductance. Use-dependence (rate-dependent block, prominent for ${d.name.toLowerCase() === "flecainide" ? "flecainide" : "sodium-channel blockers"}), state-dependent binding, trapping and metabolite activity are not modelled, and TP06 has no late sodium current. ` +
      `The torsade risk category shown (${d.tdpRisk}) is clinical knowledge, not a model output: this model cannot predict whether a given drug causes torsades, only how the measured channel block changes repolarisation and conduction. ` +
      (kind === "cal-dominant"
        ? "Note that the shortening here illustrates why hERG affinity alone is a poor predictor of risk — balanced ICaL block offsets it."
        : "Arrhythmia does not arise spontaneously from the drug in this model; combine it with the triggered-activity or polymorphic-VT scenarios to see the consequence."),
    validation: T(`drug ${drugId}`),
    leads: ["II", "V2", "V5"],
    apply: P((p) => {
      p.ventricles.apd = Math.round(p.ventricles.apd * map.apdScale);
      p.ventricles.transmuralGradient = Math.round(p.ventricles.transmuralGradient * map.apdScale);
      p.ventricles.apicobasalGradient = Math.round(p.ventricles.apicobasalGradient * map.apdScale);
      p.ventricles.cvLongitudinal = +(p.ventricles.cvLongitudinal * map.cvScale).toFixed(3);
    }),
  };
}

export const SCENARIOS: Scenario[] = [
  // ---------------------------------------------------------------- Baseline
  {
    id: "nsr",
    name: "Normal sinus rhythm",
    group: "Baseline",
    status: "validated",
    modelClass: "reduced-order",
    criteria: ALL,
    mechanism: "SA-node automaticity under resting autonomic tone; 1:1 AV conduction; synchronous His–Purkinje activation of both ventricles.",
    structures: "SA node, atria, AV node, His bundle, bundle branches, Purkinje networks, ventricular myocardium.",
    changes: "Default parameter set.",
    activation: "SA node → RA → LA (Bachmann); AV nodal delay; His → left septum first, then paraseptal LV/RV endocardium → epicardium; posterobasal regions last.",
    ecg: "Upright P in I/II/aVF; PR 120–200 ms; narrow QRS; T concordant with the main QRS deflection in limb and lateral leads.",
    initiation: "Continuous.",
    limitations: "Idealised geometry; PA interval longer than reference; deep S in V2–V3; amplitudes depend on scalar torso factors.",
    validation: "tests/physiology/normalSinus.test.ts (intervals vs reference ranges, lead identities, activation order).",
    leads: ["II", "V1", "V5"],
    apply: P(),
  },
  // ---------------------------------------------------------------- Group A
  {
    id: "brady",
    name: "Sinus bradycardia",
    group: "A · Brady/conduction",
    status: "validated",
    modelClass: "reduced-order",
    criteria: ALL,
    mechanism: "Increased vagal tone slows SA-node automaticity (and AV-nodal conduction).",
    structures: "SA node, AV node.",
    changes: "Vagal tone 0.5 → 0.9.",
    activation: "Unchanged sequence; longer cycle.",
    ecg: "Rate < 60 /min, normal P–QRS–T; slightly longer PR and QT (restitution).",
    initiation: "Immediate.",
    limitations: "Autonomic coefficients are nominal.",
    validation: T("sinus bradycardia"),
    leads: ["II"],
    apply: P((p) => (p.sinus.vagalTone = 0.9)),
  },
  {
    id: "tachy",
    name: "Sinus tachycardia",
    group: "A · Brady/conduction",
    status: "validated",
    modelClass: "reduced-order",
    criteria: ALL,
    mechanism: "Sympathetic activation with vagal withdrawal accelerates SA automaticity and AV-nodal conduction.",
    structures: "SA node, AV node.",
    changes: "Vagal 0.5 → 0.1; sympathetic 0.1 → 0.6.",
    activation: "Unchanged sequence; shorter cycle.",
    ecg: "Rate > 100 /min; QT shortens by APD restitution.",
    initiation: "Immediate.",
    limitations: "No β-adrenergic effect on ventricular APD; APD adapts within one beat (no slow memory).",
    validation: T("sinus tachycardia"),
    leads: ["II"],
    apply: P((p) => {
      p.sinus.vagalTone = 0.1;
      p.sinus.sympatheticTone = 0.6;
    }),
  },
  {
    id: "sinus-arrest",
    name: "Sinus arrest with junctional escape",
    group: "A · Brady/conduction",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "SA-node automaticity stops; the latent junctional pacemaker (His bundle), no longer overdrive-reset, fires after its own cycle length.",
    structures: "SA node, junctional pacemaker.",
    changes: "Sinus arrest on (live at the current time so the pause is visible).",
    activation: "No atrial activation from the SA node; junctional beats activate the ventricles normally and the atria retrogradely only if retrograde conduction is set to 'conducted'.",
    ecg: "Pause, then narrow-QRS escape beats at ≈45 /min without preceding P waves.",
    initiation: "Toggle 'Sinus arrest' (Parameters → Pacemaker function).",
    limitations: "All-or-none arrest; no gradual sinus slowing or pause distribution.",
    validation: T("sinus arrest"),
    leads: ["II"],
    apply: P((p) => (p.rhythm.sinusArrest = true)),
  },
  {
    id: "sa-exit",
    name: "SA exit block (type II, 4:3)",
    group: "A · Brady/conduction",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "The SA node fires on time but every 4th discharge fails to exit to the atrium.",
    structures: "SA node → perinodal atrium.",
    changes: "SA exit block every 4th discharge; junctional escape rate lowered to 30 /min so the pause is not interrupted.",
    activation: "Missing atrial activation for one cycle; sinus timing resumes on schedule.",
    ecg: "Dropped P–QRS–T; the pause equals two sinus cycles.",
    initiation: "Continuous pattern.",
    limitations: "Deterministic pattern; type I (Wenckebach) SA exit block not modelled; SA depolarisation itself is ECG-silent (as in reality).",
    validation: T("SA exit block"),
    leads: ["II"],
    apply: P((p) => {
      p.rhythm.saExitBlockEvery = 4;
      p.escape.junctionalRate = 30;
    }),
  },
  {
    id: "avb1",
    name: "First-degree AV block",
    group: "A · Brady/conduction",
    status: "validated",
    modelClass: "reduced-order",
    criteria: ALL,
    mechanism: "Slower AV-nodal conduction (longer AH) with 1:1 conduction.",
    structures: "Compact AV node.",
    changes: "Minimum AV nodal conduction time 65 → 180 ms.",
    activation: "Unchanged atrial and ventricular sequences; delayed His activation.",
    ecg: "PR > 200 ms; P and QRS unchanged.",
    initiation: "Immediate.",
    limitations: "Lumped AV node.",
    validation: T("first-degree AV block"),
    leads: ["II"],
    apply: P((p) => (p.avNode.ahMin = 180)),
  },
  {
    id: "mobitz1",
    name: "Second-degree AV block, Mobitz I (Wenckebach)",
    group: "A · Brady/conduction",
    status: "validated",
    modelClass: "reduced-order",
    criteria: ALL,
    mechanism: "Decremental AV-nodal conduction: each impulse arrives earlier on the nodal recovery curve, so AH lengthens until one impulse falls within the nodal refractory period.",
    structures: "Compact AV node (recovery-dependent delay).",
    changes: "AV-nodal ERP 300 → 650 ms (H-to-A recovery), recovery amplitude 180 → 300 ms, τ 90 → 200 ms; junctional escape 30 /min.",
    activation: "Progressive His delay, then a P wave without His/ventricular activation; the pause resets nodal recovery.",
    ecg: "Progressive PR prolongation, then a non-conducted P; grouped beating; the PR after the pause is the shortest.",
    initiation: "Continuous.",
    limitations: "Nodal parameters are nominal (chosen to show the mechanism at a resting sinus rate).",
    validation: T("Mobitz I"),
    leads: ["II"],
    apply: P((p) => {
      p.avNode.erp = 650;
      p.avNode.recoveryAmplitude = 300;
      p.avNode.recoveryTau = 200;
      p.escape.junctionalRate = 30;
    }),
  },
  {
    id: "mobitz2",
    name: "Second-degree AV block, Mobitz II (3:2)",
    group: "A · Brady/conduction",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "Intermittent all-or-none conduction failure below the His bundle; AV-nodal conduction is unchanged, so PR is constant.",
    structures: "Distal His bundle.",
    changes: "Infra-Hisian block of every 3rd impulse.",
    activation: "Normal until the His bundle; the blocked impulse does not reach the bundle branches.",
    ecg: "Constant PR, then a non-conducted P wave.",
    initiation: "Continuous.",
    limitations: "Deterministic pattern (real Mobitz II is intermittent); usually accompanied by bundle-branch disease, which is not combined here.",
    validation: T("Mobitz II"),
    leads: ["II"],
    apply: P((p) => (p.hisPurkinje.infraHisBlockEvery = 3)),
  },
  {
    id: "avb-2to1",
    name: "2:1 AV block",
    group: "A · Brady/conduction",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "Every second impulse is blocked (here: below the His bundle). The level cannot be determined from 2:1 conduction alone.",
    structures: "Distal His bundle.",
    changes: "Infra-Hisian block every 2nd impulse.",
    activation: "Alternate impulses stop in the His bundle.",
    ecg: "Two P waves per QRS; constant PR of conducted beats.",
    initiation: "Continuous.",
    limitations: "Nodal 2:1 block (by ERP) also emerges at fast atrial rates but is not used here.",
    validation: T("2:1 AV block"),
    leads: ["II"],
    apply: P((p) => (p.hisPurkinje.infraHisBlockEvery = 2)),
  },
  {
    id: "chb-junctional",
    name: "Complete AV block (nodal) – junctional escape",
    group: "A · Brady/conduction",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "No AV-nodal conduction; the His-bundle pacemaker below the block is released from overdrive suppression.",
    structures: "AV node, junctional pacemaker.",
    changes: "Complete AV nodal block on.",
    activation: "Atria from the SA node; ventricles from the His bundle via the normal conduction system.",
    ecg: "AV dissociation: regular P waves, regular narrow QRS at ≈45 /min, no fixed PR.",
    initiation: "Immediate.",
    limitations: "Escape rate fixed (no rate response).",
    validation: T("complete AV block, junctional escape"),
    leads: ["II", "V1"],
    apply: P((p) => (p.avNode.completeBlock = true)),
  },
  {
    id: "chb-ventricular",
    name: "Complete infra-Hisian block – ventricular escape",
    group: "A · Brady/conduction",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "Block below the His bundle: the junctional pacemaker cannot capture; a distal Purkinje (left posterior fascicle) pacemaker escapes.",
    structures: "Distal His bundle; LPF Purkinje pacemaker.",
    changes: "Complete infra-Hisian block on.",
    activation: "Ventricles activated from the distal left posterior fascicle region.",
    ecg: "AV dissociation; slow (≈30 /min) wide QRS escape rhythm.",
    initiation: "Immediate.",
    limitations: "Single fixed escape site.",
    validation: T("complete infra-Hisian block, ventricular escape"),
    leads: ["II", "V1"],
    apply: P((p) => (p.hisPurkinje.infraHisComplete = true)),
  },
  // ---------------------------------------------------------------- Group B
  {
    id: "pac",
    name: "Premature atrial complex (non-compensatory pause)",
    group: "B · Premature beats",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "A premature atrial excitation propagates through the atria, conducts through the AV node with a longer AH (decremental), and invades and resets the SA node.",
    structures: "Low right atrium, atria, AV node, SA node.",
    changes: "Ectopic focus low RA, single, coupling 520 ms, every 4 beats.",
    activation: "Atria from the low RA (inferior → superior); retrograde invasion of the SA node.",
    ecg: "Early P with a different (inferior-negative) axis, normal QRS, slightly longer PR; the following pause is less than compensatory.",
    initiation: "Coupled to every 4th sinus beat.",
    limitations: "SA-node reset is all-or-none; sinus-node entrance delay not modelled.",
    validation: T("PAC"),
    leads: ["II", "V1"],
    apply: P((p) => (p.ectopy = { ...p.ectopy, site: "ra-low", pattern: "single", coupling: 520, every: 4 })),
  },
  {
    id: "pvc",
    name: "Premature ventricular complex (compensatory pause)",
    group: "B · Premature beats",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "A premature excitation in the LV lateral wall spreads cell-to-cell; retrograde penetration of the AV node is concealed, so the next sinus P wave is blocked.",
    structures: "LV lateral wall, ventricular myocardium, His bundle, AV node (concealed conduction).",
    changes: "Ectopic focus LV lateral, single, coupling 450 ms, every 3 beats; retrograde AV conduction 'concealed' (default).",
    activation: "Ventricles from the LV lateral wall (right- and anteriorly-directed wavefront); retrograde His activation.",
    ecg: "Wide QRS without a preceding P; ST–T opposite to the QRS; fully compensatory pause (2 × sinus cycle).",
    initiation: "Coupled to every 3rd sinus beat.",
    limitations: "Detector-measured QRS duration of the ectopic beat can overestimate the true value when the T wave starts immediately (model truth is shown alongside).",
    validation: T("PVC with compensatory pause"),
    leads: ["II", "V1", "V6"],
    apply: P((p) => (p.ectopy = { ...p.ectopy, site: "lv-lateral", pattern: "single", coupling: 450, every: 3 })),
  },
  {
    id: "bigeminy",
    name: "Ventricular bigeminy",
    group: "B · Premature beats",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "A PVC coupled to every sinus beat; each PVC conceals into the AV node and blocks the next sinus P.",
    structures: "As for PVC.",
    changes: "Ectopy pattern bigeminy, coupling 450 ms.",
    activation: "Alternating normal and ectopic ventricular activation.",
    ecg: "Normal QRS – PVC – pause, repeating.",
    initiation: "Continuous.",
    limitations: "Fixed coupling (no re-entry or triggered mechanism underlies the coupling).",
    validation: T("bigeminy"),
    leads: ["II", "V1"],
    apply: P((p) => (p.ectopy = { ...p.ectopy, site: "lv-lateral", pattern: "bigeminy", coupling: 450 })),
  },
  {
    id: "trigeminy",
    name: "Ventricular trigeminy",
    group: "B · Premature beats",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "A PVC after every second sinus beat.",
    structures: "As for PVC.",
    changes: "Ectopy pattern trigeminy, coupling 450 ms.",
    activation: "Two normal activations, then one ectopic.",
    ecg: "Normal–normal–PVC groups.",
    initiation: "Continuous.",
    limitations: "Fixed coupling.",
    validation: T("trigeminy"),
    leads: ["II", "V1"],
    apply: P((p) => (p.ectopy = { ...p.ectopy, site: "lv-lateral", pattern: "trigeminy", coupling: 450 })),
  },
  {
    id: "couplet",
    name: "Ventricular couplet",
    group: "B · Premature beats",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "Two consecutive premature ventricular excitations; the second captures only if the tissue has recovered (coupling > local ERP).",
    structures: "As for PVC.",
    changes: "Ectopy pattern couplet, coupling 420 ms, every 4 beats.",
    activation: "Two successive activations from the LV lateral wall.",
    ecg: "Two consecutive wide complexes; the second may differ slightly because it meets partially recovered tissue.",
    initiation: "Coupled to every 4th sinus beat.",
    limitations: "Fixed coupling.",
    validation: T("couplet"),
    leads: ["II", "V1"],
    apply: P((p) => (p.ectopy = { ...p.ectopy, site: "lv-lateral", pattern: "couplet", coupling: 420, every: 4 })),
  },
  {
    id: "pvc-interpolated",
    name: "Interpolated PVC (no pause)",
    group: "B · Premature beats",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "An early PVC whose retrograde impulse does not penetrate the AV node (His still refractory), so the next sinus impulse conducts.",
    structures: "As for PVC.",
    changes: "Ectopy single, coupling 330 ms, every 3 beats.",
    activation: "Early ectopic activation; the next sinus beat conducts with a slightly longer PR.",
    ecg: "PVC sandwiched between two sinus beats without a pause.",
    initiation: "Coupled to every 3rd sinus beat.",
    limitations: "Whether interpolation occurs depends on nominal nodal parameters.",
    validation: T("interpolated PVC"),
    leads: ["II", "V1"],
    apply: P((p) => (p.ectopy = { ...p.ectopy, site: "lv-lateral", pattern: "single", coupling: 330, every: 3 })),
  },
  // ---------------------------------------------------------------- Group C
  {
    id: "focal-at",
    name: "Focal atrial tachycardia",
    group: "C · Supraventricular",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "A protected automatic focus in the left atrium fires at 150 /min, overdrives the SA node; 1:1 or Wenckebach AV conduction depending on nodal recovery.",
    structures: "Left atrium (posterior), atria, AV node.",
    changes: "Ectopy focus LA, rate 150 /min.",
    activation: "Atria activated from the LA (left → right).",
    ecg: "Regular narrow-complex tachycardia with abnormal P axis (negative in I/aVL); PR may lengthen.",
    initiation: "Immediate.",
    limitations: "Automaticity is imposed (rate parameter), not generated by ionic currents; no warm-up/cool-down.",
    validation: T("focal atrial tachycardia"),
    leads: ["II", "I", "V1"],
    apply: P((p) => (p.ectopy = { ...p.ectopy, site: "la", pattern: "focus", rate: 150, coupling: 400 })),
  },
  {
    id: "avnrt",
    name: "AV nodal re-entrant tachycardia (typical)",
    group: "C · Supraventricular",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "Dual AV-nodal pathways. A premature atrial beat blocks in the fast pathway (longer ERP), conducts down the slow pathway (PR jump) and returns up the recovered fast pathway; the circuit then sustains (slow–fast).",
    structures: "AV-node fast and slow pathways, atria, His–Purkinje system.",
    changes: "Dual pathway on; retrograde conduction 'conducted', retrograde nodal time 20 ms, retrograde ERP 150 ms, slow-pathway minimum AH 210 ms; PAC from the low RA, coupling 330 ms (one PAC). Calibrated to typical AVNRT: CL 317 ± 43 ms, HA 45.8 ± 7.7 ms (Katritsis et al. 2015).",
    activation: "Atria and ventricles activated almost simultaneously each cycle (retrograde atrial activation via the fast pathway).",
    ecg: "PAC with a long PR, then a regular narrow-complex tachycardia; retrograde P waves inferior-negative, buried in or just after the QRS.",
    initiation: "Single PAC at 330 ms after the third sinus beat (programmed-stimulation analogue).",
    limitations: "Pathways are lumped links joined at the His bundle (no lower common pathway, no atrial tissue in the circuit apart from the inputs). Rate depends on nominal pathway parameters.",
    validation: T("AVNRT"),
    leads: ["II", "V1"],
    apply: P((p) => {
      p.avNode.dualPathway = true;
      p.avNode.retrograde = "conducted";
      // Calibrated (scripts/dev/avnrt-scan*.ts) so that the retrograde fast pathway is quick enough for
      // atrial activation to fall inside / at the end of the QRS, as in typical (slow–fast) AVNRT:
      // HA 45.8 ± 7.7 ms, tachycardia CL 317 ± 43 ms (Katritsis et al. 2015, n = 34).
      p.avNode.retroTime = 20;
      p.avNode.retroErp = 150;
      p.avNode.slowAhMin = 210;
      p.ectopy = { ...p.ectopy, site: "ra-low", pattern: "once", coupling: 330, every: 3 };
    }),
  },
  {
    id: "avrt-ortho",
    name: "Orthodromic AVRT (concealed accessory pathway)",
    group: "C · Supraventricular",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "Macro-re-entry: antegrade over the AV node and His–Purkinje system, retrograde over a left lateral accessory pathway that conducts only retrogradely.",
    structures: "AV node, His–Purkinje system, LV lateral base, left lateral accessory pathway, atria.",
    changes: "Accessory pathway left lateral, antegrade off; AV-nodal ERP 300 → 130 ms; PAC from the high RA, coupling 330 ms.",
    activation: "Ventricles normally (narrow QRS); atria activated retrogradely from the left lateral annulus (left → right).",
    ecg: "Narrow-complex tachycardia; retrograde P after the QRS (RP < PR), negative in I.",
    initiation: "Single PAC after the third sinus beat.",
    limitations: "Pathway parameters nominal; the shortened nodal ERP is required for this geometry's short circuit.",
    validation: T("orthodromic AVRT"),
    leads: ["II", "I", "V1"],
    apply: P((p) => {
      p.accessory = { ...p.accessory, site: "ap-left-lateral", antegrade: false };
      p.avNode.erp = 130;
      p.ectopy = { ...p.ectopy, site: "ra-high", pattern: "once", coupling: 330, every: 3 };
    }),
  },
  {
    id: "avrt-anti",
    name: "Antidromic AVRT",
    group: "C · Supraventricular",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "Macro-re-entry: antegrade over the accessory pathway (fully pre-excited QRS), retrograde through the His bundle and AV node.",
    structures: "Left lateral accessory pathway, ventricular myocardium, His bundle, AV node, atria.",
    changes: "Manifest left lateral pathway (antegrade ERP 250 ms); retrograde AV conduction 'conducted' with ERP 120 ms; PAC from the high RA, coupling 300 ms.",
    activation: "Ventricles from the LV lateral base (cell-to-cell); His retrogradely; atria from the AV node.",
    ecg: "Regular wide-complex tachycardia with maximal pre-excitation.",
    initiation: "Single PAC after the third sinus beat (blocks in the AV node, conducts over the pathway).",
    limitations: "Pathway parameters nominal.",
    validation: T("antidromic AVRT"),
    leads: ["II", "V1", "V6"],
    apply: P((p) => {
      p.accessory = { ...p.accessory, site: "ap-left-lateral", antegrade: true, anteErp: 250 };
      p.avNode.retrograde = "conducted";
      p.avNode.retroErp = 120;
      p.ectopy = { ...p.ectopy, site: "ra-high", pattern: "once", coupling: 300, every: 3 };
    }),
  },
  {
    id: "preexcitation",
    name: "Ventricular pre-excitation (manifest pathway)",
    group: "C · Supraventricular",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "A non-decremental accessory pathway activates part of the ventricles before the AV-nodal impulse arrives (fusion).",
    structures: "Accessory pathway (selectable site), AV node, ventricles.",
    changes: "Accessory pathway left lateral, antegrade on.",
    activation: "Early activation of the LV lateral base; the rest from the His–Purkinje system.",
    ecg: "Short PR, delta wave, widened QRS, secondary ST–T changes.",
    initiation: "Continuous.",
    limitations: "Pathway conduction time and refractoriness are nominal; the degree of pre-excitation depends on the (fast) AV-nodal conduction of this model. Delta-wave onset is detected from the rise of the spatial ECG magnitude.",
    validation: T("pre-excitation"),
    leads: ["I", "II", "V1"],
    apply: P((p) => (p.accessory = { ...p.accessory, site: "ap-left-lateral", antegrade: true })),
  },
  {
    id: "flutter",
    name: "Typical atrial flutter (macro-re-entry around the tricuspid annulus)",
    group: "C · Supraventricular",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "Anatomical macro-re-entry in the right atrium. The tricuspid annulus, the venae cavae and a line of block between them (posterior to the crista terminalis) are non-conducting; the cavotricuspid isthmus (CTI) conducts slowly and has a longer refractory period. Burst pacing from the low lateral RA blocks in the isthmus in one direction; the wave travels around the annulus and re-enters the recovered isthmus.",
    structures: "Right atrium (tricuspid annulus, CTI, venae cavae, intercaval line), left atrium (passive), AV node.",
    changes: "Flutter anatomy on (CTI CV × 0.2, CTI APD × 1.3); burst of 6 stimuli at 230 ms from the low RA after every 3rd sinus beat until re-entry starts.",
    activation: "A single wavefront circulates around the tricuspid annulus every cycle; the left atrium is activated passively; the AV node conducts every 2nd–3rd flutter wave.",
    ecg: "Continuous, regular atrial activity without an isoelectric baseline (flutter waves) at a fixed rate; regular or regularly-irregular ventricular response with a fixed conduction ratio; PR not defined.",
    initiation: "Burst pacing (programmed-stimulation analogue). Sustained until parameters change (e.g. switch the flutter anatomy off = ablation of the isthmus line: re-entry stops).",
    limitations: "Spherical idealised atria: the circuit is shorter than in a real RA, so a slow isthmus (CV × 0.2, nominal) is needed to obtain a cycle length of ≈ 180 ms (≈ 330/min, near the upper part of the usual human range). Flutter-wave morphology on the surface ECG is not validated (no saw-tooth calibration).",
    validation: T("atrial flutter"),
    leads: ["II", "V1", "aVF"],
    apply: P((p) => {
      p.atria.flutterSubstrate = true;
      p.ectopy = { ...p.ectopy, site: "ra-low", pattern: "run", runLength: 6, coupling: 230, every: 3 };
    }),
  },
  {
    id: "af",
    name: "Atrial fibrillation (PV-triggered, remodelled atria)",
    group: "C · Supraventricular",
    status: "validated",
    modelClass: "reduced-order",
    criteria: ALL,
    mechanism: "A rapidly firing pulmonary-vein (posterior LA) focus drives atria with spatially heterogeneous refractoriness and slowed conduction. Activation breaks up into multiple re-entrant wavelets (fibrillatory conduction) that persist after the focus stops. The AV node receives rapid irregular input; concealed conduction makes the ventricular response irregular.",
    structures: "Posterior LA (PV focus), both atria (heterogeneous APD, slowed CV), AV node (concealed conduction), ventricles.",
    changes: "PV focus 450/min (CL 133 ms); atrial APD map heterogeneity SD 40 %, atrial CV 0.45 m/s, atrial reference APD 300 ms (calibrated, see limitations); AV-nodal concealment 0.25; sympathetic tone 0.3.",
    activation: "Irregular, rapidly changing atrial activation with wave break; faster activation near the PV driver (LA) than in the RA; irregular His and ventricular activation.",
    ecg: "No P waves; irregular baseline; irregularly irregular RR intervals; normal QRS. PR is not defined.",
    initiation: "Immediate. Switching the focus off (Premature beats → Stop) leaves fibrillation sustained by re-entry in this substrate.",
    limitations: "Event-driven graph without source–sink or curvature effects, so wavelet dynamics are qualitative. The atrial reference APD (300 ms at CL 1000) was chosen so the emergent RA cycle length (≈ 170–240 ms) lies near reported human AF cycle lengths (e.g. coronary-sinus AFCL 171 ± 27 ms, Verma et al. 2008); the APD rate map below CL 400 ms is extrapolated. Concealment and heterogeneity magnitudes are nominal. f-wave morphology is not validated.",
    validation: T("atrial fibrillation"),
    leads: ["II", "V1", "V5"],
    apply: P((p) => {
      Object.assign(p.atria, { apd: 300, cv: 0.45, heterogeneity: 0.4 });
      p.avNode.concealment = 0.25;
      p.sinus.sympatheticTone = 0.3;
      p.ectopy = { ...p.ectopy, site: "la", pattern: "focus", rate: 450, coupling: 300 };
    }),
  },
  // ---------------------------------------------------------------- Group D
  {
    id: "vt-focal",
    name: "Monomorphic VT (focal / automatic mechanism)",
    group: "D · Ventricular",
    status: "partial",
    modelClass: "mechanistic",
    criteria: { ...ALL, mechanism: false },
    mechanism: "A protected automatic focus in the RV outflow tract fires at 170 /min. This represents focal (automatic/triggered) VT only; its cellular trigger is imposed, not generated.",
    structures: "RV outflow tract, ventricles; atria continue in sinus rhythm (AV dissociation).",
    changes: "Ectopy focus RVOT, 170 /min.",
    activation: "Identical ventricular activation sequence every beat (monomorphic).",
    ecg: "Regular wide-complex tachycardia with inferior axis and LBBB-like V1; dissociated P waves.",
    initiation: "Immediate.",
    limitations: "Not re-entrant VT; the triggering mechanism (e.g. cAMP-mediated triggered activity) is not modelled.",
    validation: T("focal VT"),
    leads: ["II", "V1", "V6"],
    apply: P((p) => (p.ectopy = { ...p.ectopy, site: "rvot", pattern: "focus", rate: 170, coupling: 300 })),
  },
  {
    id: "vt-scar",
    name: "Scar-related re-entrant VT (monomorphic)",
    group: "D · Ventricular",
    status: "partial",
    modelClass: "mechanistic",
    criteria: { ...ALL, mechanism: true },
    mechanism:
      "Anatomical re-entry around a healed infarct. A transmural scar core and the Purkinje fibres over it are non-conducting; one surviving isthmus crosses the scar slowly and has a longer refractory period, and a border zone of surviving myocardium conducts slowly around it. In sinus rhythm the wavefront enters the isthmus and simultaneously passes round the scar, and the two limbs collide, so nothing happens. A premature beat blocks in the isthmus, travels round the scar, re-enters the recovered isthmus from the far end and completes a circuit.",
    structures: "LV inferolateral scar core, slow isthmus, border zone, surviving myocardium; the atria continue in sinus rhythm (AV dissociation).",
    changes:
      "Scar substrate on (isthmus CV × 0.18, border-zone CV × 0.12, isthmus APD × 1.3) with the refractory floor raised to 0.60 of reference APD; burst of 8 stimuli at 260 ms from the scar border after every 3rd sinus beat until re-entry starts.",
    activation: "One wavefront circulates the scar, each beat with the same activation sequence — hence a monomorphic QRS. The atria are dissociated.",
    ecg: "Regular wide-complex tachycardia, cycle length ≈ 280 ms (≈ 215 /min), with a constant QRS morphology (measured beat-to-beat axis dispersion ≈ 10°, against ≈ 1° for a focal VT and ≈ 60–85° for the polymorphic rhythms).",
    initiation:
      "Programmed stimulation only. The substrate is quiet in sinus rhythm — verified by running it without any stimulus — which is the behaviour a scar substrate should show: VT is inducible, not spontaneous.",
    limitations:
      "The cycle length is governed by the refractory floor as much as by the circuit, because this engine's re-entry has no excitable gap (see docs/SCIENTIFIC_LIMITATIONS.md); the floor is therefore raised for this scenario, which suppresses physiological APD shortening at short diastolic intervals. The scar geometry is an idealised sphere with one straight isthmus, not patient anatomy, and all three substrate factors are nominal. The slow border zone also distorts the baseline tracing: in sinus rhythm before induction this substrate gives QRS ≈ 112 ms and QT ≈ 560 ms, wider and longer than an uncomplicated post-infarct ECG. Entrainment, the response to pacing manoeuvres, and the relation between isthmus length and cycle length are not validated.",
    validation: T("scar-related VT"),
    leads: ["II", "V1", "V6"],
    apply: P((p) => {
      p.restitution.apdFloor = 0.6;
      p.ventricles.scar = true;
      p.ventricles.isthmusCvFactor = 0.18;
      p.ventricles.borderCvFactor = 0.12;
      p.ventricles.isthmusApdFactor = 1.3;
      p.ectopy = { ...p.ectopy, site: "scar-border", pattern: "run", runLength: 8, coupling: 260, every: 3 };
    }),
  },
  {
    id: "pvt",
    name: "Polymorphic VT",
    group: "D · Ventricular",
    status: "partial",
    modelClass: "reduced-order",
    criteria: { ...ALL, mechanism: false },
    mechanism:
      "Re-entry whose circuit moves from beat to beat, so the activation sequence — and therefore the QRS — keeps changing. Here the same scar substrate is used with a slower isthmus and a wider, less slowed border zone, so the circuit is unstable: wavefronts break and re-form around the scar instead of repeating one path.",
    structures: "LV scar and border zone, surviving myocardium; atria dissociated.",
    changes: "Scar substrate with isthmus CV × 0.12 and border-zone CV × 0.25, refractory floor 0.60; same burst as the monomorphic scenario.",
    activation: "A changing circuit: each beat activates the ventricles differently.",
    ecg: "Sustained wide-complex tachycardia, cycle length ≈ 310 ms (≈ 195 /min), with a continuously changing QRS — measured axis dispersion ≈ 61°, against ≈ 10° for the monomorphic scar VT in the same substrate.",
    initiation: "Burst pacing, as for the monomorphic scenario; quiet in sinus rhythm.",
    limitations:
      "Reduced-order: the wave break arises from the imposed geometry and refractoriness, not from source–sink mismatch or wavefront curvature, which this engine does not represent. The model does not draw a sharp line between polymorphic VT and fibrillation — the two scenarios here differ in degree of organisation and rate, not in kind. Nor is this rhythm's changing axis distinguishable from the twisting of the torsades scenario by rotation alone (net/total rotation 0.94 here against 0.89 there); what differs is the setting and that this rhythm is sustained rather than self-terminating. Cycle length depends on the refractory floor as described for the monomorphic scenario. Baseline tracing in sinus rhythm shows QRS ≈ 132 ms and QT ≈ 506 ms.",
    validation: T("polymorphic VT"),
    leads: ["II", "V1", "V6"],
    apply: P((p) => {
      p.restitution.apdFloor = 0.6;
      p.ventricles.scar = true;
      p.ventricles.isthmusCvFactor = 0.12;
      p.ventricles.borderCvFactor = 0.25;
      p.ventricles.isthmusApdFactor = 1.3;
      p.ectopy = { ...p.ectopy, site: "scar-border", pattern: "run", runLength: 8, coupling: 260, every: 3 };
    }),
  },
  {
    id: "tdp",
    name: "Torsades de pointes",
    group: "D · Ventricular",
    // "incomplete": the mechanism runs and is tested, but the ECG morphology is NOT faithful —
    // the complexes stay discrete instead of merging into continuous undulation. See limitations.
    status: "incomplete",
    modelClass: "reduced-order",
    criteria: { ...ALL, mechanism: false, ecg: false },
    mechanism:
      "A run of triggered beats whose site of origin migrates around the ventricles, one step per beat along a seven-site path. Because each beat starts somewhere new the activation direction turns progressively, the QRS axis with it, and the amplitude in any one lead swells and collapses as the axis sweeps through that lead's null. This is a reduced-order stand-in for a DRIFTING ROTOR: current optical-mapping and simulation work attributes the undulating axis of torsades to drift of a spiral wave (a Doppler effect), with the arrhythmia initiated by an EAD-triggered beat and maintained by re-entry in a substrate of inhomogeneous repolarisation. Each run here begins after a short–long–short sequence, at a coupling interval of 390 ms — the EAD takeoff time measured in the TP06 cell.",
    structures: "Ventricular myocardium on a long-QT substrate; the origin migrates across RVOT, LV anterobasal, lateral, inferobasal, LV apex, RV apex and septum.",
    changes: "Ventricular APD × 1.08 (long-QT substrate), ERP/APD ratio 0.85 (default 0.92 — lowered so that every beat of the run captures rather than every other one; both values are nominal), and the torsades generator on: cycle length 340 ms, one site per beat, 36-beat runs every 10th sinus beat, coupling 390 ms.",
    activation: "Every beat captures the ventricles (measured 100 % capture) from a site that moves one step further around the heart.",
    ecg: "Recurrent self-terminating runs at ≈ 176 /min on a prolonged QT. Once the run is established the tracing is continuous — no isoelectric baseline between complexes — and the lead II amplitude waxes and wanes repeatedly, about ten envelope cycles per run with a 5-fold swing between the largest and smallest complexes, the deflections inverting as the axis passes through the lead's null.",
    initiation: "Automatic and recurrent, each run preceded by a short–long–short sequence.",
    limitations:
      "Marked incomplete because the morphology is only partly faithful. The waxing and waning is reproduced, but the individual complexes are sharper and more fragmented than the broad, smooth deflections of a real recording, and the rate sits at the slow edge of the clinical range: organised ventricular capture fails above ≈ 176 /min on a long-QT substrate in this engine (driving faster blocks every other beat — measured 50 % capture at cycle lengths of 130–300 ms), whereas torsades is usually 200–250 /min. Getting every beat to capture also required lowering the ERP/APD ratio from 0.92 to 0.85; both are nominal values, but it is a tuning choice made to obtain the appearance, not a measurement. " +
      "The mechanism is also imposed rather than emergent: the migrating origin stands in for a drifting rotor the engine cannot produce, and the foci are not generated by the long QT — the same generator on a normal-QT substrate behaves much the same, so this cannot be used to predict torsade risk. Two other routes were tried and failed: a late-coupled R-on-T beat never initiated re-entry in any of 30 combinations, and burst-induced re-entry on a long-QT substrate gave randomly polymorphic rhythms at fibrillation rates (166–200 ms). Those attempts are recorded in docs/SCIENTIFIC_LIMITATIONS.md.",
    validation: T("torsades de pointes"),
    leads: ["II", "V1", "V5"],
    apply: P((p) => {
      p.ventricles.apd = Math.round(p.ventricles.apd * 1.08);
      p.ventricles.transmuralGradient = Math.round(p.ventricles.transmuralGradient * 1.08);
      p.ventricles.apicobasalGradient = Math.round(p.ventricles.apicobasalGradient * 1.08);
      p.ventricles.erpRatio = 0.85;
      p.torsades = { enabled: true, siteA: "rvot", cycleA: 340, drift: 1, beats: 36, every: 10, coupling: EAD_COUPLING };
    }),
  },
  {
    id: "vf",
    name: "Ventricular fibrillation",
    group: "D · Ventricular",
    status: "partial",
    modelClass: "reduced-order",
    criteria: { ...ALL, mechanism: false },
    mechanism:
      "Multiple simultaneous re-entrant wavelets. Spatially dispersed refractoriness lets a rapid burst break into several independent circuits that continue to fragment and collide, so no region keeps a stable rhythm and the ventricles never activate as a whole.",
    structures: "Both ventricles with a spatially heterogeneous refractory map (seeded, smoothed over ≈ 5 mm).",
    changes: "Ventricular repolarisation dispersion SD 0.20 and refractory floor 0.79 of reference APD (calibrated — see limitations); burst of 14 stimuli at 240 ms from the RV apex after every 3rd sinus beat.",
    activation: "Many small wavefronts at once, continuously breaking and re-forming; dozens of distinct re-entrant waves per run.",
    ecg: "Continuous irregular undulation with no identifiable P wave, QRS or T wave, and no isoelectric baseline. Local activation interval ≈ 220 ms (≈ 4.5 Hz) with ≈ 10 % beat-to-beat variability.",
    initiation: "Burst pacing. The substrate is quiet in sinus rhythm until the burst is delivered, and fibrillation then persists for the rest of the run.",
    limitations:
      "The cycle length is a CALIBRATION, not a prediction. Because re-entry in this engine has no excitable gap, its period is simply the refractory period: measured across 18 runs, cycle length was 0.408–0.422 × reference APD against a predicted 0.414. With the default floor the model fibrillates at ≈ 150 ms, far faster than human VF, so the floor was raised to 0.79 to bring the local activation interval to 220 ms — against measured human VF of 218 ± 24 ms in vivo (Nair et al. 2012) and a dominant frequency of 4.5–6.4 Hz (Bradley et al. 2011). That calibration suppresses physiological APD shortening at short diastolic intervals. Wavelet dynamics are qualitative: there is no source–sink mismatch, wavefront curvature or rotor meander, phase singularities are not computed, and the fibrillatory waveform's amplitude and spectrum are not validated. The dispersion map is a smoothed random field, not patient anatomy, and its magnitude is nominal; it also lengthens the baseline QT (≈ 420 ms in sinus rhythm before induction).",
    validation: T("ventricular fibrillation"),
    leads: ["II", "V1", "V5"],
    apply: P((p) => {
      p.restitution.apdFloor = 0.79;
      p.ventricles.heterogeneity = 0.2;
      p.ectopy = { ...p.ectopy, site: "rv-apex", pattern: "run", runLength: 14, coupling: 240, every: 3 };
    }),
  },
  // ---------------------------------------------------------------- Conduction (BBB)
  {
    id: "rbbb",
    name: "Right bundle branch block",
    group: "Conduction (BBB)",
    status: "incomplete",
    modelClass: "mechanistic",
    criteria: { ...ALL, ecg: false },
    mechanism: "Conduction in the right bundle is abolished; the RV is activated late by trans-septal myocardial spread.",
    structures: "Right bundle branch, septum, RV free wall.",
    changes: "RBB block on.",
    activation: "Left septum first (unchanged), LV, then late RV.",
    ecg: "Expected: QRS ≥ 120 ms, rsR′ in V1, wide S in I/V6, secondary ST–T. Model: late terminal rightward/anterior forces present and QRS ≈ 145 ms, but the frontal area axis is distorted (≈ −140°).",
    initiation: "Immediate.",
    limitations: "The idealised RV geometry/mass produces an implausible frontal QRS axis in RBBB, so the morphology is only partly reproduced.",
    validation: T("RBBB"),
    leads: ["V1", "V6", "I"],
    apply: P((p) => (p.hisPurkinje.rbbBlock = true)),
  },
  {
    id: "lbbb",
    name: "Left bundle branch block",
    group: "Conduction (BBB)",
    status: "validated",
    modelClass: "mechanistic",
    criteria: ALL,
    mechanism: "Conduction into the left bundle and its fascicles is abolished; the septum is activated from the right and the LV by slow myocardial spread.",
    structures: "Left bundle branch and fascicles, septum, LV.",
    changes: "LBB block on.",
    activation: "RV septal surface first; septum right-to-left; LV free wall last.",
    ecg: "Expected: QRS ≥ 120–140 ms, no septal q in I/V5–V6, broad R in I/V6, QS/rS in V1, discordant ST–T. Model: septal q lost; QRS ≈ 140 ms on the detector (activation spread ≈ 130 ms).",
    initiation: "Immediate.",
    limitations: "Retrograde entry into the LV Purkinje network is limited by a nominal retrograde junction delay (40 ms), calibrated so that QRS reaches the ≥ 140 ms LBBB criterion (Strauss et al. 2011); precordial morphology is affected by the near-field V2–V4 artefact.",
    validation: T("LBBB"),
    leads: ["V1", "V6", "I"],
    apply: P((p) => (p.hisPurkinje.lbbBlock = true)),
  },
  // ---------------------------------------------------------------- Group E
  ionic("ikr-50", "IKr inhibition 50 % (long-QT pattern)", "gKr × 0.5", "ikr50",
    "Reduced rapid delayed-rectifier current slows phase-3 repolarisation; the M cell (low IKs) prolongs most.",
    "Longer QT/QTc with unchanged QRS.", "No EADs/torsades; the M-cell layer is not represented in tissue, so transmural dispersion is under-represented. The TP06 → tissue mapping under-predicts the QT effect of hERG block about threefold: dofetilide at a dose giving ≈ 51 % block prolonged QTc by 79 ms in man (see the clinically calibrated dofetilide scenario), whereas this mapping gives ≈ +25 ms."),
  ionic("ikr-90", "IKr inhibition 90 %", "gKr × 0.1", "ikr90",
    "Near-complete IKr block (e.g. high-dose hERG blocker): strong APD prolongation.",
    "Marked QT prolongation with unchanged QRS.", "As above; TP06 produced no EADs under these conditions, so torsades cannot arise."),
  ionic("short-qt", "IKr gain of function (short-QT pattern)", "gKr × 2", "ikr200",
    "Increased IKr accelerates repolarisation (as in SQTS type 1, simplified as a conductance increase).",
    "Shorter QT; QRS unchanged.", "SQTS1 alters IKr inactivation kinetics, not just conductance."),
  potassium("hyperk", "Hyperkalaemia (K⁺ 7.0 mmol/L)", 7.0,
    "Peaked, narrow-based T waves, tallest in V2–V4; PR and QRS slightly longer; P wave lower and broader."),
  potassium("hyperk-severe", "Hyperkalaemia, advanced (K⁺ 8.5 mmol/L)", 8.5,
    "Peaked T waves with a long PR, a wide QRS (intraventricular conduction delay) and a flat, broad P wave — the later stages of Marriott's progression. The wide QRS brings secondary repolarisation changes in the lateral leads."),
  potassium("hypok", "Hypokalaemia (K⁺ 3.0 mmol/L)", 3.0,
    "Flattened T wave followed by a prominent U wave that exceeds it (T–U reversal), longest in V2–V4; larger P wave; QT(U) prolonged."),
  ionic("na-block", "Sodium-channel blockade (INa −50 %)", "gNa × 0.5", "na50",
    "Fewer available Na⁺ channels reduce dV/dt_max and conduction velocity.",
    "QRS widening; QT prolongs only by the QRS increase.", "Use-dependence (rate-dependent block) is not modelled; atrial/His–Purkinje effects not mapped."),
  ionic("ca-block", "L-type Ca²⁺-channel blockade (ICaL −50 %)", "gCaL × 0.5", "cal50",
    "Reduced plateau current shortens the ventricular APD.",
    "Shorter QT.", "The dominant clinical effect (AV-nodal slowing) is not modelled because the AV node is a lumped link without ionic currents."),
  calcium("hyperca", "Hypercalcaemia", 3.2, "shortens"),
  calcium("hypoca", "Hypocalcaemia", 1.6, "prolongs"),
  {
    id: "ead-dad",
    name: "EAD / DAD triggered activity",
    group: "E · Ionic/drug",
    status: "partial",
    modelClass: "reduced-order",
    criteria: { ...ALL, mechanism: false },
    mechanism:
      "Triggered activity: a second upstroke arising from the preceding action potential rather than from a pacemaker. An early afterdepolarisation (EAD) takes off during phase 3, from the reactivation of the L-type Ca²⁺ window current when repolarisation is slow; a delayed afterdepolarisation (DAD) takes off after full repolarisation, when spontaneous SR Ca²⁺ release drives inward Na⁺/Ca²⁺ exchange current. Both are reproduced in the single cell (Ionic cell tab); the tissue model receives the resulting beat at the coupling interval measured there.",
    structures: "Ventricular myocyte (ionic model) → ventricular tissue; triggered beats arise in the LV lateral wall.",
    changes:
      "Long-QT tissue substrate (ventricular APD × 1.17, the mapped effect of 90 % IKr block) plus triggered beats every 2nd sinus beat at a coupling interval of 390 ms — the EAD takeoff time measured in the cell (τ_f × 0.5, ICaL × 2.5, IKs × 0.2 at CL 1000 ms).",
    activation: "Sinus activation, then a late-coupled ectopic activation spreading cell-to-cell from the LV lateral wall while repolarisation is still incomplete.",
    ecg: "Prolonged QT with late-coupled wide ectopic beats falling on the T wave (R-on-T), in a bigeminal pattern.",
    initiation: "Immediate. The DAD variant (a triggered beat 403 ms after the upstroke, from calcium overload with an RyR leak) can be produced in the Ionic cell tab and applied with the same ectopy controls.",
    limitations:
      "Partial by construction. The afterdepolarisations themselves exist only in the single-cell model — the tissue receives their *timing* as an ectopic stimulus, it does not generate them, because the ionic model is not coupled cell-to-cell. Neither does the surface ECG show the afterdepolarisation itself. In addition, TP06 does not produce EADs from IKr block alone at any degree of block; the published modification used here shortens the ICaL f-gate time constant to enlarge the window current (Vandersickel et al. 2014), and DADs require an added RyR leak (Chakraborty et al.). Those are modifications of the cell model, not emergent properties of it.",
    validation: T("EAD/DAD triggered activity"),
    leads: ["II", "V2", "V5"],
    apply: P((p) => {
      p.ventricles.apd = Math.round(p.ventricles.apd * 1.173);
      p.ventricles.transmuralGradient = Math.round(p.ventricles.transmuralGradient * 1.173);
      p.ventricles.apicobasalGradient = Math.round(p.ventricles.apicobasalGradient * 1.173);
      p.ectopy = { ...p.ectopy, site: "lv-lateral", pattern: "bigeminy", coupling: EAD_COUPLING };
    }),
  },
  clinicalDrug("drug-dofetilide", "dofetilide"),
  clinicalDrug("drug-quinidine", "quinidine"),
  drug("drug-flecainide", "flecainide", 4, "na-dominant"),
  clinicalDrug("drug-verapamil", "verapamil"),
  // ---------------------------------------------------------------- Group F
  ischaemiaScenario("lad-prox"),
  ischaemiaScenario("lad-diag"),
  ischaemiaScenario("lad-mid"),
  ischaemiaScenario("lcx-nondominant"),
  ischaemiaScenario("lcx-dominant"),
  ischaemiaScenario("rca-prox"),
  ischaemiaScenario("rca-distal"),
];

/** Machine-readable export (used by scripts/export-registry.ts). */
export function registryJson() {
  return SCENARIOS.map((s) => ({
    id: s.id,
    name: s.name,
    group: s.group,
    status: s.status,
    modelClass: s.modelClass,
    criteria: s.criteria,
    complete: Object.values(s.criteria).every(Boolean),
    runnable: !!s.apply,
    changes: s.changes,
    limitations: s.limitations,
    validation: s.validation,
  }));
}
