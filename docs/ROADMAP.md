# Phased Implementation Plan

Each phase must end with a running, tested application, not a mock-up.

## Phase 1 — Working normal heart ✅ (this release)

Delivered:
- Voxelised atria/ventricles, fibre field and transmural coordinate.
- Conduction system: SA node, crista terminalis, Bachmann's bundle, AV node, His, RBB with moderator band, LBB with LAF/LPF/LSF, and Purkinje networks with PMJs.
- Event-driven activation with refractoriness, CV restitution, APD restitution, latent pacemakers with overdrive reset, and retrograde AV conduction.
- Reduced-order APs with phase 0–4 features, APD90 and ERP display.
- Forward-computed 12‑lead ECG plus heart vector, signal-derived measurements with model ground truth, and a causal event log.
- Four-panel UI with one display clock: pause, step, beat jump, rewind, replay and speed control. Live parameter changes use checkpoint replay. Also included: A/B overlay, scenario save/load (JSON), SVG/PNG/CSV export, validation dashboard, explanation engine and warnings.
- Tests: 38 Vitest tests (physiology, simulation, ECG) and 7 Playwright browser tests, all passing.

Phase 1 outcome (default parameters, signal-derived): HR 66 bpm, PR 156 ms, P 86 ms, QRS 84 ms, QT 372 ms, QTc(B) 390 ms, QRS axis +18°, P axis +48°, T axis +39°. Model: AH 65 ms, HV 41 ms.

## Phase 2 — Conduction abnormalities (next)

Priorities, in order:
1. **AV node.** Implement the full Sun–Glass–Billette recursion (recovery, facilitation, fatigue), concealed conduction and a block-probability option. Validate an *emergent* Wenckebach pattern (progressive PR, dropped beat, recovery), 2:1 block without assigning a subtype, high-grade block, and complete block with AV dissociation and escape.
2. **Explicit block switches** for RBB, LBB, LAF and LPF (in place of extreme slowing). **Calibrate fascicular territories** so that LAFB gives left-axis deviation and LPFB gives right-axis deviation, which the current geometry does not yet reproduce.
3. **Premature beats.** Programmed stimulation UI (site picker, coupling interval, S1–S2). PACs with sinus reset, PVCs with compensatory pause, bigeminy and trigeminy.
4. **Sinus node.** RSA, sinus pause/arrest, SA exit block and escape-rhythm scenarios.
5. Move the preview scenarios to validated status with dedicated tests. Reduce the PA interval toward 28 ± 7 ms.

## Phase 3 — Reentry and tachyarrhythmias

- Recalibrate dynamic restitution (APD and CV) to human data before any reentry work, and remove the APD floor.
- Experiment Mode 2 (reentry): pathway length, wavelength vs circuit size, unidirectional block, excitable gap. Wavelength alone must not be treated as sufficient.
- AVNRT (dual AV nodal pathways), AVRT/WPW (accessory pathway elements, delta wave), typical atrial flutter (cavotricuspid isthmus), AF (fibrotic heterogeneous substrate, seeded), scar-related monomorphic VT and VF.
- Tests: reentry needs substrate plus trigger; it terminates without return-path excitability; AF shows irregular ventricular response; VF shows no organised QRS.

## Phase 4 — Ionic and repolarisation mechanisms (Level 3)

- Integrate a published human ventricular ionic model (candidate: ten Tusscher–Panfilov 2006) for selected cells, and derive APD/ERP lookup surfaces from it to drive the tissue layer.
- IKr/IKs/ICaL/INa(L)/Ito/IK1 scaling, [K⁺]o and [Ca²⁺]o, EAD/DAD triggered activity, long and short QT, drug-like block (explicitly *not* a clinical prediction), and the TdP demonstration (Experiment 3: TdP must not appear automatically whenever IKr is reduced).

## Phase 5 — Advanced research features

- Three.js surface anatomy (or an image-derived mesh), a better forward model (BEM torso with lungs) and regional ischaemia/injury currents.
- Scar and fibrosis editing, cardiac pacing and capture, expanded pharmacology, and Brugada/CPVT demonstrations.

## Phase 2 (delivered)
Milestones M1–M6 — see `DEVELOPMENT_STATUS.md`. Next priorities are in `IMPLEMENTATION_BACKLOG.md`.
