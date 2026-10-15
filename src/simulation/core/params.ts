/**
 * Single typed, serialisable simulation-state parameter model.
 *
 * Every adjustable physiological quantity lives here. Each parameter carries metadata
 * (units, range, reference value, affected structure, mechanism, expected ECG effect and
 * an evidence tag). Evidence tags are deliberately conservative:
 *   - "literature": default taken from, or directly anchored to, a cited human measurement
 *   - "calibrated": tuned so that a cited emergent quantity (e.g. AH, HV, QT) falls in range
 *   - "nominal":    plausible teaching value with NO direct data source; treat as a free parameter
 * See docs/PARAMETER_DEPENDENCIES.md and docs/REFERENCES.md.
 */

export interface SimParams {
  schemaVersion: 1;
  seed: number;
  sinus: {
    intrinsicRate: number; // bpm, after autonomic blockade
    vagalTone: number; // 0..1
    sympatheticTone: number; // 0..1
    exitDelay: number; // ms, SA node -> perinodal atrium
  };
  escape: {
    junctionalRate: number; // bpm
    ventricularRate: number; // bpm
  };
  atria: {
    cv: number; // m/s (== mm/ms)
    fastPathFactor: number; // CV multiplier in Bachmann's bundle and crista terminalis
    apd: number; // ms, APD90 at CL 1000 ms
    erpRatio: number; // ERP / APD90
  };
  avNode: {
    ahMin: number; // ms, fully recovered AV nodal conduction time
    recoveryAmplitude: number; // ms, extra delay at R = ERP
    recoveryTau: number; // ms, recovery time constant
    erp: number; // ms, functional refractoriness measured as H-to-A recovery time
    retrograde: boolean;
  };
  hisPurkinje: {
    hisDelay: number; // ms, His bundle conduction time
    lbbCv: number; // m/s
    rbbCv: number; // m/s
    lafCv: number; // m/s
    lpfCv: number; // m/s
    purkinjeCv: number; // m/s, distal network
    pmjDelay: number; // ms, Purkinje-muscle junction delay
    apd: number; // ms, APD90 at CL 1000
  };
  ventricles: {
    cvLongitudinal: number; // m/s along fibres
    anisotropyRatio: number; // CV_long / CV_trans
    apd: number; // ms, reference APD90 at CL 1000 (mid-wall, mid-level)
    transmuralGradient: number; // ms, APD(endo) - APD(epi)
    apicobasalGradient: number; // ms, APD(apex) - APD(base)
    erpRatio: number; // ERP / APD90
    electrotonicSmoothing: number; // mm, Gaussian radius used to smooth intrinsic APD map
  };
  restitution: {
    cvAmplitude: number; // fractional CV reduction at DI -> 0
    cvTau: number; // ms
  };
  forward: {
    limbGain: number; // dimensionless torso transfer factor for limb electrodes
    precordialGain: number; // dimensionless torso transfer factor for chest electrodes
  };
}

export const DEFAULT_PARAMS: SimParams = {
  schemaVersion: 1,
  seed: 1,
  sinus: { intrinsicRate: 92, vagalTone: 0.5, sympatheticTone: 0.1, exitDelay: 10 },
  escape: { junctionalRate: 45, ventricularRate: 30 },
  atria: { cv: 0.9, fastPathFactor: 1.6, apd: 220, erpRatio: 0.95 },
  avNode: { ahMin: 65, recoveryAmplitude: 180, recoveryTau: 90, erp: 300, retrograde: true },
  hisPurkinje: {
    hisDelay: 18,
    lbbCv: 1.5,
    rbbCv: 1.5,
    lafCv: 1.5,
    lpfCv: 1.5,
    purkinjeCv: 3.0,
    pmjDelay: 8,
    apd: 330,
  },
  ventricles: {
    cvLongitudinal: 0.6,
    anisotropyRatio: 2.0,
    apd: 300,
    transmuralGradient: 25,
    apicobasalGradient: -30,
    erpRatio: 0.92,
    electrotonicSmoothing: 4,
  },
  restitution: { cvAmplitude: 0.5, cvTau: 30 },
  forward: { limbGain: 2.5, precordialGain: 0.8 },
};

export type Evidence = "literature" | "calibrated" | "nominal";

export interface ParamMeta {
  path: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  group: string;
  /** Anatomical structure or cellular mechanism affected. */
  structure: string;
  /** What the parameter does inside the model (mechanism, not a clinical claim). */
  mechanism: string;
  /** Predicted direction of effect on activation/recovery timing and ECG. */
  prediction: string;
  evidence: Evidence;
  source: string;
  /** Approximate physiological range used for warnings (inclusive). */
  physiologic?: [number, number];
  /** Integer-only or boolean switch. */
  kind?: "number" | "boolean";
}

export const PARAM_GROUPS = [
  "Pacemaker function",
  "Atrial properties",
  "AV nodal function",
  "His–Purkinje system",
  "Ventricular electrophysiology",
  "Restitution",
  "ECG forward model",
] as const;

export const PARAM_META: ParamMeta[] = [
  // ---- Pacemaker -------------------------------------------------------
  {
    path: "sinus.intrinsicRate",
    label: "Intrinsic SA node rate",
    unit: "bpm",
    min: 30,
    max: 200,
    step: 1,
    group: "Pacemaker function",
    structure: "Sinoatrial node (automaticity, phase 4 depolarisation)",
    mechanism:
      "Sets the SA node firing rate after autonomic blockade. The effective rate is this value modulated by vagal and sympathetic tone.",
    prediction: "Higher rate → shorter RR; APDs shorten by restitution, so QT shortens; PR may lengthen slightly via AV nodal recovery.",
    evidence: "literature",
    source: "Jose & Collison 1970: IHR ≈ 118.1 − 0.57 × age (≈ 92 bpm at 45 y).",
    physiologic: [50, 140],
  },
  {
    path: "sinus.vagalTone",
    label: "Vagal tone",
    unit: "0–1",
    min: 0,
    max: 1,
    step: 0.01,
    group: "Pacemaker function",
    structure: "SA node and AV node (muscarinic modulation)",
    mechanism:
      "Slows SA automaticity and lengthens AV nodal conduction time and refractoriness. Coefficients are nominal; this is a lumped index, not a dose of acetylcholine.",
    prediction: "Slower sinus rate; longer AH and PR.",
    evidence: "nominal",
    source: "Direction of effect is textbook physiology; magnitudes are not data-derived.",
  },
  {
    path: "sinus.sympatheticTone",
    label: "Sympathetic tone",
    unit: "0–1",
    min: 0,
    max: 1,
    step: 0.01,
    group: "Pacemaker function",
    structure: "SA node and AV node (β-adrenergic modulation)",
    mechanism:
      "Accelerates SA automaticity and shortens AV nodal conduction time and refractoriness. Direct β-adrenergic effects on ventricular APD are not modelled in Phase 1.",
    prediction: "Faster sinus rate; shorter AH and PR; QT shortens only through rate (restitution).",
    evidence: "nominal",
    source: "Direction of effect is textbook physiology; magnitudes are not data-derived.",
  },
  {
    path: "sinus.exitDelay",
    label: "Sinus exit conduction time",
    unit: "ms",
    min: 0,
    max: 150,
    step: 1,
    group: "Pacemaker function",
    structure: "SA node → perinodal atrial myocardium",
    mechanism: "Delay between SA node depolarisation and excitation of the atrial exit sites.",
    prediction: "Not visible on the surface ECG at constant rate (SA depolarisation itself is ECG-silent); shifts all downstream events.",
    evidence: "nominal",
    source: "No direct surface-ECG correlate; value chosen as a placeholder.",
  },
  {
    path: "escape.junctionalRate",
    label: "Junctional escape rate",
    unit: "bpm",
    min: 20,
    max: 80,
    step: 1,
    group: "Pacemaker function",
    structure: "Proximal His bundle / AV junction (latent pacemaker)",
    mechanism: "Latent automaticity, reset by every conducted beat (overdrive reset). Fires only if no activation reaches it for one escape cycle.",
    prediction: "No effect in normal sinus rhythm (it is reset each beat). Becomes visible if sinus or AV conduction fails.",
    evidence: "nominal",
    source: "Conventional teaching range 40–60 bpm; not fitted to data.",
  },
  {
    path: "escape.ventricularRate",
    label: "Ventricular escape rate",
    unit: "bpm",
    min: 10,
    max: 60,
    step: 1,
    group: "Pacemaker function",
    structure: "Distal left posterior Purkinje fibres (latent pacemaker)",
    mechanism: "Latent automaticity, reset by every activation that reaches it.",
    prediction: "No effect in normal sinus rhythm.",
    evidence: "nominal",
    source: "Conventional teaching range 20–40 bpm; not fitted to data.",
  },
  // ---- Atria -------------------------------------------------------------
  {
    path: "atria.cv",
    label: "Atrial conduction velocity",
    unit: "m/s",
    min: 0.1,
    max: 2.0,
    step: 0.01,
    group: "Atrial properties",
    structure: "Right and left atrial working myocardium",
    mechanism: "Speed of the atrial activation wavefront (isotropic in Phase 1).",
    prediction: "Lower CV → longer total atrial activation → wider P wave and longer PA/PR interval.",
    evidence: "literature",
    source: "van Schie et al. 2021: median atrial CV ≈ 0.9 m/s in sinus rhythm (epicardial high-density mapping).",
    physiologic: [0.4, 1.4],
  },
  {
    path: "atria.fastPathFactor",
    label: "Bachmann / crista CV factor",
    unit: "×",
    min: 0.5,
    max: 3,
    step: 0.05,
    group: "Atrial properties",
    structure: "Bachmann's bundle (interatrial) and crista terminalis",
    mechanism: "Multiplies atrial CV inside the preferential pathways. Below 1, interatrial conduction becomes slower than surrounding tissue.",
    prediction: "Lower factor → later left-atrial activation → longer, possibly notched P wave (inter-atrial delay).",
    evidence: "nominal",
    source: "Preferential conduction is established; the multiplier value is not data-derived.",
  },
  {
    path: "atria.apd",
    label: "Atrial APD90 (CL 1000 ms)",
    unit: "ms",
    min: 100,
    max: 400,
    step: 1,
    group: "Atrial properties",
    structure: "Atrial myocyte action potential",
    mechanism: "Reference atrial APD; rate dependence follows the shared restitution map.",
    prediction: "Shifts the atrial repolarisation (Ta) wave, which is mostly hidden in the PR segment and QRS.",
    evidence: "nominal",
    source: "Placeholder value; Phase 4 will anchor to a published human atrial model.",
  },
  {
    path: "atria.erpRatio",
    label: "Atrial ERP / APD90",
    unit: "ratio",
    min: 0.6,
    max: 1.3,
    step: 0.01,
    group: "Atrial properties",
    structure: "Atrial refractoriness",
    mechanism: "Effective refractory period expressed relative to APD90.",
    prediction: "No surface effect in sinus rhythm; matters for premature beats and reentry (Phase 2–3).",
    evidence: "nominal",
    source: "Placeholder ratio.",
  },
  // ---- AV node ------------------------------------------------------------
  {
    path: "avNode.ahMin",
    label: "Minimum AV nodal conduction time",
    unit: "ms",
    min: 30,
    max: 400,
    step: 1,
    group: "AV nodal function",
    structure: "Compact AV node (AH interval)",
    mechanism: "AH at full recovery. Actual AH = AHmin + amplitude × exp(−(R − ERP)/τ), where R is the H-to-A recovery time.",
    prediction: "Longer → longer PR with unchanged P and QRS (first-degree AV block pattern when PR > 200 ms).",
    evidence: "calibrated",
    source: "Calibrated so that the emergent AH ≈ 76 ± 16 ms (Lee & Lien 1975, normal adults).",
    physiologic: [45, 130],
  },
  {
    path: "avNode.recoveryAmplitude",
    label: "AV nodal recovery amplitude",
    unit: "ms",
    min: 0,
    max: 500,
    step: 1,
    group: "AV nodal function",
    structure: "AV nodal recovery (decremental conduction)",
    mechanism: "Extra conduction delay when an impulse arrives just after the nodal ERP (recovery-curve height).",
    prediction: "Larger → stronger rate-dependent PR prolongation; at short cycle lengths may produce progressive PR lengthening.",
    evidence: "nominal",
    source: "Model form after Sun et al. 1995 (recovery term only); value not fitted to human data.",
  },
  {
    path: "avNode.recoveryTau",
    label: "AV nodal recovery time constant",
    unit: "ms",
    min: 10,
    max: 400,
    step: 1,
    group: "AV nodal function",
    structure: "AV nodal recovery kinetics",
    mechanism: "Speed of recovery of AV nodal conduction after the previous beat.",
    prediction: "Longer τ → PR more sensitive to heart rate.",
    evidence: "nominal",
    source: "Model form after Sun et al. 1995; value not fitted to human data.",
  },
  {
    path: "avNode.erp",
    label: "AV nodal ERP",
    unit: "ms",
    min: 100,
    max: 800,
    step: 1,
    group: "AV nodal function",
    structure: "AV nodal refractoriness",
    mechanism: "Impulses arriving with H-to-A recovery time shorter than ERP are blocked in the node.",
    prediction: "If ERP exceeds the available recovery time, atrial impulses fail to conduct (non-conducted P waves).",
    evidence: "nominal",
    source: "Placeholder value.",
  },
  // ---- His-Purkinje ------------------------------------------------------
  {
    path: "hisPurkinje.hisDelay",
    label: "His bundle conduction time",
    unit: "ms",
    min: 5,
    max: 80,
    step: 1,
    group: "His–Purkinje system",
    structure: "Penetrating and branching His bundle",
    mechanism: "Conduction time along the His bundle from AV node exit to the bifurcation.",
    prediction: "Longer → longer HV and PR; QRS unchanged.",
    evidence: "literature",
    source: "His potential duration 19 ± 3 ms (Lee & Lien 1975).",
    physiologic: [10, 30],
  },
  {
    path: "hisPurkinje.lbbCv",
    label: "Left bundle branch CV",
    unit: "m/s",
    min: 0.05,
    max: 4,
    step: 0.01,
    group: "His–Purkinje system",
    structure: "Left bundle branch trunk and septal fibres",
    mechanism: "Conduction velocity in the left bundle trunk and left septal fascicle.",
    prediction: "Lower → delayed LV activation; septum activated from the right; QRS widens with LBBB-like morphology when severe.",
    evidence: "nominal",
    source: "Order of magnitude for conduction-system tissue; together with the other HPS values calibrated so that HV ≈ 45 ± 6 ms (Lee & Lien 1975).",
  },
  {
    path: "hisPurkinje.rbbCv",
    label: "Right bundle branch CV",
    unit: "m/s",
    min: 0.05,
    max: 4,
    step: 0.01,
    group: "His–Purkinje system",
    structure: "Right bundle branch and moderator band",
    mechanism: "Conduction velocity in the right bundle branch.",
    prediction: "Lower → delayed RV activation; terminal rightward/anterior forces; QRS widens with RBBB-like morphology when severe.",
    evidence: "nominal",
    source: "Order of magnitude; calibrated with HV.",
  },
  {
    path: "hisPurkinje.lafCv",
    label: "Left anterior fascicle CV",
    unit: "m/s",
    min: 0.05,
    max: 4,
    step: 0.01,
    group: "His–Purkinje system",
    structure: "Left anterior fascicle",
    mechanism: "Conduction velocity in the anterior fascicle of the left bundle.",
    prediction: "Lower → anterolateral LV activated late → leftward/superior shift of the frontal QRS axis.",
    evidence: "nominal",
    source: "Order of magnitude; calibrated with HV.",
  },
  {
    path: "hisPurkinje.lpfCv",
    label: "Left posterior fascicle CV",
    unit: "m/s",
    min: 0.05,
    max: 4,
    step: 0.01,
    group: "His–Purkinje system",
    structure: "Left posterior fascicle",
    mechanism: "Conduction velocity in the posterior fascicle of the left bundle.",
    prediction: "Lower → inferoposterior LV activated late → rightward/inferior shift of the frontal QRS axis.",
    evidence: "nominal",
    source: "Order of magnitude; calibrated with HV.",
  },
  {
    path: "hisPurkinje.purkinjeCv",
    label: "Purkinje network CV",
    unit: "m/s",
    min: 0.2,
    max: 6,
    step: 0.01,
    group: "His–Purkinje system",
    structure: "Distal Purkinje network (LV and RV)",
    mechanism: "Speed of the subendocardial Purkinje network that distributes activation to the endocardium.",
    prediction: "Lower → slower spread over the endocardium → wider QRS without a bundle-branch pattern.",
    evidence: "nominal",
    source: "Order of magnitude for Purkinje fibres; not fitted to human data.",
  },
  {
    path: "hisPurkinje.pmjDelay",
    label: "Purkinje–muscle junction delay",
    unit: "ms",
    min: 0,
    max: 30,
    step: 0.5,
    group: "His–Purkinje system",
    structure: "Purkinje–myocardial junctions",
    mechanism: "Delay for current to cross from Purkinje terminals into working myocardium.",
    prediction: "Longer → longer HV; small QRS effects.",
    evidence: "nominal",
    source: "Placeholder value.",
  },
  {
    path: "hisPurkinje.apd",
    label: "Purkinje APD90 (CL 1000 ms)",
    unit: "ms",
    min: 150,
    max: 600,
    step: 1,
    group: "His–Purkinje system",
    structure: "Purkinje cell action potential",
    mechanism: "Reference APD of conduction-system cells; sets their refractoriness.",
    prediction: "No surface-ECG effect in sinus rhythm (Purkinje mass is ECG-negligible in this model).",
    evidence: "nominal",
    source: "Purkinje APD exceeding ventricular APD is established qualitatively; value is a placeholder.",
  },
  // ---- Ventricles ----------------------------------------------------------
  {
    path: "ventricles.cvLongitudinal",
    label: "Ventricular CV (along fibres)",
    unit: "m/s",
    min: 0.1,
    max: 1.5,
    step: 0.01,
    group: "Ventricular electrophysiology",
    structure: "Ventricular working myocardium",
    mechanism: "Wavefront speed along the local fibre direction; transverse speed = this / anisotropy ratio.",
    prediction: "Lower → slower myocardial spread → wider QRS, lower-frequency QRS content, secondary T changes.",
    evidence: "nominal",
    source: "Order of magnitude summarised by Kléber & Rudy 2004; not fitted to a specific human dataset.",
    physiologic: [0.3, 1.0],
  },
  {
    path: "ventricles.anisotropyRatio",
    label: "Anisotropy ratio (long/trans)",
    unit: "×",
    min: 1,
    max: 5,
    step: 0.1,
    group: "Ventricular electrophysiology",
    structure: "Myocardial fibre architecture (helical rotation endo → epi)",
    mechanism: "Ratio of longitudinal to transverse conduction velocity.",
    prediction: "Higher → slower transmural spread → wider QRS.",
    evidence: "nominal",
    source: "Placeholder; human in-vivo anisotropy ratios are variable.",
  },
  {
    path: "ventricles.apd",
    label: "Ventricular APD90 (CL 1000 ms)",
    unit: "ms",
    min: 150,
    max: 600,
    step: 1,
    group: "Ventricular electrophysiology",
    structure: "Ventricular myocyte action potential (all regions)",
    mechanism: "Reference APD90 at mid-wall/mid-level; regional values add the gradients below. Rate dependence: restitution map fitted to Franz 1988.",
    prediction: "Longer → later ventricular repolarisation → longer QT/QTc.",
    evidence: "calibrated",
    source: "Calibrated to give QTc ≈ 400 ms at ~65 bpm; order of magnitude consistent with human MAP data (Franz 1988).",
    physiologic: [220, 380],
  },
  {
    path: "ventricles.transmuralGradient",
    label: "Transmural APD gradient (endo − epi)",
    unit: "ms",
    min: -80,
    max: 120,
    step: 1,
    group: "Ventricular electrophysiology",
    structure: "Transmural heterogeneity of repolarisation",
    mechanism: "Endocardial APD exceeds epicardial APD by this amount (linear across the wall).",
    prediction: "Positive values make epicardium repolarise first → upright (concordant) T waves; reducing or reversing flattens or inverts T.",
    evidence: "calibrated",
    source: "Franz et al. 1987: epicardial RT ≈ 81 % vs endocardial ≈ 87 % of QT; value chosen to reproduce a similar RT difference.",
  },
  {
    path: "ventricles.apicobasalGradient",
    label: "Apicobasal APD gradient (apex − base)",
    unit: "ms",
    min: -80,
    max: 120,
    step: 1,
    group: "Ventricular electrophysiology",
    structure: "Apex-to-base heterogeneity of repolarisation",
    mechanism: "Apical APD exceeds basal APD by this amount.",
    prediction: "Positive values favour base-before-apex repolarisation and concordant T waves in inferolateral leads.",
    evidence: "nominal",
    source: "Direction consistent with Franz et al. 1987 (apicoseptal sites: shortest activation time, longest APD); magnitude not fitted.",
  },
  {
    path: "ventricles.erpRatio",
    label: "Ventricular ERP / APD90",
    unit: "ratio",
    min: 0.6,
    max: 1.3,
    step: 0.01,
    group: "Ventricular electrophysiology",
    structure: "Ventricular refractoriness",
    mechanism: "Effective refractory period expressed relative to APD90.",
    prediction: "No surface effect in sinus rhythm; matters for premature beats and reentry (Phase 2–3).",
    evidence: "nominal",
    source: "Placeholder ratio.",
  },
  {
    path: "ventricles.electrotonicSmoothing",
    label: "Electrotonic APD smoothing radius",
    unit: "mm",
    min: 0,
    max: 15,
    step: 0.5,
    group: "Ventricular electrophysiology",
    structure: "Gap-junction coupling (proxy)",
    mechanism:
      "Gaussian smoothing of the intrinsic APD map. A proxy for electrotonic coupling, which the activation-time (eikonal-type) model does not compute.",
    prediction: "Larger → sharper gradients are blunted → smaller T-wave amplitude.",
    evidence: "nominal",
    source: "Modelling device, not a physiological measurement.",
  },
  // ---- Restitution ----------------------------------------------------------
  {
    path: "restitution.cvAmplitude",
    label: "CV restitution depth",
    unit: "fraction",
    min: 0,
    max: 0.9,
    step: 0.01,
    group: "Restitution",
    structure: "Sodium-channel availability (proxy)",
    mechanism: "Fractional CV reduction when the wave invades tissue at very short diastolic interval: CV = CVmax·(1 − a·exp(−DI/τ)).",
    prediction: "No effect in sinus rhythm (long DIs); matters for premature beats and reentry.",
    evidence: "nominal",
    source: "Functional form is standard; values not fitted.",
  },
  {
    path: "restitution.cvTau",
    label: "CV restitution time constant",
    unit: "ms",
    min: 5,
    max: 200,
    step: 1,
    group: "Restitution",
    structure: "Recovery of excitability",
    mechanism: "Time constant of CV recovery with diastolic interval.",
    prediction: "No effect in sinus rhythm.",
    evidence: "nominal",
    source: "Functional form is standard; value not fitted.",
  },
  // ---- Forward model ----------------------------------------------------------
  {
    path: "forward.limbGain",
    label: "Limb-lead torso transfer factor",
    unit: "×",
    min: 0.5,
    max: 8,
    step: 0.1,
    group: "ECG forward model",
    structure: "Volume conductor (torso boundary effect, proxy)",
    mechanism:
      "Scales potentials at RA/LA/LL. The infinite homogeneous conductor under-estimates distant (limb) potentials relative to a bounded torso; this scalar partly compensates.",
    prediction: "Changes limb-lead amplitudes only; timing and morphology unchanged.",
    evidence: "calibrated",
    source: "Calibrated so limb-lead QRS amplitudes are of typical adult magnitude (~0.5–1.5 mV).",
  },
  {
    path: "forward.precordialGain",
    label: "Chest-lead torso transfer factor",
    unit: "×",
    min: 0.5,
    max: 8,
    step: 0.1,
    group: "ECG forward model",
    structure: "Volume conductor (torso boundary effect, proxy)",
    mechanism: "Scales potentials at V1–V6 before the Wilson central terminal is subtracted.",
    prediction: "Changes precordial amplitudes; morphology unchanged.",
    evidence: "calibrated",
    source: "Calibrated so precordial QRS amplitudes are of typical adult magnitude (~1–3 mV).",
  },
];

export const META_BY_PATH: Record<string, ParamMeta> = Object.fromEntries(PARAM_META.map((m) => [m.path, m]));

export function getParam(p: SimParams, path: string): number | boolean {
  const [g, k] = path.split(".");
  return (p as unknown as Record<string, Record<string, number | boolean>>)[g][k];
}

export function setParam(p: SimParams, path: string, value: number | boolean): SimParams {
  const [g, k] = path.split(".");
  const rec = p as unknown as Record<string, Record<string, number | boolean>>;
  return { ...p, [g]: { ...rec[g], [k]: value } } as SimParams;
}

export function cloneParams(p: SimParams): SimParams {
  return JSON.parse(JSON.stringify(p)) as SimParams;
}

/** Validate an imported object against the schema; fills missing fields with defaults. */
export function sanitizeParams(raw: unknown): SimParams {
  const out = cloneParams(DEFAULT_PARAMS);
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.seed === "number") out.seed = r.seed;
  for (const m of PARAM_META) {
    const [g, k] = m.path.split(".");
    const grp = r[g] as Record<string, unknown> | undefined;
    const v = grp?.[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      (out as unknown as Record<string, Record<string, number>>)[g][k] = Math.min(m.max, Math.max(m.min, v));
    }
  }
  const avn = r.avNode as Record<string, unknown> | undefined;
  if (typeof avn?.retrograde === "boolean") out.avNode.retrograde = avn.retrograde;
  return out;
}

/** List of parameter paths whose values differ between two parameter sets. */
export function diffParams(a: SimParams, b: SimParams): { path: string; a: number | boolean; b: number | boolean }[] {
  const out: { path: string; a: number | boolean; b: number | boolean }[] = [];
  for (const m of PARAM_META) {
    const va = getParam(a, m.path);
    const vb = getParam(b, m.path);
    if (va !== vb) out.push({ path: m.path, a: va, b: vb });
  }
  if (a.avNode.retrograde !== b.avNode.retrograde)
    out.push({ path: "avNode.retrograde", a: a.avNode.retrograde, b: b.avNode.retrograde });
  return out;
}
