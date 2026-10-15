# CardioSim Lab — Technical Architecture

**Purpose.** Show how changes in cardiac electrophysiology produce changes in the surface ECG through one internally consistent causal simulation. Every ECG sample is computed from simulated membrane potentials. No waveform is looked up or hand-drawn.

**Status.** Phase 1 (working normal heart) is implemented and tested. See `ROADMAP.md`.

> Research education and concept demonstration only. This is not a clinically validated diagnostic system, not a patient-specific model, and it does not predict clinical drug effects.

---

## 1. Layered model

```
                    ┌───────────────────── one simulation clock (ms) ─────────────────────┐
Layer A  Cellular   │ reduced-order Vm(t) per cell = f(activation time, APD90, cell type) │
                    │ APD90 = APDinf · ρ(DI)   (Mitchell–Schaeffer map, fitted to Franz 1988)│
Layer B  Conduction │ SA node · fast atrial pathways · AV node (recovery model) · His ·     │
                    │ RBB/LBB/LAF/LPF/LSF · Purkinje networks · PMJs · latent pacemakers    │
Layer C  Tissue     │ voxel graph (2.5 mm) of atria + ventricles, fibre-based anisotropic   │
                    │ delays, refractoriness (ERP = k·APD), CV restitution                  │
Layer D  ECG        │ lead field of J = −σi∇Vm → 12 leads (WCT, Einthoven, Goldberger)      │
Layer E  Views      │ 3-D activation · APs · ECG · measurements · causal log · explanations │
                    └──────────────────────────────────────────────────────────────────────┘
```

### Layer B + C — event-driven propagation (Fidelity Levels 1–2)

- **Graph.** 9,487 nodes: 1,814 atrial voxels, 7,139 ventricular voxels and 534 conduction-system nodes (including the lumped SA and AV nodes). Myocardial voxels connect to their 26 neighbours within the same chamber group. The atria and ventricles are electrically insulated from each other except through the AV node.
- **Events.** A binary heap of `(time, node, source, wave)` excitation events plus automaticity checks. When an event is popped, the node either (a) is still refractory (`t − lastActivation < ERP`), in which case conduction blocks there, or (b) activates. Activation fixes its APD90 from the diastolic interval and schedules every neighbour at `t + delay·f(DI)`.
- **Delays.** Ventricular delays use the anisotropic travel time `√[(d·f)²/vL² + (|d|² − (d·f)²)/vT²]`, where `f` is the local fibre direction (helix angle +60° endocardium to −60° epicardium). Atrial delays are isotropic; Bachmann's bundle and the crista terminalis are faster. His–Purkinje delays come from length/CV, and each PMJ adds a fixed delay.
- **AV node.** A lumped, directional element. Its conduction time is `AH = AHmin + A·exp(−(R − ERP)/τ)`, where R is the H-to-A recovery time (the recovery term of Sun et al. 1995). An impulse arriving with `R < ERP` is blocked. Retrograde conduction is optional.
- **Pacemakers.** The SA node fires at `IHR·exp(0.9·S − 0.85·V)`. Junctional (proximal His) and ventricular (distal LPF) latent pacemakers are re-armed by every activation that reaches them (overdrive reset). They fire only if nothing reaches them within one escape cycle.
- **Waves.** Every firing starts a numbered *wave*. All activations inherit the wave id, which gives per-beat milestones: SA → atria → AV in/out → His → bundles → Purkinje → first and last ventricular cell → last repolarisation. The causal event log and the model "ground truth" columns read these milestones.

### Layer A — cells

`Vm(t) = Vrest + A(τ)·(Vpeak − Vrest)`, where τ = t − t_act. The function A(τ) is the product of a logistic upstroke, a phase‑1 notch (larger in epicardium), a declining plateau and a logistic phase‑3 repolarisation. The repolarisation midpoint is solved so that A = 0.1 exactly at APD90. Nodal cells (SA and AV) use a slow-upstroke waveform with phase‑4 depolarisation for display. Their mass is ECG-silent in this model.

APD varies between regions: transmural (endo > epi), apicobasal, and electrotonic smoothing of the APD map (proxy). Rate dependence comes from the restitution map. This is the **reaction-eikonal decoupling** used in fast ECG models (Neic et al. 2017; compare ECGSIM, van Oosterom & Oostendorp 2004). It is *not* an ionic model, and the UI labels it as reduced-order.

### Layer D — ECG forward model

The impressed current density is `J = −σi∇Vm`. The model discretises `∇Vm` on face-neighbour voxel edges. Because the forward map is linear, it collapses to per-node weights: `y_c(t) = Σ_i W_ic·(Vm_i(t) − Vrest_i)`. This holds exactly with `Σ_i W_ic = 0`, so uniform tissue potential produces no signal.

- **V1–V6.** Infinite homogeneous volume conductor, `φ = (1/4πσ)∫J·(r_e−r')/|r_e−r'|³dV`. Electrodes sit on an elliptical chest section at anatomical positions relative to this heart (4th and 5th intercostal spaces). Proximity effects are retained.
- **Limb electrodes.** Einthoven equilateral lead vectors applied to the heart dipole `P = ∫J dV`. The infinite medium distorts distant electrodes badly, so the classical hexaxial model is used for them.
- **Leads.** I = LA−RA, II = LL−RA, III = LL−LA; aVR/aVL/aVF (Goldberger); Vn − WCT. Einthoven's law and aVR + aVL + aVF = 0 hold exactly, and tests verify both.
- **Scaling.** Two scalar torso-transfer factors (limb and chest) set amplitudes. Amplitudes are therefore calibrated, not predicted.

### Signal-derived measurements

Fiducials are detected **from the 12 simulated leads only**: QRS from spatial slope, P from spatial magnitude, T end by the tangent method (latest lead = global QT), and axis from the net areas of I and aVF. The activation model's own timings are reported beside them, so ECG↔activation coherence is visible and testable. At baseline the two agree within 3 ms (PR) and 3 ms (QRS), and the QT agrees with the last APD90 within 1–2 ms.

---

## 2. Runtime architecture

```
UI thread (React + Zustand)                     Web Worker (simWorker.ts → SimHost)
──────────────────────────────                  ───────────────────────────────────
frameLoop: display clock t_display  ──extend──▶  Simulator.run(chunk = 500 ms sim time)
  ▲ advances at speed × wall time                  · checkpoint every 1 s of sim time
  │ never beyond simulated data      ◀─chunk───   · records, ECG samples, wave summaries
SimData (shared history store)                      (transferable typed arrays)
  · ECG ring (15 ch: 12 leads + heart vector)
  · activation records per node   ──setParams(at)─▶ restore checkpoint ≤ at, replay
  · wave summaries                                   deterministically to `at`, switch params
  · cached beat measurements      ◀─truncate────   UI drops data after `at`; new data streams
Views read SimData at t_display:   ──compare────▶  two fresh runs (A, B) from t = 0
  Heart (z-buffered voxel splats), APs, ECG, tables
```

- **Simulation time vs display time.** The worker simulates ahead of the display. The display clock runs at 0.1–2× real time and can pause, step (±20 ms), jump between beats, rewind within the retained history (120 s) and replay.
- **Live parameter changes.** A change applies at the current display time. The host restores the latest checkpoint before that time, replays bit-identically to it, switches parameters and continues. Data after the change point is replaced.
- **Determinism.** No `Math.random`. A seeded generator (mulberry32) is wired in for stochastic Phase‑2 features. The validation tab includes a determinism self-test.
- **Fallback.** If a Worker cannot start, the same `SimHost` runs on the UI thread.
- **Performance (measured).** Model build about 0.6 s. In the browser worker, 500 ms of simulated time takes about 50–60 ms to compute at 500 Hz (roughly 9× faster than real time on one core). The ECG loop over active cells dominates.

---

## 3. Folder and module structure

```
src/
  simulation/
    core/          params.ts (typed serialisable parameter model + metadata), model.ts (types/enums),
                   derive.ts (parameter → per-edge delays, per-cell APD maps, autonomic effects),
                   engine.ts (event-driven Simulator, waves, checkpoints, on-line ECG),
                   eventQueue.ts, rng.ts, vec.ts
    pacemakers/    (Phase 2: sinus pauses, RSA, pacing) — Phase-1 pacemaker logic lives in engine.ts/derive.ts
    conduction/    conductionSystem.ts (SA/AV nodes, fast atrial paths, His, bundles, fascicles, Purkinje trees)
    tissue/        anatomy.ts (idealised geometry), buildModel.ts (voxelisation, fibres, transmural coordinate)
    cellular/      actionPotential.ts (waveforms, restitution, phases)
    ecg-forward/   leadField.ts (forward model, electrodes, lead derivation), measurements.ts (fiducials)
    scenarios/     scenarios.ts (catalogue with mechanism / ECG / fidelity / limitations)
    worker/        simHost.ts, simWorker.ts, client.ts (UI-side store), protocol.ts
  visualization/
    heart/         HeartView.tsx (Panel A)
    action-potentials/ APPanel.tsx (Panel B)
    ecg/           ECGPanel.tsx, ecgRender.ts (Panel C, SVG/PNG/CSV export)
    timeline/      EventLog.tsx (causal event log)
    frameLoop.ts, cellState.ts
  components/
    controls/      ParameterPanel, ScenarioPanel, ComparePanel (A/B)
    measurements/  MeasurementsTable, ValidationPanel, validation.ts
    education/     explainEngine.ts, featureMap.ts, ExplainPanel, AboutPanel
  state/           store.ts (Zustand), actions.ts
tests/
  physiology/  normalSinus.test.ts, rateDependence.test.ts
  simulation/  engine.test.ts (determinism, checkpoints, AV block, escape, bundle slowing, premature beats)
  ecg/         ecg.test.ts (lead identities, lead field, timing coherence, QRS vector changes)
  integration/ app.spec.ts (Playwright: panels, live change, inspect, validation, A/B, export)
scripts/       validate-baseline.ts (CLI report); dev/ (tuning & profiling scripts used during development)
docs/          this file, FIDELITY_MATRIX, PARAMETER_DEPENDENCIES, ROADMAP, VALIDATION, REFERENCES
```

**Stack.** TypeScript, React 19, Vite 7, Zustand, Canvas 2D (heart, APs, ECG), Web Worker, Vitest, Playwright. The 3‑D heart uses a z-buffered voxel splat renderer on Canvas 2D instead of Three.js. It handles about 9,500 points per frame without adding a dependency. Three.js / R3F remains the planned path for the Phase 5 surface anatomy.
