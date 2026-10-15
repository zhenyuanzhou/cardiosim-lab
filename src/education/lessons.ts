/**
 * Guided lessons (spec §8.2). Each lesson = objective, starting state, one manipulation,
 * expected findings, mechanism and a short quiz. Starting states and manipulations are
 * parameter sets; the ECG is always recomputed by the simulator.
 */
import { DEFAULT_PARAMS, cloneParams, type SimParams } from "../simulation/core/params";

export interface QuizItem {
  q: string;
  options: string[];
  answer: number;
  why: string;
}
export interface Lesson {
  id: string;
  title: string;
  objective: string;
  mode: "simulator" | "explorer" | "split";
  leads: string[];
  start: (p: SimParams) => void;
  manipulation?: { label: string; apply: (p: SimParams) => void };
  expected: string[];
  mechanism: string;
  fidelity: string;
  quiz: QuizItem[];
}

export const baseParams = (f?: (p: SimParams) => void) => {
  const p = cloneParams(DEFAULT_PARAMS);
  f?.(p);
  return p;
};

export const LESSONS: Lesson[] = [
  {
    id: "L1",
    title: "Why the P wave is positive in lead II",
    objective: "Relate the direction of atrial activation to the sign of the P wave in a lead.",
    mode: "explorer",
    leads: ["II", "aVR"],
    start: () => {},
    manipulation: {
      label: "Move the atrial origin to the low right atrium (ectopic atrial rhythm)",
      apply: (p) => (p.ectopy = { ...p.ectopy, site: "ra-low", pattern: "focus", rate: 80, coupling: 300 }),
    },
    expected: [
      "Sinus rhythm: atrial activation runs from the high right atrium downward and leftward; the atrial vector points toward the positive pole of II (+60°) → upright P in II.",
      "Low-atrial origin: activation runs upward → the P wave becomes negative in II, III and aVF.",
    ],
    mechanism: "A lead records a positive deflection while the net activation vector has a component along the lead's positive direction (dipole approximation; exact for the limb leads in this model).",
    fidelity: "Mechanistic atrial activation sequence; dipole projection exact for limb leads.",
    quiz: [
      {
        q: "During sinus rhythm the atrial vector points roughly to +50° to +60°. Which limb lead shows the most negative P?",
        options: ["Lead I", "Lead II", "aVR", "aVL"],
        answer: 2,
        why: "aVR's positive pole is at −150°, almost opposite +60°, so the projection is negative.",
      },
    ],
  },
  {
    id: "L2",
    title: "Why aVR is negative",
    objective: "See that aVR is (nearly) the inverse of lead II because their axes are ~150–210° apart.",
    mode: "explorer",
    leads: ["II", "aVR"],
    start: () => {},
    expected: ["P, QRS and T in aVR are mirror images of those in II (scaled).", "The identity aVR = −(I + II)/2 holds exactly in the simulated signals."],
    mechanism: "aVR = RA − (LA + LL)/2. Its lead vector points to −150°, so any vector directed inferiorly and leftward projects negatively.",
    fidelity: "Exact (Einthoven/Goldberger identities hold to numerical precision).",
    quiz: [
      {
        q: "Which identity holds for the simulated limb leads?",
        options: ["aVR = (I + II)/2", "aVR = −(I + II)/2", "aVR = II − I", "aVR = −III"],
        answer: 1,
        why: "aVR = RA − (LA+LL)/2 = −(I + II)/2.",
      },
    ],
  },
  {
    id: "L3",
    title: "How the QRS complex is generated",
    objective: "Follow ventricular activation and the heart vector through the QRS in II, V1 and V6.",
    mode: "split",
    leads: ["II", "V1", "V6"],
    start: () => {},
    expected: [
      "Early QRS: left-septal activation (left → right, anterior) → small q in V6/I, small r in V1.",
      "Mid QRS: free-wall activation dominated by the LV → large R in V5–V6/II, S in V1.",
      "Late QRS: posterobasal regions → small terminal forces.",
    ],
    mechanism: "The ECG is the lead-field-weighted sum of spatial gradients of Vm: only cells in their upstroke (the wavefront) contribute during the QRS.",
    fidelity: "Reduced-order; morphology qualitatively matched, V2–V3 deep S is a known model deviation.",
    quiz: [
      {
        q: "Which cells contribute to the ECG at a given instant of the QRS?",
        options: ["All depolarised cells equally", "Mainly cells at the activation wavefront (large Vm gradients)", "Only Purkinje cells", "Only cells under the electrode"],
        answer: 1,
        why: "The source is −σ∇Vm; it is large only where Vm changes in space, i.e. at the wavefront.",
      },
    ],
  },
  {
    id: "L4",
    title: "RBBB in V1 and the lateral leads",
    objective: "Explain the late R′ in V1 and the broad terminal S in I/V6 from delayed RV activation.",
    mode: "split",
    leads: ["V1", "V6", "I"],
    start: () => {},
    manipulation: { label: "Block the right bundle", apply: (p) => (p.hisPurkinje.rbbBlock = true) },
    expected: [
      "Initial QRS unchanged (left septal activation still first).",
      "Terminal forces anterior and rightward → late positive deflection in V1, terminal S in I and V6.",
      "ST–T opposite to the terminal QRS (secondary repolarisation change).",
    ],
    mechanism: "With the right bundle blocked the RV is activated by slow trans-septal myocardial conduction after the LV.",
    fidelity: "Mechanistic block; QRS widening is less than in typical clinical RBBB and the frontal axis is distorted (documented limitation).",
    quiz: [
      {
        q: "Why is the initial part of the QRS unchanged in RBBB?",
        options: ["Because the RV activates first", "Because septal activation from the left bundle is intact", "Because the AV node is slowed", "Because RBBB only affects repolarisation"],
        answer: 1,
        why: "The left septal surface is still activated first by the left bundle.",
      },
    ],
  },
  {
    id: "L5",
    title: "AV-nodal slowing prolongs PR",
    objective: "Show that slowing AV-nodal conduction lengthens PR without changing P or QRS.",
    mode: "simulator",
    leads: ["II"],
    start: () => {},
    manipulation: { label: "AV nodal conduction time 65 → 180 ms", apply: (p) => (p.avNode.ahMin = 180) },
    expected: ["PR increases by ≈ the AH change (first-degree AV block pattern when PR > 200 ms).", "P-wave and QRS morphology unchanged."],
    mechanism: "AV-nodal conduction is ECG-silent; it shows up only as a longer isoelectric PR segment.",
    fidelity: "Lumped AV-node model (recovery-dependent delay); AH calibrated to human data.",
    quiz: [
      {
        q: "Which part of the PR interval reflects AV-nodal conduction?",
        options: ["P wave", "PR segment (mostly)", "QRS", "ST segment"],
        answer: 1,
        why: "Nodal and His–Purkinje conduction occur during the isoelectric PR segment.",
      },
    ],
  },
  {
    id: "L6",
    title: "Ectopic origin changes the QRS",
    objective: "Relate the site of ventricular origin to QRS width and axis.",
    mode: "split",
    leads: ["II", "V1", "V6"],
    start: () => {},
    manipulation: {
      label: "Activate the ventricles from the RV apex",
      apply: (p) => (p.ectopy = { ...p.ectopy, site: "rv-apex", pattern: "focus", rate: 82, coupling: 300 }),
    },
    expected: ["Wide QRS (slow myocardial conduction instead of the Purkinje network).", "Superior axis (activation from apex to base) and LBBB-like V1."],
    mechanism: "QRS duration reflects total ventricular activation time; the heart vector follows the bulk wavefront direction.",
    fidelity: "Mechanistic activation sequence.",
    quiz: [
      {
        q: "Why is a ventricular-origin QRS wide?",
        options: ["Higher amplitude", "Activation spreads cell-to-cell through myocardium (≈0.3–0.6 m/s) instead of the fast Purkinje network", "Longer action potentials", "The AV node is refractory"],
        answer: 1,
        why: "Myocardial conduction is several times slower than Purkinje conduction.",
      },
    ],
  },
  {
    id: "L7",
    title: "Repolarising-current reduction and QT",
    objective: "See that longer ventricular action potentials lengthen QT without changing QRS.",
    mode: "simulator",
    leads: ["II", "V5"],
    start: () => {},
    manipulation: { label: "Increase ventricular APD by 25 % (reduced-order IKr-block proxy)", apply: (p) => (p.ventricles.apd = 375) },
    expected: ["QT (and the latest recovery time) increase; QRS unchanged.", "Local APD90 is not the surface QT: QT spans earliest activation to latest recovery."],
    mechanism: "The T wave ends when the last region recovers; prolonging APD everywhere delays it.",
    fidelity: "Reduced-order APD scaling — not an ionic IKr model (TP06 ionic layer planned).",
    quiz: [
      {
        q: "Surface QT corresponds most closely to…",
        options: ["The APD90 of one cell", "Earliest ventricular activation to latest ventricular recovery", "The T-wave peak", "The ST segment"],
        answer: 1,
        why: "QT is a whole-heart quantity spanning activation and recovery dispersion.",
      },
    ],
  },
  {
    id: "L8",
    title: "Repolarisation heterogeneity shapes the T wave",
    objective: "Explain why the normal T wave is concordant with the QRS.",
    mode: "split",
    leads: ["II", "V2", "V5"],
    start: () => {},
    manipulation: {
      label: "Remove transmural and apicobasal APD gradients",
      apply: (p) => {
        p.ventricles.transmuralGradient = 0;
        p.ventricles.apicobasalGradient = 0;
      },
    },
    expected: ["Without gradients recovery follows activation order → T opposite to the QRS (discordant).", "With epi < endo APD, epicardium recovers first despite later activation → concordant T."],
    mechanism: "The T wave is generated by spatial differences in recovery time (repolarisation gradients).",
    fidelity: "Reduced-order APD map.",
    quiz: [
      {
        q: "Why is the normal T wave upright in V5 although the epicardium is activated last?",
        options: ["The epicardium has a shorter APD and recovers first", "The T wave reflects activation", "Purkinje fibres repolarise last", "Lead V5 is unipolar"],
        answer: 0,
        why: "Shorter epicardial APD reverses the recovery sequence relative to activation.",
      },
    ],
  },
];
