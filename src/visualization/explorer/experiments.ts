/**
 * Explorer experiments A–F (spec §3.3). Each variant is a parameter set applied from the
 * default (baseline) state: nothing here is a waveform preset — every ECG is recomputed by
 * the simulator from the changed activation/recovery sequence.
 */
import { DEFAULT_PARAMS, cloneParams, type SimParams } from "../../simulation/core/params";
import { SCENARIOS } from "../../simulation/scenarios/scenarios";

export interface ExperimentVariant {
  id: string;
  label: string;
  leads?: string[];
  params: () => SimParams;
  /** What to look for (mechanistic expectation, not a diagnostic criterion). */
  look: string;
}
export interface Experiment {
  id: string;
  title: string;
  short: string;
  summary: string;
  fidelity: string;
  variants: ExperimentVariant[];
}

type Mod = (p: SimParams) => void;
export function paramsWith(mod?: Mod): SimParams {
  const p = cloneParams(DEFAULT_PARAMS);
  mod?.(p);
  return p;
}
const v = (id: string, label: string, look: string, mod?: Mod, leads?: string[]): ExperimentVariant => ({
  id,
  label,
  leads,
  look,
  params: () => paramsWith(mod),
});
/** Ventricular-origin rhythm: a protected focus faster than the sinus node captures every beat. */
const focus = (site: SimParams["ectopy"]["site"], rate = 82): Mod => (p) => {
  p.ectopy = { ...p.ectopy, site, pattern: "focus", rate, coupling: 300 };
};

export const EXPERIMENTS: Experiment[] = [
  {
    id: "A",
    title: "A · Normal sinus rhythm",
    short: "A NSR",
    summary: "Follow one beat from SA node to recovery; compare a lead that faces the activation (II) with one that faces away (aVR).",
    fidelity: "Reduced-order tissue graph + dipole/lead-field forward model",
    variants: [v("A-nsr", "Normal sinus rhythm", "P, QRS and T upright in II; all inverted in aVR (II and aVR face nearly opposite directions).", undefined, ["II", "aVR"])],
  },
  {
    id: "B",
    title: "B · Origin of activation",
    short: "B origin",
    summary: "A protected focus (82 /min, faster than the sinus node) activates the ventricles from a chosen site; sinus P waves continue independently.",
    fidelity: "Mechanistic activation sequence; QRS morphology emerges from the forward model",
    variants: [
      v("B-normal", "Normal (His–Purkinje)", "Narrow QRS: Purkinje network activates the endocardium nearly simultaneously.", undefined, ["II", "V1", "V6"]),
      v("B-rvapex", "RV apex", "Wide QRS; activation spreads from the RV apex upward and leftward → superior axis, LBBB-like precordial pattern.", focus("rv-apex"), ["II", "V1", "V6"]),
      v("B-rvot", "RV outflow tract", "Wide QRS with an inferior axis (activation starts high and travels down).", focus("rvot"), ["II", "V1", "V6"]),
      v("B-septum", "Mid septum", "Activation spreads to both ventricles from the septum: intermediate width.", focus("septum"), ["II", "V1", "V6"]),
      v("B-lvlat", "LV lateral", "Activation moves rightward and anteriorly → negative in I/V6, positive in V1 (RBBB-like).", focus("lv-lateral"), ["I", "V1", "V6"]),
      v("B-lvapex", "LV apex", "Activation travels from apex to base → negative inferior leads.", focus("lv-apex"), ["II", "V1", "V6"]),
    ],
  },
  {
    id: "C",
    title: "C · Bundle branch block",
    short: "C BBB",
    summary: "Abolish conduction in one bundle branch. The blocked side is activated late by slow cell-to-cell spread across the septum; repolarisation follows the changed activation order.",
    fidelity: "Mechanistic block; morphology partly reproduced (see limitations)",
    variants: [
      v("C-normal", "Normal", "Septal q in V6, small r in V1.", undefined, ["V1", "V6", "I"]),
      v("C-rbbb", "RBBB", "Late RV activation → terminal anterior/rightward forces: late R′ in V1, wide terminal S in I/V6; ST–T opposite the terminal QRS.", (p) => (p.hisPurkinje.rbbBlock = true), ["V1", "V6", "I"]),
      v("C-lbbb", "LBBB", "Septum activated right-to-left (no septal q in V6/I); broad QRS dominated by slow LV activation; ST–T discordant.", (p) => (p.hisPurkinje.lbbBlock = true), ["V1", "V6", "I"]),
    ],
  },
  {
    id: "D",
    title: "D · Electrical axis",
    short: "D axis",
    summary: "The frontal QRS axis is computed from the simulated I and aVF areas (not set). Watch the frontal loop as conduction is changed.",
    fidelity: "Signal-derived axis; LAF/LPF shifts are NOT reproduced faithfully by this geometry",
    variants: [
      v("D-normal", "Normal", "Axis ≈ +20° in this model (normal range −30° to +90°).", undefined, ["I", "aVF"]),
      v("D-laf", "LAF block", "Expected: left-axis deviation. This model shows only a small change (known limitation).", (p) => (p.hisPurkinje.lafBlock = true), ["I", "aVF"]),
      v("D-lpf", "LPF block", "Expected: rightward shift.", (p) => (p.hisPurkinje.lpfBlock = true), ["I", "aVF"]),
      v("D-rvapex", "RV apical origin", "Superior (negative aVF) axis from apex-to-base activation.", focus("rv-apex"), ["I", "aVF"]),
    ],
  },
  {
    id: "E",
    title: "E · Repolarisation",
    short: "E repol",
    summary: "The T wave reflects spatial differences in recovery time. Change regional APD and see the T wave and QT follow — the QRS does not change.",
    fidelity: "Reduced-order APD map (not ionic); ionic IKr/IKs effects are planned (TP06)",
    variants: [
      v("E-normal", "Normal", "Epicardium and base recover first → upright T in II and V5.", undefined, ["II", "V2", "V5"]),
      v("E-apd", "Global APD +25 %", "Longer QT with unchanged QRS. Reduced-order proxy for repolarising-current reduction (e.g. IKr block); not a drug model.", (p) => (p.ventricles.apd = 375), ["II", "V2", "V5"]),
      v("E-flat", "No transmural / apicobasal gradient", "Recovery follows activation alone → T wave becomes discordant (inverted where QRS is upright).", (p) => {
        p.ventricles.transmuralGradient = 0;
        p.ventricles.apicobasalGradient = 0;
      }, ["II", "V2", "V5"]),
      v("E-hetero", "Larger transmural gradient", "Bigger endo–epi recovery difference → larger T amplitude (Tpeak–Tend widens).", (p) => (p.ventricles.transmuralGradient = 60), ["II", "V2", "V5"]),
    ],
  },
  {
    id: "F",
    title: "F · Premature ventricular beats",
    short: "F PVC",
    summary: "Inject premature excitations at a chosen site and coupling interval. Retrograde conduction into the AV node is concealed by default.",
    fidelity: "Mechanistic (refractoriness, concealed conduction, compensatory pause)",
    variants: [
      v("F-single", "Single LV PVC", "Wide QRS without a preceding P; fully compensatory pause because the next sinus P meets a refractory AV node.", (p) => {
        p.ectopy = { ...p.ectopy, site: "lv-lateral", pattern: "single", coupling: 450, every: 3 };
      }, ["II", "V1", "V6"]),
      v("F-rvot", "RVOT PVC", "Inferior axis, LBBB-like in V1.", (p) => {
        p.ectopy = { ...p.ectopy, site: "rvot", pattern: "single", coupling: 450, every: 3 };
      }, ["II", "V1", "V6"]),
      v("F-bigem", "Bigeminy", "Every sinus beat followed by a PVC.", (p) => {
        p.ectopy = { ...p.ectopy, site: "lv-lateral", pattern: "bigeminy", coupling: 450 };
      }, ["II", "V1", "V6"]),
      v("F-early", "Very early (250 ms)", "Stimulus falls in the refractory period → no capture.", (p) => {
        p.ectopy = { ...p.ectopy, site: "lv-lateral", pattern: "single", coupling: 250, every: 3 };
      }, ["II", "V1", "V6"]),
      v("F-couplet", "Couplet", "Two consecutive PVCs.", (p) => {
        p.ectopy = { ...p.ectopy, site: "lv-lateral", pattern: "couplet", coupling: 420, every: 4 };
      }, ["II", "V1", "V6"]),
    ],
  },
];

const fromScenario = (id: string, label: string, look: string, leads: string[]): ExperimentVariant => ({
  id: `G-${id}`,
  label,
  look,
  leads,
  params: () => SCENARIOS.find((x) => x.id === id)!.apply!(),
});
EXPERIMENTS.push({
  id: "G",
  title: "G · Atrial flutter and fibrillation",
  short: "G atrial",
  summary: "Re-entrant atrial arrhythmias: a single macro-re-entrant wave around the tricuspid annulus (flutter) versus multiple wavelets driven by a pulmonary-vein focus (fibrillation). Watch the atria in the 3-D view and the regularity of the ventricular response.",
  fidelity: "Mechanistic re-entry on an idealised atrial geometry; wavelet dynamics qualitative",
  variants: [
    fromScenario("nsr", "Sinus rhythm", "One wavefront per beat from the SA node.", ["II", "V1"]),
    fromScenario("flutter", "Typical flutter", "Regular atrial waves at ≈ 330/min; fixed AV conduction ratio.", ["II", "V1"]),
    fromScenario("af", "Atrial fibrillation", "Irregular atrial activation, no P waves, irregularly irregular RR.", ["II", "V1"]),
  ],
});

export function findVariant(id: string): ExperimentVariant | undefined {
  for (const e of EXPERIMENTS) for (const x of e.variants) if (x.id === id) return x;
  return undefined;
}
