# Changelog

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
- **8 unsupported** (labelled, not runnable): scar VT, polymorphic VT, TdP, VF, hyper- and hypocalcaemia, EAD/DAD, drug-specific arrhythmias.

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
