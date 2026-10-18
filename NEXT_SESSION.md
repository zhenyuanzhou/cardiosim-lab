# NEXT_SESSION — checkpoint

_Last updated: v1.7.0 (QC review: torsades episode state machine, adaptive QRS detection)._

## v1.7.0 notes
- **Torsades is an explicit state machine** (`src/simulation/core/torsades.ts`): idle → priming →
  trigger → run → recovery. Every queued event carries `tdp.epoch`; `torsadesCancel()` bumps it and
  voids them. The state is in `SimSnapshot`. If you add a new way to schedule a torsades event, it
  MUST carry the epoch or disabling the generator will not stop it.
- **Only src === -6 advances the chain** (`tdpFiring`); the paired loop uses src === -7 and never
  touches the state machine. Letting both advance it made the chain branch exponentially.
- **The source steps by QRS AXIS, not by anatomical site** (`advanceIndex`). The path is ordered
  anatomically (spatial continuity keeps the run alive); each site carries the axis a beat from it
  produces, computed as the summed lead-field dipole within 35 mm (`siteAxis`). Do NOT reorder the
  path by axis — tried, runs die in 1-2 beats.
- **The run is gated on the substrate** (`canTrigger`): APD at the EAD site must exceed the take-off
  coupling. This is what makes a normal-QT substrate silent. It is a threshold, not EAD dynamics.
- **QRS detection** (`detectQrs` in measurements.ts) is Pan-Tompkins on the multi-lead spatial slope.
  Two traps, both hit during the rewrite: a median-of-accepted-peaks threshold cascades (one accepted
  P wave admits the rest), and the T-wave rule must reject on slope OR width, not both.
- Dev scripts are type-checked: `npm run typecheck:dev`. QC reproductions live in `scripts/dev/qc/`.

## v1.6.0 notes
- **Torsades cannot be made emergent in this engine, and that is now measured, not assumed.** Capture is
  all-or-nothing (0 % of the ventricle at a 415 ms coupling interval, 100 % at 435 ms); the recovery front
  crosses the ventricle in ~140 ms while a premature wave needs 250-280 ms. Functional re-entry needs a core
  held open by wavefront curvature, which an event-driven graph without diffusion has not got. Do not re-open
  this without switching to a monodomain reaction-diffusion model on a sub-millimetre mesh.
  Experiments: `scripts/dev/tdp-emergent.ts`, `tdp-block.ts`, `tdp-refrac.ts`, `tdp-rotor.ts`.
- Torsades waveform: fractional ring drift (0.6 step/beat) + deep CV restitution (`cvAmplitude` 0.85) so
  activations (211 ms) overlap the cycle (265 ms). Tune with `scripts/dev/tdp-tune.ts <floors> <drifts>
  <pairOffsets> <ringSizes> <margins> <cvAmplitudes>`; render with `tdp-strip2.ts` + `/tmp/claude-0/tdp/strip.py`.
  Only remaining criterion outside target: 3.3 local extrema per complex (target 1-3).
- M cells: `src/simulation/core/mcells.ts`. An ISLAND (Gaussian across the wall x circumference x long axis),
  not a layer - a layer is a face a wave stops at. Blunted by the 4 mm electrotonic smoothing; the LQT2 wedge
  gradient of 12.2 ms/mm is out of reach on a 2.5 mm grid.
- Infarct phases: `ischaemia.phase`. Dead nodes are dropped from the LEAD FIELD by excluding whole edges
  (`computeLeadField(model, chest, exclude)`), which keeps Sum W = 0; zeroing their amplitude instead puts a
  DC offset on the whole cycle. They still conduct at CV x 0.3, or the QRS goes to 450 ms.
  Measure with `scripts/dev/infarct-phases.ts <culprit> <leads>`.

## Where things are
- Source: `/home/claude/cardiosim` (git; one commit per milestone). Delivered copy: `D:\ECG\cardiosim-lab\` plus
  `D:\ECG\CardioSim-standalone.html`, `D:\ECG\cardiosim-lab-phase2.zip`, `D:\ECG\CardioSim-demo.mp4`.
- Build: `npm run build` (multi-file) · `npm run build:standalone` (one HTML file, works from file://, workers inlined).
- Tests: `npm test` (72 unit/physiology tests, ~5 min) · `npm run test:e2e` (17 Playwright tests; set `PW_CHROMIUM_PATH`).
- Registry: `src/simulation/scenarios/scenarios.ts` → `npx tsx scripts/export-registry.ts` → `docs/scenario-registry.json`.
- Automation API for scripted control: `window.__cardiosim` (src/automation.ts); used by `video/record.mjs`.
- Video: `node video/record.mjs <framesDir> s1 … s7` (needs `npx vite preview --port 5180`), then `video/encode.sh <framesDir> out.mp4`.
  Captions are burned in; no narration (no local TTS available). Frame capture is slow under software GL (~2–5 s/frame).
- Dev tools: `scripts/dev/rhythm.ts '<json>' [ms]` (beat-by-beat wave trace), `scripts/dev/scenarios.ts [ids]`,
  `scripts/dev/tp06.ts`, `scripts/dev/shots.mjs`, `scripts/dev/filecheck.mjs`.

## Key design facts to remember
- Model frame is LEFT-handed (x left, y inferior, z anterior). All 3-D content sits under `HeartScene.world`
  (mirror x) — always place cameras with `toWorld()`.
- AV conduction is a set of lumped links (`model.links`): 0 = fast pathway (recovery from exit), 1 = slow pathway,
  2–4 = accessory pathways (recovery from entry). Retrograde fast-pathway modes: conducted / concealed (default) / blocked.
- A retrograde link exit or a re-excitation by the same wave creates a child wave (`origin` retrograde / reentry).
- PR is reported only for model-confirmed antegrade P→QRS conduction (`applyRhythmRules` in measurements.ts).
- TP06→tissue mapping values in `TP06_MAPPED` are re-derived by `tests/physiology/ionic.test.ts`.

## Phase 2b notes
- Strip displays now sweep (fixed page + moving cursor); AP panel scrolls in whole-pixel steps; lead-strip amplitude scale only grows (reset on restart) — these removed the flicker in the demo video.
- Restitution: `apdDynamic()` in actionPotential.ts + per-cell `clMem` in the engine (snapshotted).
- Retrograde PMJ delay `hisPurkinje.pmjRetroDelay` (40 ms) — changes PVC/LBBB width.
- Substrates: `model.substrates` (tvCap, svc, ivc, intercaval, cti, scarCore, scarIsthmus, scarBorder, scarPurkinje) masked by `substrateMasks()` in derive.ts; renderer greys blocked nodes.
- Scar VT prototype parameters exist but are hidden (see SCIENTIFIC_LIMITATIONS).
- Rhythm-level analysis: `summariseRhythm()` (ecg-forward/rhythm.ts), `SimData.rhythm()`.

## Next (see IMPLEMENTATION_BACKLOG.md)
1. BBB morphology (RBBB width/axis, LBBB retrograde Purkinje entry) → then promote to validated.
2. Scar-related re-entry (regional CV/block masks) and atrial flutter (anatomical obstacles).
3. EAD-capable ionic model and ionic tissue coupling (needed for TdP); BPS2020/ORd for calcium effects.
4. Bounded torso volume conductor to remove near-field V2–V4 artefacts.
