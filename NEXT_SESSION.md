# NEXT_SESSION — checkpoint

_Last updated: Phase 2, after Milestones 1–2 (+ engine work for 3–4)._

## State
- Source: `/home/claude/cardiosim` (git). Deliverables are copied to `D:\ECG` at the end of each delivery.
- Build: `npx vite build` (dev), standalone single file: `npm run build:standalone` (see README).
- Tests: `npx vitest run` (unit/physiology, ~3–5 min), `npx playwright test` (e2e; set `PW_CHROMIUM_PATH`).
- Dev scripts: `scripts/dev/rhythm.ts '<json override>' [ms]` prints a beat-by-beat wave trace;
  `scripts/dev/scenarios.ts [ids]` surveys registry scenarios; `scripts/dev/shots.mjs <dir> [modes]` screenshots
  (needs `npx vite preview --port 5180`).

## Done in Phase 2 so far
- M1 heart view: Three.js smooth surfaces (surface nets from the analytic anatomy), layers, view presets,
  picking, great vessels for orientation (context only), **handedness fix** (model frame is left-handed → mirror group).
- M2 explorer: torso + electrodes, lead axes, projection bar, hexaxial and horizontal planes, lead strips with
  dipole estimate, lead info card, split view, resizable/maximisable panels, presentation mode.
- Engine: generic lumped links (AVN fast/slow, 3 accessory pathways) with collision, concealed retrograde conduction,
  ectopy (single/once/bigeminy/trigeminy/couplet/run/focus) at 10 named sites, sinus arrest, SA exit block,
  infra-His block (k:k−1 and complete), BBB/fascicle block flags, re-entry wave bookkeeping (child waves).
- Measurements: arrhythmia-aware PR (only with model-confirmed P–QRS relation), JT and QRS ≥ 120 note, origin label,
  overlap merge for broad complexes, truncated-T guard.
- Scenario registry with 5 status classes and 8 criteria (`src/simulation/scenarios/scenarios.ts`).
- Experiments A–F (`src/visualization/explorer/experiments.ts`), lessons L1–L8 with quizzes.

## Next
1. Write `tests/physiology/scenarios.test.ts` matching every `validation` string in the registry; downgrade any
   scenario whose test cannot pass.
2. Export registry JSON to `docs/scenario-registry.json`.
3. A/B side-by-side animation; clickable events → highlight; narrow ECG layout fix.
4. TP06 ionic single-cell lab (equations: cbcbeat `tentusscher_panfilov_2006_*`), Group E partial items.
5. e2e tests (exports, responsive), docs, video.
