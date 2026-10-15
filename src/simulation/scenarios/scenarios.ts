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
 *                   misleading waveform is ever shown.
 *
 * Every runnable scenario is a parameter set applied to the default model — no waveform is
 * stored anywhere. `apply` always starts from DEFAULT_PARAMS so scenarios are reproducible.
 */
import { DEFAULT_PARAMS, cloneParams, type SimParams } from "../core/params";

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
  group: "Baseline" | "A · Brady/conduction" | "B · Premature beats" | "C · Supraventricular" | "D · Ventricular" | "E · Ionic/drug" | "Conduction (BBB)";
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
  apply?: () => SimParams;
}

const ALL: Criteria = { mechanism: true, initialization: true, activationSequence: true, ecg: true, actionPotential: true, explanation: true, validation: true, ui: true };
const NONE: Criteria = { mechanism: false, initialization: false, activationSequence: false, ecg: false, actionPotential: false, explanation: false, validation: false, ui: false };
const P = (f?: (p: SimParams) => void) => () => {
  const p = cloneParams(DEFAULT_PARAMS);
  f?.(p);
  return p;
};
const T = (name: string) => `Automated test: "${name}" (tests/physiology/scenarios.test.ts).`;

const unsupported = (id: string, name: string, group: Scenario["group"], needs: string): Scenario => ({
  id,
  name,
  group,
  status: "unsupported",
  modelClass: "none",
  criteria: NONE,
  mechanism: "—",
  structures: "—",
  changes: "—",
  activation: "—",
  ecg: "—",
  initiation: "—",
  limitations: `Not runnable. Requires: ${needs}`,
  validation: "Not applicable (no model).",
  leads: [],
});

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
    changes: "Dual pathway on; retrograde conduction 'conducted', retrograde ERP 180 ms; PAC from the low RA, coupling 330 ms (one PAC).",
    activation: "Atria and ventricles activated almost simultaneously each cycle (retrograde atrial activation via the fast pathway).",
    ecg: "PAC with a long PR, then a regular narrow-complex tachycardia; retrograde P waves inferior-negative, buried in or just after the QRS.",
    initiation: "Single PAC at 330 ms after the third sinus beat (programmed-stimulation analogue).",
    limitations: "Pathways are lumped links joined at the His bundle (no lower common pathway, no atrial tissue in the circuit apart from the inputs). Rate depends on nominal pathway parameters.",
    validation: T("AVNRT"),
    leads: ["II", "V1"],
    apply: P((p) => {
      p.avNode.dualPathway = true;
      p.avNode.retrograde = "conducted";
      p.avNode.retroErp = 180;
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
    status: "incomplete",
    modelClass: "mechanistic",
    criteria: { ...ALL, ecg: false },
    mechanism: "A non-decremental accessory pathway activates part of the ventricles before the AV-nodal impulse arrives (fusion).",
    structures: "Accessory pathway (selectable site), AV node, ventricles.",
    changes: "Accessory pathway left lateral, antegrade on.",
    activation: "Early activation of the LV lateral base; the rest from the His–Purkinje system.",
    ecg: "Short PR, delta wave, widened QRS, secondary ST–T changes.",
    initiation: "Continuous.",
    limitations: "The automatic detector can miss the slow delta upstroke and then under-reports QRS and PR (model truth is shown alongside). The pre-excited fraction is small because AV-nodal conduction is fast in this model.",
    validation: T("pre-excitation"),
    leads: ["I", "II", "V1"],
    apply: P((p) => (p.accessory = { ...p.accessory, site: "ap-left-lateral", antegrade: true })),
  },
  unsupported("flutter", "Atrial flutter", "C · Supraventricular", "a macro-re-entrant circuit with an anatomical obstacle (tricuspid annulus, crista terminalis line of block) and slow cavotricuspid isthmus conduction; the idealised spherical atria have no such barriers."),
  unsupported("af", "Atrial fibrillation", "C · Supraventricular", "a fine atrial mesh with source–sink effects and wavebreak (monodomain / ionic tissue model); an event-driven graph cannot represent multiple-wavelet or rotor dynamics faithfully."),
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
  unsupported("vt-scar", "Scar-related re-entrant VT", "D · Ventricular", "a scar region with a slow-conducting isthmus and conduction block lines; planned as an extension of the tissue graph (regional CV and block masks), not yet implemented."),
  unsupported("pvt", "Polymorphic VT", "D · Ventricular", "dynamically changing re-entry (wavebreak) — needs a continuum/ionic tissue model."),
  unsupported("tdp", "Torsades de pointes", "D · Ventricular", "EAD-triggered activity arising in tissue with prolonged, heterogeneous repolarisation and the resulting re-entry; the ionic single-cell model can show EADs but tissue coupling is not implemented."),
  unsupported("vf", "Ventricular fibrillation", "D · Ventricular", "multiple re-entrant wavelets / rotors with wavebreak — needs a monodomain or bidomain ionic tissue model."),
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
    ecg: "Expected: QRS ≥ 120 ms, rsR′ in V1, wide S in I/V6, secondary ST–T. Model: late terminal rightward/anterior forces present, but QRS ≈ 115 ms and the frontal area axis is distorted (≈ −120°).",
    initiation: "Immediate.",
    limitations: "RV mass and trans-septal conduction in the idealised geometry produce too little QRS prolongation and an implausible frontal axis — morphology is therefore only partly reproduced.",
    validation: T("RBBB"),
    leads: ["V1", "V6", "I"],
    apply: P((p) => (p.hisPurkinje.rbbBlock = true)),
  },
  {
    id: "lbbb",
    name: "Left bundle branch block",
    group: "Conduction (BBB)",
    status: "incomplete",
    modelClass: "mechanistic",
    criteria: { ...ALL, ecg: false },
    mechanism: "Conduction into the left bundle and its fascicles is abolished; the septum is activated from the right and the LV by slow myocardial spread.",
    structures: "Left bundle branch and fascicles, septum, LV.",
    changes: "LBB block on.",
    activation: "RV septal surface first; septum right-to-left; LV free wall last.",
    ecg: "Expected: QRS ≥ 120–140 ms, no septal q in I/V5–V6, broad R in I/V6, QS/rS in V1, discordant ST–T. Model: septal q lost, QRS ≈ 125 ms (shorter than typical clinical LBBB).",
    initiation: "Immediate.",
    limitations: "The LV Purkinje network is re-entered retrogradely through Purkinje–muscle junctions, which shortens LV activation compared with clinical LBBB.",
    validation: T("LBBB"),
    leads: ["V1", "V6", "I"],
    apply: P((p) => (p.hisPurkinje.lbbBlock = true)),
  },
  // ---------------------------------------------------------------- Group E
  {
    id: "ikr-proxy",
    name: "Reduced repolarising current (IKr-block proxy, long QT pattern)",
    group: "E · Ionic/drug",
    status: "partial",
    modelClass: "reduced-order",
    criteria: { ...ALL, mechanism: false },
    mechanism: "Ventricular APD is prolonged uniformly (reduced-order stand-in for reduced IKr); no ionic current is simulated in tissue.",
    structures: "Ventricular myocardium.",
    changes: "Reference ventricular APD 300 → 380 ms.",
    activation: "Unchanged.",
    ecg: "Longer QT and QTc with unchanged QRS.",
    initiation: "Immediate.",
    limitations: "Not an ionic model: no rate-dependence specific to IKr block, no EADs, no transmural differential effect. See the ionic single-cell lab (TP06) for the cellular mechanism.",
    validation: T("APD prolongation lengthens QT"),
    leads: ["II", "V5"],
    apply: P((p) => (p.ventricles.apd = 380)),
  },
  unsupported("short-qt", "Short QT", "E · Ionic/drug", "IKr/IKs gain-of-function in an ionic tissue model (a uniform APD reduction would only be a proxy)."),
  unsupported("hyperk", "Hyperkalaemia", "E · Ionic/drug", "extracellular K⁺ effects on resting potential, Na⁺ availability (conduction slowing) and IK1/IKr (peaked T) in tissue — requires the ionic tissue layer."),
  unsupported("hypok", "Hypokalaemia", "E · Ionic/drug", "the ionic tissue layer (reduced IK1/IKr, U waves are not representable)."),
  unsupported("hyperca", "Hypercalcaemia", "E · Ionic/drug", "the ionic tissue layer (ICaL inactivation → shorter plateau / ST)."),
  unsupported("hypoca", "Hypocalcaemia", "E · Ionic/drug", "the ionic tissue layer (longer plateau / ST)."),
  unsupported("na-block", "Sodium-channel blockade", "E · Ionic/drug", "use-dependent INa block coupled to conduction velocity in tissue (planned: CV scaling from the ionic model's Na availability)."),
  unsupported("ca-block", "Calcium-channel blockade", "E · Ionic/drug", "nodal ICaL-dependent conduction (AV node) and plateau effects — the AV node is a lumped link without ionic currents."),
  unsupported("ead-dad", "EAD / DAD triggered activity", "E · Ionic/drug", "ionic tissue coupling; EADs can be inspected only in the single-cell ionic model (not propagated)."),
  unsupported("drug-arrhythmia", "Selected drug-induced arrhythmias", "E · Ionic/drug", "validated drug-channel block parameters and an ionic tissue model."),
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
