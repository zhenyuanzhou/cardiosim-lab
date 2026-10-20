# Changelog

## [1.7.2] — 2026-10-19

Licensing. The project had no licence file, which on a public repository means all rights reserved
by default.

- Released under **CC BY-NC 4.0** (SPDX `CC-BY-NC-4.0`). `LICENSE` carries the verbatim legal code
  as published by Creative Commons; `NOTICE` carries the copyright line, the SPDX identifier and the
  scope.
- `NOTICE` states what the licence does **not** reach: third-party dependencies, which keep their own
  permissive licences and remain under them even when inlined into a standalone build; and published
  literature cited in `docs/REFERENCES.md`, where the calibration values are facts but the papers are
  their publishers'.
- The licence is shown in the About tab and summarised in the README.
- Note for anyone reusing this: Creative Commons advise against CC licences for software, because
  they do not address source distribution, patent grants or warranty terms the way software licences
  do. CC BY-NC is used here deliberately for a teaching model; a project wanting the same
  non-commercial restriction in a software-shaped licence should look at PolyForm Noncommercial or
  the Prosperity Public License instead.

No change to the simulation.

## [1.7.1] — 2026-10-18

Delivery fix, after the v1.6.0 and v1.7.0 builds were never copied to the working drive and two
releases' worth of changes were evaluated against a v1.5.0 file.

- The build number is now shown in the title bar next to the name, not only in the About tab. A
  standalone copy opened from an old file looked identical to a current one; it no longer does.
- `WHICH-FILE.txt` is written beside the build, naming the current file, its size, and how to check
  the version from inside the app.
- Each release is now also written under its own name (`CardioSim-v<version>.html`) as well as to
  `CardioSim-standalone.html`, so the current file can be identified without checking its date.

No change to the simulation.

## [1.7.0] — 2026-10-18

An independent review of v1.5.0 found two reproducible bugs and several problems with how the
torsades source was built. All were reproduced on v1.6.0 before anything was changed; this release
fixes them and adds the regression coverage that would have caught them.

### Torsades: the episode is now a state machine, and it can be stopped
- **Disabling the generator mid-run did not stop it.** The whole run was scheduled in advance, so
  switching it off prevented future scheduling only — 15 further stimuli fired in the next four
  seconds. The generator is now an explicit state machine (`src/simulation/core/torsades.ts`:
  idle → priming → trigger → run → recovery) and every queued event carries an **epoch token**;
  disabling it, or changing any torsades parameter, voids everything already queued.
- **The episode state was missing from the snapshot**, so a checkpoint taken mid-episode replayed
  differently (28 stimuli against 0). It is now part of `SimSnapshot`, and mid-episode
  snapshot → restore → replay is byte-identical.
- Both are covered by `tests/physiology/torsadesEpisode.test.ts` (13 tests).

### Torsades: the source
- **The source repeated sites and then jumped.** Its position was a fractional index that was then
  rounded, giving `0 1 1 2 2 3 4 4 5 5 …`; and the sites were spaced by anatomical angle, which
  changed the frontal QRS axis by anything from −2° to +67° per step. Each site is now annotated with
  the axis a beat from it produces, and the source advances a fixed increment of **axis** per beat,
  walking as far along the path as that takes. The annotation is the summed lead-field dipole over the
  tissue within one conduction radius, which predicts the realised axis to a median of 8° (checked
  against beats simulated from every site on the path).
- The path stays ordered **anatomically**. Ordering it by axis was tried and kills the run in one or
  two beats, because consecutive sites are then spatially unrelated and the wavefront never arrives.
- **The chain branched.** The paired counter-rotating loop and the propagation hook could both advance
  the state machine, so each beat spawned two — six stimuli inside 33 ms, fusing into one complex and
  making the run look monomorphic. Only the source's own excitation now advances the chain; the second
  loop has its own event code and is off by default.
- `torsades.drift` and `torsades.ringSize` are replaced by `torsades.twistDeg` (degrees of axis per
  beat) and `torsades.pathSites`. Saved scenarios from earlier versions are converted automatically.

### Torsades: it now depends on the substrate
- Previously the same generator produced episodes with a normal action-potential duration (60 stimuli
  in 30 s), so the scenario could not support any claim about long QT. The triggered beat now arises
  at the site with the longest action potential — in practice the M-cell island — and is **gated** on
  that action potential still being in phase 3 at the EAD take-off time. On a normal-QT substrate
  nothing fires (0 stimuli in 30 s, against 20 on the long-QT substrate).
- Because that cell is itself refractory when the EAD takes off, the wavefront emerges in the nearest
  recovered tissue, so the first complex starts near but not at the long-QT zone.
- This is a threshold on APD, not a model of EAD dynamics in tissue, and it is **not** a torsade-risk
  prediction for a drug. `docs/MECHANISTIC_TDP_PROPOSAL.md` sets out a staged route to a model that
  could do that properly (cell → 1-D cable → 2-D monodomain sheet), with validation and convergence
  checks for each stage.

### QRS detection rewritten
- **A later high-amplitude segment erased earlier detections.** The threshold was 30 % of the spatial
  slope's maximum over the whole analysed window, so multiplying the last second of an eight-second
  sinus recording by ten removed all seven complexes detected in the first six seconds. Detection is
  now causal: running signal and noise peak levels, a 180 ms refractory period, search-back at half
  the threshold after 1.6 × the running RR, and T-wave discrimination.
- Measured against the simulator's own wave records across every scenario: **95.5 % sensitivity with
  4 spurious detections, against 94.1 % and 42 for the rule it replaced.**
- Two defects introduced during the rewrite and then found by measurement are documented in
  SCIENTIFIC_LIMITATIONS.md: a median-of-accepted-peaks estimate let one accepted P wave cascade into
  detecting them all, and an AND-ed T-wave rule missed the peaked T of severe hyperkalaemia.
- Covered by `tests/ecg/qrsDetection.test.ts`, including the exact reported scenario, low-amplitude
  and drifting records, search-back, and a test that the new rule is no worse than the old one.

### One shared causal model
- The review warned against replacing the ECG with an independent synthetic waveform while still
  showing an incompatible activation pattern. This model does not: every lead remains a linear
  functional of the same membrane-potential field that drives the heart view, and the continuous
  rotation is implemented in the tissue rather than as a synthesised waveform.
  `tests/physiology/causalConsistency.test.ts` asserts it — the tracing is flat whenever the
  myocardium has been quiet, Einthoven and Goldberger hold at every instant, and each torsades complex
  is anchored to the activation it came from.

### Housekeeping
- One browser test ("clicking the ECG inspects the heart state") was intermittently failing before
  this release: the click is rejected if it lands on part of the sweep the clock has not reached, so
  it now retries the click. The assertions are unchanged.
- Dev scripts are now type-checked (`npm run typecheck:dev`, `tsconfig.dev.json`); seven obsolete
  torsades scripts referencing the removed `siteB`/`cycleB` parameters were deleted.
- Reproduction scripts for every finding are kept under `scripts/dev/qc/`.

## [1.6.0] — 2026-10-17

Torsades de pointes reworked after a direct test of whether it can arise on its own; infarction now
runs through all five phases instead of the acute one alone.

### Torsades de pointes
- **Deep analysis of whether the arrhythmia can be emergent.** The M-cell island that the mapping
  studies name as the obstacle was added to the model, and capture was then scanned over coupling
  interval (300–480 ms), island amplitude and size, electrotonic smoothing, conduction velocity and
  the APD floor. Capture is all-or-nothing: 0 % of the ventricle at 415 ms, 100 % at 435 ms, with no
  interval that leaves a surviving line of block. The cause was measured — the recovery front sweeps
  the ventricle in ≈ 140 ms while a premature wave needs 250–280 ms to cross it, so whatever is
  refractory when the beat starts has recovered before the wavefront arrives. Functional re-entry
  needs an obstacle held open by wavefront curvature, which an event-driven graph without diffusion
  cannot represent. The source therefore stays imposed, and the scenario now says so with the numbers.
  The experiments are re-runnable: `scripts/dev/tdp-emergent.ts`, `tdp-block.ts`, `tdp-refrac.ts`,
  `tdp-rotor.ts`.
- **The waveform is rebuilt.** The source now advances a *fraction* of a step per beat around the ring
  (0.6), so the twist is progressive instead of cycling through 16 fixed vectors, and deep conduction
  restitution during the run makes each activation last 211 ms against a 265 ms cycle, so successive
  complexes overlap into a continuous undulation rather than a train of spikes.
- Measured against the published criteria: rate 226 /min (target 180–250), one spindle of 16 beats over
  4.3 s that self-terminates (was a turnover every 2–3 beats), at the isoelectric line 5 % of the time,
  22-fold envelope swing, 260° axis sweep, 211 ms activation span. Local extrema per complex, 3.3,
  remains just outside its 1–3 target: the complexes are still a little more fragmented than a real
  recording.

### M cells (new)
- `ventricles.mCellBoost` adds a midmyocardial band that repolarises last, shaped as an **island** in
  the LV lateral wall (Gaussian across the wall, around the circumference and along the long axis)
  rather than a layer, following the "unique topographical distribution" of Akar et al.,
  *Circulation* 2002;105:1247. A layer is a face a wavefront stops at; an island can be circled.
- Calibration and what this grid can and cannot carry are in SCIENTIFIC_LIMITATIONS.md ("M cells").

### Infarction — all phases
- `ischaemia.phase` carries any culprit territory through **hyperacute → acute → evolving → subacute →
  old**, following Marriott ch. 9. Three weights move independently: how much injury current remains
  (ST), the necrotic fraction of the wall (Q) and the extra peri-infarct APD (T inversion).
- Necrosis spreads from the subendocardium outwards — the wavefront phenomenon (Reimer & Jennings,
  *Circulation* 1977;56:786) — so Q waves appear once the dead zone crosses about half the wall.
- Dead myocardium is **removed from the lead field**, not merely silenced. Zeroing its amplitude left
  Σ W ≠ 0 over the surviving tissue, which put a square-wave offset on the whole cardiac cycle. It
  still conducts at CV × 0.3, standing for surviving subendocardial Purkinje fibres and intramural
  strands; cutting it from the conducting graph as well gave a 450 ms QRS.
- Eight new scenarios: the four non-acute phases for a proximal LAD and for a distal RCA occlusion.
  Group F is renamed "Ischaemia & infarction".
- Measured, proximal LAD: hyperacute T +6.1 mm in V3 with ST +0.8; acute ST +2.1 mm in V4; evolving
  Q −6.4 mm in V4 with ST down to +0.6; subacute Q with an isoelectric ST and T −1.4 mm; old Q alone
  with an upright T. Q waves do not develop in V2–V3, where this model has no R wave to remove.

### Tests
- New: `tests/physiology/mcells.test.ts`, and infarct-phase tests in `tests/physiology/ischaemia.test.ts`
  including a check that the TP segment stays flat in every lead once tissue is removed from the field.

## [1.5.0] — 2026-10-17

Potassium and drug scenarios were wrong; acute ischaemia with culprit-vessel localisation and
right-sided/posterior leads are new.

### Potassium
- New parameter **Extracellular potassium** (Parameters → Electrolytes). APD, conduction velocity and
  AP amplitude follow the TP06 cell model; conduction now changes in atria, His–Purkinje system and
  ventricles, so PR and QRS lengthen and the P wave changes.
- The AP shape is **calibrated** so the T and U waves take their textbook form: TP06's own shape change,
  mapped to the tissue, made the T wave only ≈ 20 % taller at 8 mM and produced no U wave at 3 mM.
- Scenarios: hyperkalaemia 7.0 (peaked T), advanced hyperkalaemia 8.5 (peaked T, PR ≈ 218 ms,
  QRS ≈ 150 ms) and hypokalaemia 3.0 (flat T, U wave larger than T, larger P).
- Not reproduced: P-wave loss, sine wave, hypokalaemic ST depression.

### Drugs
- Dofetilide, quinidine and verapamil recalibrated to a randomised human study at clinical doses
  (Johannesen et al. 2014). All of ΔQTc, ΔJ–Tpeak, ΔTpeak–Tend and ΔPR are within the published 95 % CIs.
  The previous TP06-only versions under-predicted hERG-block QT prolongation about threefold and had
  verapamil shortening QT by ≈ 80 ms (no significant change in man; PR +32 ms instead).

### Acute ischaemia — new group F
- Seven culprit lesions (Marriott Table 8.2): proximal LAD, main diagonal, mid-to-distal LAD,
  non-dominant and dominant LCx, proximal RCA (with RV), distal RCA. Territories on the AHA 17-segment
  model; the ischaemic territory is tinted on the 3-D heart.
- Ischaemic AP from TP06 under phase-1a conditions (APD × 0.895, rest −86 → −70 mV, conduction × 0.448
  at grade 3); the amplitude loss is calibrated to human 1-minute balloon occlusion (LAD 0.26 mV), and the
  RCA and LCx values of the same study are reproduced without further tuning.
- New parameter **Ischaemia grade** (Sclarovsky–Birnbaum 1–3): hyperacute T → + ST elevation → + QRS
  distortion.

### Leads
- Right-sided V3R–V6R and posterior V7–V9 are computed for every rhythm. The 12-lead view has a
  chest-lead switch (V1–V6 / Right / Posterior); scenarios select the useful set automatically.
- Selected-lead mode and CSV export include all 19 leads.

### Interface
- The premature-beat controls now sit inside group B (Premature beats) instead of at the top of the
  scenario list.

### Tests
- New: `tests/physiology/ischaemia.test.ts` (territories, seven culprit patterns, balloon-occlusion
  magnitudes), potassium morphology tests, TP06 potassium-table checks, drug tests against the human
  95 % CIs, extra-lead morphology.

## [1.4.0] — 2026-10-16

Supraventricular tachycardias looked ventricular. Two separate causes, one specific to AVNRT and
one in the ECG forward model that affected every rhythm.

### AVNRT circuit timing
The retrograde fast pathway was far too slow: His → atrium ≈ 140 ms, so the retrograde P wave sat
in the ST segment as a separate wave and the rate was 153/min. Calibrated to typical slow–fast
AVNRT (Katritsis et al. 2015: HA 45.8 ± 7.7 ms, CL 317 ± 43 ms): retrograde nodal time 60 → 20 ms,
retrograde ERP 180 → 150 ms, slow-pathway AH 200 → 210 ms. Now CL 340 ms (176/min) with atrial
activation at the end of the QRS (pseudo-S in II). The AVNRT test now checks CL against the
literature range and that atrial activation falls within the QRS.

### ECG amplitudes (all rhythms)
The QRS was 2–3× too large for the T wave: lead I R 1.83 mV and V2–V3 S 2.7 mV, against population
medians of 0.75 and 0.94 mV (Cleveland Family Study, n = 732). At tachycardia rates the giant
V1–V3 complexes with tall T waves read as a wide-complex tachycardia.
- Limb-lead torso factor 2.5 → 1.0 (lead I R 0.73 mV).
- Chest half-depth 105 → 125 mm (chest electrodes 20 mm further from the idealised heart; V2 S 1.6 mV).
- Still wrong and documented: poor R-wave progression (transition V5–V6), V2–V3 S ≈ 1.7× the
  median, flat V6 T. Re-orienting the heart fixed the transition but inverted the lateral T waves,
  so the anatomy was left unchanged.
- New test: sinus QRS amplitudes within a factor of 2 of six population medians.

### Measurement
QRS offset now requires the spatial slope to stay below threshold for 10 ms (was 3 samples).
Slow terminal forces in RBBB hover at 2–6 % of the peak slope; with the new amplitudes the old rule
ended the QRS at the first brief dip (94 ms measured vs 146 ms true). Now 146 ms.
The timing-coherence test was restated: the earliest lead's QRS onset must be within 10 ms of the
first ventricular activation, and every lead within 30 ms (was 20 ms per lead). V5 now starts 24 ms
late because it is nearly perpendicular to the initial septal forces.

### Atrial flutter (investigated, not changed)
The circuit is counterclockwise, but the inferior F waves are positive-dominant, not the typical
negative saw-tooth: the left atrium is activated almost simultaneously across a broad septal
interface, so its negative contribution is too weak. An explicit coronary-sinus bridge did not
change this and was not kept. Documented in SCIENTIFIC_LIMITATIONS.md.

## [1.3.0] — 2026-10-16

Torsades reworked after the v1.2.0 waveform was judged wrong on sight. It was: the complexes
faded once and stayed small instead of repeatedly swelling and collapsing.

### What was wrong
v1.2.0 validated the *axis rotation*, which a single 126° sweep satisfies. But what the eye reads
on a single lead is the **amplitude envelope** — complexes swelling and collapsing as the axis
sweeps through that lead's null. Measured in lead II, v1.2.0 went 1.82 → 0.24 mV and stayed low:
one fade, no spindles.

### What changed
The two-foci mechanism is replaced by a **drifting source**: the origin migrates one step per beat
around a seven-site path. This is the reduced-order stand-in for a drifting rotor, which current
optical-mapping and simulation work holds responsible for the undulating QRS axis (a Doppler
effect; reviewed in Front Cardiovasc Med 2024;11:1363848, which also sets out the consensus that
torsades is initiated by an EAD-triggered beat and maintained by re-entry).

Now: every beat captures, the tracing is continuous with no isoelectric baseline, and the lead II
amplitude waxes and wanes about ten times per run with a 5-fold swing, deflections inverting as the
axis crosses the null. Runs are recurrent and self-terminating at ≈ 176 /min.

### Still marked incomplete
- Complexes are sharper and more fragmented than a real recording's broad, smooth deflections.
- ≈ 176 /min is the slow edge of the clinical 200–250 /min, and it is a hard ceiling: organised
  capture fails above it on a long-QT substrate — driving faster blocks every other beat (50 %
  capture measured across cycle lengths of 130–300 ms).
- Full capture required lowering the ERP/APD ratio from 0.92 to 0.85. Both are nominal values, but
  it is a tuning choice made to obtain the appearance, and it is recorded as such.
- The migrating source is imposed, not generated by the long QT, so the scenario cannot predict
  torsade risk.

### Registry
25 validated, 18 partial, 2 incomplete (RBBB and torsades), 0 unsupported.


## [1.2.0] — 2026-10-16

Torsades de pointes is now implemented, so every scenario in the registry is runnable: 25
validated, 19 partial, 1 incomplete, **0 unsupported**.

### Torsades de pointes
v1.1.0 refused torsades after testing only the re-entry mechanism. That refusal recorded the right
evidence but tested the wrong mechanism. The classical explanation — Dessertenne's two foci at
slightly different rates, whose drifting relative phase rotates the axis — is within this engine's
reach, and is what the scenario now uses.

Two triggered foci (RV apex, LV anterobasal wall) fire 16-beat runs at 320 and 327 ms, starting in
phase after a short–long–short sequence. Each beat is a fusion of the two; because one focus is
7 ms slower, the fusion shifts progressively and the QRS axis rotates. Result: recurrent,
self-terminating runs at ≈ 230 /min with ≈ 125° of progressive rotation, 84 % of steps turning the
same way, with sinus rhythm resuming between runs.

**What it does not do:** the foci are imposed, not generated by the long QT. The same generator on
a normal-QT substrate rotates essentially the same (132° at 84 %), so the scenario reproduces the
morphology and the clinical setting but cannot predict torsade risk. Stated in the scenario and in
SCIENTIFIC_LIMITATIONS.md.

### Fixed: a measurement bug that had hidden the mechanism
The beat-to-beat axis analyser counted two activations a few milliseconds apart as two beats, when
they are one fused QRS. That doubled the apparent rate (405 /min instead of 240 /min) and turned a
smooth rotation into a zigzag — which is why an earlier analysis concluded the two-foci mechanism
did not twist. Activations within 80 ms are now merged.

### Also measured
Net rotation over total rotation ("straightness") separates organised polymorphic rhythms from
fibrillation — 0.89 torsades, 0.94 polymorphic VT, 0.18 fibrillation — but does **not** separate
torsades from polymorphic VT. Both scenarios now say so.

### Quality
- 89 unit tests (was 88), 20 end-to-end tests.


## [1.1.0] — 2026-10-16

Seven of the eight scenarios that v1.0.0 listed as "not supported yet" are now implemented, tested
and runnable. Each is built on measured data, and where a mechanism could not be reproduced
honestly it is still refused — with the evidence recorded.

### New scenarios
- **Hypercalcaemia and hypocalcaemia.** The ionic cell model is deliberately NOT used: TP06
  lengthens the action potential when extracellular calcium rises (measured here: epicardial APD90
  255 → 337 ms as [Ca²⁺]o goes 1 → 3 mM), the opposite of the clinical QT–calcium relationship.
  The tissue effect instead uses the human slope of 30.1 ms of QT per mmol/L of total serum calcium
  (Young et al. 2021, Mendelian randomisation in UK Biobank, n = 76 226). Simulated QT 374 → 348 ms
  at 3.2 mmol/L and → 398 ms at 1.6 mmol/L, QRS unchanged — matching the absence of a calcium–QRS
  association in that study. The Ionic cell tab keeps a calcium slider so the model's disagreement
  stays visible, and a test pins both directions.
- **EAD / DAD triggered activity.** IKr block alone produces no EADs in TP06 at any degree of
  block; the published modification that shortens the ICaL f-gate time constant does (Vandersickel
  et al. 2014), and DADs need an added RyR leak. Both are presets in the Ionic cell tab, labelled
  as modifications of the model rather than emergent behaviour. The measured takeoff times — EAD
  393 ms, DAD 403 ms — set the coupling interval of the tissue scenario.
- **Drug-induced effects** (dofetilide, quinidine, flecainide, verapamil), from the measured IC50
  values of the CiPA ion-channel panel (Crumb et al. 2016) with the Hill equation. Dofetilide and
  quinidine prolong QT; flecainide widens QRS 86 → 92 ms; verapamil *shortens* QT to 288 ms despite
  hERG affinity, because its ICaL block dominates — the standard explanation for its low torsade
  risk.
- **Scar-related monomorphic VT.** Anatomical re-entry around a transmural scar with one slow
  isthmus: inducible by burst pacing, quiet in sinus rhythm, sustained at ≈ 280 ms with a constant
  QRS (axis dispersion ≈ 10°).
- **Polymorphic VT.** The same substrate with a slower isthmus and wider border zone gives an
  unstable circuit: ≈ 310 ms with a continuously changing QRS (axis dispersion ≈ 61°).
- **Ventricular fibrillation.** Multiple wavelets from a dispersed refractory map, local activation
  interval 220 ms against measured human VF of 218 ± 24 ms (Nair et al. 2012).

### Still refused, with evidence
- **Torsades de pointes** remains unsupported. A late-coupled R-on-T beat failed to start re-entry
  in all 30 combinations tried; burst-induced rhythms on a long-QT substrate rotate at chance
  consistency (≈ 53 %) rather than twisting progressively, and run at 166–200 ms — fibrillation
  rates, not the 240–375 ms of torsades. The scenario entry records all three findings.

### Engine
- The APD floor is now a parameter. It was a numerical safeguard, but it turns out to govern the
  period of every functional re-entry in this engine, which has no excitable gap: measured across
  18 fibrillation runs, cycle length was 0.408–0.422 × reference APD against a predicted 0.414.
  Fibrillation cycle length is therefore a calibration, not a prediction, and says so.
- Ventricular repolarisation dispersion added (the polymorphic/VF substrate).
- Beat-to-beat axis analysis (`morphology.ts`) so "polymorphic" is measured, not asserted.

### Fixed
- Panel B (cellular action potentials) swept a 2 s sub-page while the 12-lead panel swept the full
  10 s page, so the two disagreed about which beats were on screen. Both now sweep the same page.

### Quality
- 88 unit tests (was 75), 20 end-to-end tests.


## [1.0.0] — 2026-10-15

First versioned release of CardioSim Lab: an educational, reduced-order cardiac electrophysiology and 12-lead ECG simulator. Not for clinical use.

### Simulation
- Event-driven activation on a voxelised idealised heart (2.5 mm grid), anisotropic conduction, refractoriness, CV restitution.
- SA node with autonomic modulation, latent junctional and ventricular pacemakers.
- AV node, slow pathway and three accessory pathways as lumped links:
  - collision handling;
  - concealed retrograde and antegrade conduction.
- His–Purkinje system with bundle-branch and fascicular block switches; retrograde Purkinje–muscle junction delay.
- Two-component APD restitution with per-cell cycle-length memory.
- Ectopy at named atrial and ventricular sites: single, once, bigeminy, trigeminy, couplet, run, protected focus.
- Arrhythmia substrates:
  - right-atrial flutter anatomy (tricuspid annulus, caval orifices, intercaval line, slow cavotricuspid isthmus);
  - heterogeneous remodelled atria for AF.
- TP06 human ventricular cell model (single cells, worker thread) with mapping onto tissue APD/CV.
- Forward ECG model:
  - lead field for V1–V6;
  - Einthoven lead vectors for the limb leads;
  - Wilson central terminal and Goldberger leads;
  - heart-vector channels.

### Scenarios (machine-readable registry: `docs/scenario-registry.json`)
- **25 validated** (each with an automated mechanism test):
  - sinus rhythm, brady/tachy, sinus arrest, SA exit block;
  - first-degree AV block, Mobitz I and II, 2:1 and complete AV block with junctional or ventricular escape;
  - PAC, PVC, bigeminy, trigeminy, couplet, interpolated PVC;
  - focal AT, AVNRT, orthodromic and antidromic AVRT, pre-excitation;
  - typical atrial flutter, atrial fibrillation;
  - LBBB.
- **1 incomplete:** RBBB (frontal axis distorted).
- **8 partial:**
  - focal VT;
  - TP06-mapped IKr inhibition 50 % and 90 %, short QT, hyper- and hypokalaemia, Na⁺- and Ca²⁺-channel block.
- **8 unsupported** (labelled, not runnable): scar VT, polymorphic VT, TdP, VF, hyper- and hypocalcaemia, EAD/DAD, drug-specific arrhythmias. *(All but torsades implemented in 1.1.0.)*

### Interface
- **Modes:** Simulator, Leads & Vectors (torso, electrodes, lead geometry, hexaxial and horizontal planes, dipole projection), Split view, A/B side-by-side.
- **3-D heart:** layers, view presets, picking, great vessels for orientation.
- **ECG and APs:** monitor-style sweep strips; resizable and maximisable panels; presentation mode.
- **Teaching tools:**
  - experiments A–G;
  - lessons L1–L8 with quizzes;
  - premature-beat controls;
  - clickable timeline events with highlighted structures and explanations.
- **Measurements:** arrhythmia-aware (PR only with a confirmed P–QRS relation, JT for wide QRS, rhythm-level summary for flutter and AF).
- **Export:** ECG as SVG, PNG and CSV; scenario save/load as JSON.
- **Standalone build:** one HTML file that runs from `file://`.

### Quality
- 75 unit/physiology tests (Vitest), 20 end-to-end tests (Playwright).
- Documentation: `DEVELOPMENT_STATUS.md`, `SCIENTIFIC_LIMITATIONS.md`, `TEST_RESULTS.md`, `IMPLEMENTATION_BACKLOG.md`, `NEXT_SESSION.md`, `docs/`.
- Demo video (3 min 10 s, 1080p30, captions) recorded from the running app; script in `video/STORYBOARD.md`.
