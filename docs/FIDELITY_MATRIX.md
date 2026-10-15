# Simulation Fidelity and Limitation Matrix

**Fidelity levels.**

| Level | Name | What it means here |
|---|---|---|
| L1 | Conduction network | Event-driven conduction delays, refractoriness, automaticity and AV nodal recovery on a network of specialised structures |
| L2 | Spatial tissue | The same event engine on a voxelised 3‑D tissue graph with anisotropy, regional APD and CV/APD restitution |
| L3 | Cellular / ionic | Ionic-current models (e.g. ten Tusscher–Panfilov 2006). **Not in Phase 1** |

**Output classes** (also shown in the app's Validation tab):

- **Mechanistically simulated**: emerges from the simulated state with no shape imposed.
- **Reduced-order approximation**: emerges from the state, but through a simplified sub-model.
- **Educational preset or schematic**: fixed or idealised; illustrative only.

## Matrix

| Component | Fidelity | Class | What it represents | What it cannot reproduce |
|---|---|---|---|---|
| Activation sequence, conduction timing, block, collision | L1+L2 | Mechanistic | Graph-eikonal propagation with refractoriness on 26-neighbour voxel graph | Source–sink mismatch, wavefront curvature, safety factor, slow-conduction physics below grid resolution; graph metric error ≈ 5–8 % |
| Anisotropy | L2 | Reduced-order | Rule-based fibre helix (+60° → −60°), ellipsoidal travel time | Sheet (orthotropic) conduction, patient fibre fields |
| AV node | L1 | Reduced-order | Directional lumped element; recovery-dependent AH; ERP block; retrograde option | Dual pathways, facilitation, fatigue, concealed conduction, Wenckebach periodicity calibration (Phase 2) |
| SA node & escape pacemakers | L1 | Reduced-order | Fixed-rate automaticity, autonomic scaling, overdrive reset by invading activation | Pacemaker shift, sinus exit block, RSA, overdrive *suppression* kinetics |
| Autonomic effects | — | Schematic | Lumped vagal/sympathetic indices on SA rate and AV node | Direct effects on atrial/ventricular APD, dose–response |
| Action potentials | L1/L2 support | Reduced-order | Parametric Vm(t) with phase 0–4 features anchored to activation time and APD90 | Ionic currents, EAD/DAD, triggered activity, Ca²⁺ handling, extracellular K⁺/Ca²⁺, drug block |
| APD rate dependence | — | Reduced-order | Mitchell–Schaeffer restitution map fitted to the human steady-state slope (Franz 1988) | Dynamic (single-extrasystole) restitution, slow APD memory, alternans; APD floor at short DI is a numerical safeguard |
| ERP | — | Reduced-order | ERP = ratio × APD90 (nominal ratio) | Post-repolarisation refractoriness in working myocardium (AV node shows it by construction) |
| Repolarisation heterogeneity | L2 | Reduced-order | Transmural + apicobasal APD gradients, smoothed (electrotonic proxy) | True electrotonic coupling; the sign/magnitude of human apicobasal gradients varies between hearts (Opthof 2017) |
| Chest-lead potentials | — | Reduced-order | Lead field of −σi∇Vm in an infinite homogeneous medium | Torso boundary, lungs, blood-pool, anisotropic conductivity, electrode-placement variation |
| Limb-lead potentials | — | Reduced-order | Einthoven lead vectors on the heart dipole | Non-dipolar content, Burger-triangle asymmetry |
| ECG amplitudes | — | Schematic | Two calibrated torso-transfer scalars | Absolute voltages are not predictive |
| ECG timing and intervals | L1+L2 | Mechanistic | Measured from the signal; agrees with activation model within a few ms | — |
| Anatomy | — | Schematic | Ellipsoidal LV/RV, spherical atria, 2.5 mm voxels; orientation tuned qualitatively for a normal 12‑lead | Patient anatomy, valves/annuli, outflow tracts, papillary muscles; fine (<2.5 mm) structures |
| Purkinje network | L1 | Reduced-order | Fascicles on idealised endocardial paths; greedy nearest-attachment tree; coverage of lower ~90 % | Measured human Purkinje topology; fascicular territories are not yet calibrated (LAF slowing does **not** yet give left-axis deviation) |
| Atrial geometry & P wave | L2 | Reduced-order | Two shells with septum, crista terminalis, Bachmann's bundle | Pulmonary veins, appendages, coronary sinus, interatrial conduction variants |

## Known quantitative limitations at baseline

- PA interval (SA exit to AV node input) ≈ 47 ms, against 28 ± 7 ms in Lee & Lien 1975. The model AV-node input is farther from the SA node than in man.
- The precordial S waves in V2–V3 are larger than typical, and V4 shows a small fragmented transition complex. This comes from near-field effects in the infinite medium with an idealised geometry.
- RV free wall share of ventricular mass is ≈ 26 %, higher than typical.
- APD at short diastolic intervals is too short for dynamic restitution studies. A floor of 0.45 × APDref applies. This must be recalibrated before Phase 3 reentry work.
- Slowing the RBB to block gives an area-based frontal axis far to the right (around −120°). Real RBBB usually keeps a normal axis. This is a model artefact of the strong terminal rightward forces and is flagged as "preview".

## Rules followed

- Phenomenological waveform adjustments are never labelled as mechanistic simulations.
- Each scenario carries a fidelity label and a status: validated baseline, preview, or planned.
- No clinical validation is claimed. Literature values are cited only where they were checked (see `REFERENCES.md`). Every other value is tagged `nominal`.
