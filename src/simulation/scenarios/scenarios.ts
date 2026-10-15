/**
 * Scenario catalogue. Every entry documents mechanism, structures, parameter changes,
 * expected activation sequence and ECG, fidelity and limitations, and initiation /
 * maintenance / termination conditions (spec §6).
 *
 * Status:
 *  - "validated-baseline": covered by automated physiology tests (Phase 1).
 *  - "preview": emerges from Phase-1 parameters only; NOT yet validated against reference
 *    data (Phase 2 will add dedicated tests). Shown so the causal chain can be explored.
 *  - "planned": listed for transparency; requires mechanisms not implemented yet.
 */
import { DEFAULT_PARAMS, cloneParams, type SimParams } from "../core/params";

export type ScenarioStatus = "validated-baseline" | "preview" | "planned";
export type Fidelity = "L1 conduction network" | "L1+L2 network + tissue graph" | "L3 ionic" | "Schematic";

export interface Scenario {
  id: string;
  name: string;
  family: string;
  status: ScenarioStatus;
  phase: number;
  fidelity: Fidelity;
  mechanism: string;
  structures: string;
  changes: string;
  activation: string;
  ecg: string;
  limitations: string;
  initiation: string;
  apply?: (p: SimParams) => SimParams;
}

const mod = (f: (p: SimParams) => void) => (base: SimParams) => {
  const p = cloneParams(base);
  f(p);
  return p;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "nsr",
    name: "Normal sinus rhythm",
    family: "Baseline",
    status: "validated-baseline",
    phase: 1,
    fidelity: "L1+L2 network + tissue graph",
    mechanism: "SA node automaticity under resting autonomic tone; 1:1 AV conduction through a recovered AV node; synchronous His–Purkinje activation of both ventricles.",
    structures: "SA node, crista terminalis, Bachmann's bundle, atria, AV node, His bundle, bundle branches and fascicles, Purkinje networks, ventricular myocardium.",
    changes: "Default parameter set.",
    activation: "SA node → right atrium → left atrium via Bachmann's bundle; AV nodal delay; His → left septal surface first, then paraseptal LV and RV endocardium; endocardium → epicardium; posterobasal regions last.",
    ecg: "Upright P in I/II/aVF; PR within 120–200 ms; narrow QRS; T concordant with the main QRS deflection in the limb and lateral leads.",
    limitations: "Idealised geometry; morphology tuned qualitatively; amplitudes depend on scalar torso factors.",
    initiation: "Continuous; stable from the first beat (the initial state approximates steady state at the sinus cycle length).",
    apply: () => cloneParams(DEFAULT_PARAMS),
  },
  {
    id: "brady",
    name: "Sinus bradycardia (vagal predominance)",
    family: "Sinus node",
    status: "preview",
    phase: 2,
    fidelity: "L1+L2 network + tissue graph",
    mechanism: "Increased vagal tone slows SA automaticity and AV nodal conduction.",
    structures: "SA node, AV node.",
    changes: "Vagal tone 0.5 → 0.9.",
    activation: "Unchanged sequence; longer cycle.",
    ecg: "Longer RR; slightly longer PR (AV nodal vagal effect); longer QT through APD restitution.",
    limitations: "Autonomic coefficients are nominal; no direct vagal effect on atrial APD.",
    initiation: "Immediate after the change; the next SA cycle uses the new rate.",
    apply: mod((p) => (p.sinus.vagalTone = 0.9)),
  },
  {
    id: "tachy",
    name: "Sinus tachycardia (sympathetic activation)",
    family: "Sinus node",
    status: "preview",
    phase: 2,
    fidelity: "L1+L2 network + tissue graph",
    mechanism: "Sympathetic activation with vagal withdrawal accelerates SA automaticity and AV nodal conduction.",
    structures: "SA node, AV node.",
    changes: "Vagal 0.5 → 0.1; sympathetic 0.1 → 0.6.",
    activation: "Unchanged sequence; shorter cycle.",
    ecg: "Short RR; PR shortens; QT shortens by restitution; P wave may approach the preceding T wave.",
    limitations: "No β-adrenergic effect on ventricular APD or on contractility; APD adapts within one beat (no slow memory).",
    initiation: "Immediate after the change.",
    apply: mod((p) => {
      p.sinus.vagalTone = 0.1;
      p.sinus.sympatheticTone = 0.6;
    }),
  },
  {
    id: "avb1",
    name: "Prolonged AV nodal conduction (first-degree pattern)",
    family: "AV conduction",
    status: "preview",
    phase: 2,
    fidelity: "L1 conduction network",
    mechanism: "Slower conduction through the compact AV node (longer AH) with 1:1 conduction.",
    structures: "AV node.",
    changes: "Minimum AV nodal conduction time 65 → 180 ms.",
    activation: "Atrial and ventricular sequences unchanged; longer interval between them.",
    ecg: "PR > 200 ms with normal P and QRS.",
    limitations: "Lumped AV node; no dual-pathway physiology or concealed conduction yet (Phase 2–3).",
    initiation: "Immediate.",
    apply: mod((p) => (p.avNode.ahMin = 180)),
  },
  {
    id: "rbb-slow",
    name: "Right bundle branch conduction failure",
    family: "Intraventricular conduction",
    status: "preview",
    phase: 2,
    fidelity: "L1+L2 network + tissue graph",
    mechanism: "Right bundle conduction slowed so much that the RV is activated from the LV across the septum.",
    structures: "Right bundle branch, RV Purkinje network, RV myocardium.",
    changes: "Right bundle CV 1.5 → 0.05 m/s.",
    activation: "Normal LV activation; RV activated late, cell-to-cell across the septum.",
    ecg: "QRS widens; late rightward/anterior forces (terminal R′ in V1, broad S in I/V6) with secondary ST–T changes.",
    limitations: "Block is represented as extreme slowing (no separate block switch yet); RV geometry idealised; V1 morphology depends on electrode position.",
    initiation: "Immediate.",
    apply: mod((p) => (p.hisPurkinje.rbbCv = 0.05)),
  },
  {
    id: "lbb-slow",
    name: "Left bundle branch conduction failure",
    family: "Intraventricular conduction",
    status: "preview",
    phase: 2,
    fidelity: "L1+L2 network + tissue graph",
    mechanism: "Left bundle trunk and fascicles conduct so slowly that the LV is activated from the RV through the septum.",
    structures: "Left bundle branch, LAF, LPF, LV Purkinje network.",
    changes: "LBB, LAF and LPF CV 1.5 → 0.05 m/s.",
    activation: "RV first; septum activated right → left; LV free wall last.",
    ecg: "QRS widens with loss of septal q waves in lateral leads; discordant (secondary) ST–T changes.",
    limitations: "Block represented as extreme slowing; idealised Purkinje topology.",
    initiation: "Immediate.",
    apply: mod((p) => {
      p.hisPurkinje.lbbCv = 0.05;
      p.hisPurkinje.lafCv = 0.05;
      p.hisPurkinje.lpfCv = 0.05;
    }),
  },
  {
    id: "long-apd",
    name: "Prolonged ventricular APD (long-QT pattern)",
    family: "Repolarisation",
    status: "preview",
    phase: 4,
    fidelity: "L1+L2 network + tissue graph",
    mechanism: "Uniform prolongation of ventricular APD (reduced repolarisation reserve as a lumped effect).",
    structures: "Ventricular myocytes.",
    changes: "Ventricular APD90 (CL 1000) 300 → 380 ms.",
    activation: "Unchanged depolarisation; later repolarisation everywhere.",
    ecg: "Longer QT/QTc with unchanged QRS.",
    limitations: "Reduced-order AP: no IKr current, no EADs, cannot produce torsades. Ionic mechanisms are Phase 4.",
    initiation: "Immediate (APD adapts at the next activation).",
    apply: mod((p) => (p.ventricles.apd = 380)),
  },
  // ---- planned (not executable yet) -----------------------------------------
  ...(
    [
      ["Respiratory sinus arrhythmia", "Sinus node", 2],
      ["Sinus arrest / SA exit block with escape", "Sinus node", 2],
      ["Premature atrial contractions", "Atrial", 2],
      ["Focal atrial tachycardia", "Atrial", 3],
      ["Typical atrial flutter", "Atrial", 3],
      ["Atrial fibrillation", "Atrial", 3],
      ["Multifocal atrial tachycardia", "Atrial", 3],
      ["Mobitz I (Wenckebach) from AV nodal recovery dynamics", "AV conduction", 2],
      ["Mobitz II", "AV conduction", 2],
      ["2:1 AV block (subtype not assigned)", "AV conduction", 2],
      ["High-grade and complete AV block with AV dissociation", "AV conduction", 2],
      ["AVNRT (dual AV nodal pathways)", "Reentrant SVT", 3],
      ["Orthodromic / antidromic AVRT; WPW pre-excitation", "Reentrant SVT", 3],
      ["PVCs, bigeminy, trigeminy", "Ventricular", 2],
      ["Monomorphic VT (scar reentry)", "Ventricular", 3],
      ["Polymorphic VT / torsades de pointes", "Ventricular", 4],
      ["Ventricular fibrillation", "Ventricular", 3],
      ["Left anterior / posterior fascicular block", "Intraventricular conduction", 2],
      ["IKr inhibition, EAD/DAD triggered activity", "Repolarisation", 4],
      ["Hyper-/hypokalaemia, hyper-/hypocalcaemia", "Repolarisation", 4],
      ["Ischaemic ST–T changes", "Additional", 5],
      ["Brugada pattern; CPVT-like triggered activity", "Additional", 5],
      ["Cardiac pacing and capture", "Additional", 2],
    ] as [string, string, number][]
  ).map(
    ([name, family, phase], i): Scenario => ({
      id: `planned-${i}`,
      name,
      family,
      status: "planned",
      phase,
      fidelity: phase >= 4 ? "L3 ionic" : "L1+L2 network + tissue graph",
      mechanism: "Not implemented yet.",
      structures: "",
      changes: "",
      activation: "",
      ecg: "",
      limitations: `Scheduled for Phase ${phase}; see docs/ROADMAP.md.`,
      initiation: "",
    }),
  ),
];
