# Test results — Phase 2

Run on the Phase 2 code base (headless Chromium 1194 for end-to-end tests).

## Unit / physiology (`npx vitest run`): 75 / 75 passed

| File | Tests | Covers |
|---|---|---|
| tests/physiology/normalSinus.test.ts | 12 | NSR intervals vs reference ranges, lead identities (Einthoven, Goldberger, WCT), activation order |
| tests/physiology/rateDependence.test.ts | 4 | Rate → QT and AV-nodal conduction, vagal effects |
| tests/simulation/engine.test.ts | 12 | Determinism, checkpoint/restore replay, parameter changes only after t, AV-nodal block, escape rhythms, premature activation, refractoriness |
| tests/ecg/ecg.test.ts | 10 | Forward model and measurement pipeline |
| tests/physiology/scenarios.test.ts | 28 | One mechanistic test per validated registry scenario (incl. flutter: regular re-entry, tricuspid obstacle never activated, AV filtering; AF: irregular atrial and ventricular activation, persistence after the PV trigger stops; LBBB ≥ 140 ms) + registry consistency |
| tests/physiology/ionic.test.ts | 9 | TP06 cell-type behaviour and rate adaptation; each TP06→tissue mapping recomputed from the cell model and its ECG effect checked |

Scenario tests check mechanism signatures from the simulator's own records, not only waveform changes. For example:
- **Mobitz I:** progressive AH lengthening before the block.
- **PVC:** concealed retrograde block of the next sinus P and an exactly compensatory pause.
- **AVNRT:** ≥ 8 cycles via slow-antegrade / fast-retrograde conduction.
- **Antidromic AVRT:** pre-excited complexes with retrograde AV-nodal conduction.

## End-to-end (`npx playwright test`): 20 / 20 passed

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
