# Test results — v1.7.0

Run on the v1.7.0 code base (headless Chromium 1194 for end-to-end tests).

## Unit / physiology (`npx vitest run`): 144 / 144 passed

| File | Tests | Covers |
|---|---|---|
| tests/physiology/normalSinus.test.ts | 12 | NSR intervals vs reference ranges, lead identities (Einthoven, Goldberger, WCT), activation order |
| tests/physiology/rateDependence.test.ts | 4 | Rate → QT and AV-nodal conduction, vagal effects |
| tests/simulation/engine.test.ts | 12 | Determinism, checkpoint/restore replay, parameter changes only after t, AV-nodal block, escape rhythms, premature activation, refractoriness |
| tests/physiology/ischaemia.test.ts | 15 | v1.5.0: AHA territories; ST patterns of Marriott's seven culprit risk areas (incl. V4R, V7–V8); ST size vs human balloon occlusion (LAD calibrated; RCA and LCx independent). v1.6.0: the five phases of infarction for a proximal LAD and a distal RCA — T tall then inverted then upright, ST building then falling to the baseline, Q waves appearing and permanent; QRS stays narrow (dead tissue silent but conducting); the TP segment stays flat in every lead once tissue is removed from the lead field |
| tests/ecg/qrsDetection.test.ts | 8 | v1.7.0: detection is causal (a later high-amplitude segment cannot erase earlier detections — the defect found by review), unchanged prefixes give unchanged detections under any later gain, low-amplitude and drifting records, T-wave discrimination in severe hyperkalaemia, refractory spacing, search-back for one attenuated beat, sensitivity ≥ 90 % against simulator labels across organised rhythms, and no worse than the global-threshold rule it replaced |
| tests/physiology/torsadesEpisode.test.ts | 13 | v1.7.0: disabling the generator mid-episode stops it; any torsades parameter change voids queued events; mid-episode snapshot → restore → replay is identical; re-enabling starts a fresh episode; no episodes on a normal-QT substrate and episodes on the long-QT one; the source path advances a whole site every beat and turns the axis by about the requested amount; pre-v1.7 saved files are migrated |
| tests/physiology/causalConsistency.test.ts | 9 | v1.7.0: the ECG and the 3-D activation share one source — the tracing is flat whenever the myocardium has been quiet, Einthoven and Goldberger hold at every instant, every torsades complex is anchored to its activation, and switching the generator off leaves sinus rhythm; the twist is measured with unreliable axes near vector nulls excluded (net rotation, straightness), and successive complexes change gradually rather than by steps |
| tests/physiology/mcells.test.ts | 4 | v1.6.0: the M-cell zone is ventricular only, peaks mid-wall and is an island bounded in the plane of the wall rather than a layer; APD rises monotonically with the boost; Tpeak–Tend stays in the human range and the QRS is untouched |
| tests/ecg/ecg.test.ts | 12 | Forward model and measurement pipeline; v1.4.0: sinus QRS amplitudes within ×2 of six population medians, restated QRS-onset coherence (earliest lead ≤ 10 ms, every lead ≤ 30 ms) |

### Added in v1.1.0 (13 tests in tests/physiology/scenarios.test.ts)

| Test | Checks |
|---|---|
| scar-related VT | Sustained re-entry at 240–500 ms, monomorphic (axis dispersion < 30°), and **quiet without the burst** — VT must be inducible, not spontaneous |
| polymorphic VT | Same range, changing QRS (dispersion > 40° and > 20° above the monomorphic scenario), quiet without the burst |
| ventricular fibrillation | Local activation interval within 2 SD of human VF in vivo (218 ± 24 ms, Nair 2012), dominant frequency 3.5–7 Hz, irregular, > 20 re-entrant waves, quiet without the burst |
| re-entry cycle length vs refractory floor | Pins CL ≈ erpRatio × apdFloor × APDref to within 20 %, the relationship the VF calibration depends on |
| calcium hyperca / hypoca | QT shifts 14–40 ms in the right direction with QRS unchanged (≤ 4 ms) |
| calcium direction vs ionic model | Pins the documented disagreement: TP06 lengthens APD as [Ca²⁺]o rises while the scenario shortens QT |
| EAD/DAD triggered activity | EADs appear with the published ICaL modification and **not** from IKr block alone; a triggered beat appears with the RyR leak and **not** without it; tissue shows late-coupled ectopy on a prolonged QT |
| drug dofetilide / quinidine / flecainide / verapamil | QT lengthens (IKr blockers), QRS widens (flecainide), QT shortens (verapamil) |
| drug block fractions | Hill equation against the published IC50 values |
| tests/physiology/scenarios.test.ts | 28 | One mechanistic test per validated registry scenario (incl. flutter: regular re-entry, tricuspid obstacle never activated, AV filtering; AF: irregular atrial and ventricular activation, persistence after the PV trigger stops; LBBB ≥ 140 ms) + registry consistency |
| tests/physiology/ionic.test.ts | 9 | TP06 cell-type behaviour and rate adaptation; each TP06→tissue mapping recomputed from the cell model and its ECG effect checked |

Scenario tests check mechanism signatures from the simulator's own records, not only waveform changes. For example:
- **Mobitz I:** progressive AH lengthening before the block.
- **PVC:** concealed retrograde block of the next sinus P and an exactly compensatory pause.
- **AVNRT:** ≥ 8 cycles via slow-antegrade / fast-retrograde conduction; since v1.4.0 CL within 317 ± 2·43 ms (Katritsis 2015) and retrograde atrial activation within the QRS.
- **Antidromic AVRT:** pre-excited complexes with retrograde AV-nodal conduction.

## QRS detection accuracy (v1.7.0)

Measured against the simulator's own wave records (`scripts/dev/qc/detect-compare.ts`,
`detect-accuracy.ts`), which the detector never sees.

| | old (global threshold) | new (adaptive) |
|---|---|---|
| detector alone, all scenarios | 94.1 % sensitivity, 42 spurious | **95.5 %, 4 spurious** |
| full pipeline, all scenarios | — | 92.2 %, 10 spurious |
| full pipeline, excluding fibrillation | — | **96.6 %, 10 spurious** |

Fibrillation is excluded from the headline figure because there are no discrete complexes to detect
(4 of 33 activations matched); rhythm-level measures are used for it instead. The remaining misses are
antidromic AVRT (10 of 21) and fast focal VT (3 of 22), where activations fuse.

## End-to-end (`npx playwright test`): 21 / 21 passed

| Area | Tests |
|---|---|
| Start-up and baseline | NSR start-up: clock runs, all panels drawn, measurements and event log present |
| Playback | Pause freezes every view at one time |
| Parameters and explanations | Live parameter change → measured PR change and an explanation card; ECG click inspection |
| Validation | Validation dashboard (Einthoven, QRS onset vs activation, activation sequence) |
| A/B comparison | Overlay in the Simulator; A/B mode side-by-side animation |
| Export | ECG export as CSV (header and length), SVG and PNG |
| Leads & Vectors | Torso, hexaxial and lead strips drawn; lead info card mentions the Wilson central terminal |
| Experiments | Experiments menu applies LBBB (UI switch reflects it) |
| Split view | Split view draws heart, torso, ECG strip and APs |
| Scenarios | Registry: unsupported scenario cannot be loaded; PVC scenario loads |
| Timeline events | Clicking an event highlights a structure and shows its explanation |
| Lessons | A lesson loads its starting state and switches the view |
| Ionic cell lab | TP06 lab runs and reports APD90 for three cell types |
| Premature beats | "Fire one premature beat" → exactly one ectopic QRS detected and labelled; bigeminy/trigeminy buttons → coupled ectopic beats |
| Atrial arrhythmias | Flutter and AF scenarios show rhythm-level measurements (flutter-wave rate; "single RR or PR not meaningful") |
| Responsive layout | Phone width (390 px): no horizontal scroll; ECG sized to its content |

## Not covered by automated tests
- Visual correctness of the 3-D anatomy (checked by screenshots during development).
- Fine morphology of BBB patterns. These are marked *incomplete* in the registry.
- Demo-video content (generated from the running app; reviewed frame by frame).

### Changed in v1.5.0
- Drug tests (dofetilide, quinidine, verapamil) now check ΔQT, ΔJ–Tpeak, ΔTpeak–Tend and ΔPR on the heart-vector magnitude against the 95 % CIs of Johannesen et al. 2014 (±3 ms measurement slack at 2 ms sampling).
- Potassium: the TP06 mapping tests for Ko 8 / Ko 3 were replaced by checks of the stored TP06 potassium table (APD, CV, amplitude at 3 and 8 mM) and by morphology tests — hyperkalaemia: taller and narrower T in V2–V4, longer PR and QRS, lower P; advanced: PR and QRS +40 ms; hypokalaemia: U wave larger than the flattened T in V2–V3, larger P.
- Extra chest leads: V3R–V6R are rS and smaller than V1; V7–V9 are R-dominant.
