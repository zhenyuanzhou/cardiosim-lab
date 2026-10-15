# Development status — Phase 2

| Milestone | Scope | Status |
|---|---|---|
| M1 | 3-D heart view: smooth surfaces, layers (anatomy, major pathways, activation, repolarisation, refractory, vectors, tissue mesh), view presets, picking, great vessels for orientation | done |
| M2 | ECG Vector & Lead Explorer: torso and electrodes, hexaxial and horizontal planes, lead geometry, projection, lead strips, lead info card, split view, resizable/maximisable panels, presentation mode | done |
| M3 | Ectopy, explicit block flags, experiments A–F, event explanations, clickable timeline events with highlights | done |
| M4 | Conduction scenarios, machine-readable registry, arrhythmia-aware measurements | done |
| M5 | Re-entry via lumped links (AVNRT, orthodromic/antidromic AVRT, pre-excitation), focal AT/VT, TP06 ionic cell lab, Group E mapped scenarios | done; scar VT, flutter, AF, VF and TdP unsupported |
| M6 | Lessons L1–L8 with quizzes, A/B side-by-side mode, narrow-layout ECG, tests, documentation | done |
| Video | 1080p30 MP4 demonstration with captions | see `video/` |

## Scenario registry (`docs/scenario-registry.json`)

| Status | Count |
|---|---|
| Validated (all 8 criteria, automated test) | 22 |
| Implemented but incomplete (RBBB, LBBB morphology) | 2 |
| Partially simulated (focal VT; 7 TP06-mapped ionic/drug scenarios) | 8 |
| Unsupported (labelled, not runnable) | 10 |
| Placeholder | 0 |

## Modes

1. **Simulator.** Anatomy/activation, action potentials, 12-lead ECG and the control rack:
   - Scenarios, Parameters, Explain, Lessons, Ionic cell, Validation, A/B, About.
2. **Leads & Vectors.**
   - Torso with RA/LA/LL/RL and V1–V6.
   - Lead axes and projection.
   - Hexaxial and horizontal planes.
   - Up to three leads compared.
   - Experiments A–F.
3. **Split view.** Heart, torso, frontal vector, ECG strip, action potentials and the current event, all on one clock.
4. **A/B.** Two parameter sets simulated from t = 0 and animated side by side, with ECG overlay on identical scaling.

## Known defects / open items
See `SCIENTIFIC_LIMITATIONS.md` and `IMPLEMENTATION_BACKLOG.md`.
