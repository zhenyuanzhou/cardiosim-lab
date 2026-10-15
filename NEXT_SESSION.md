# NEXT_SESSION — checkpoint

_Last updated: end of Phase 2 (Milestones 1–6 complete; demo video produced from the running app)._

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

## Next (see IMPLEMENTATION_BACKLOG.md)
1. BBB morphology (RBBB width/axis, LBBB retrograde Purkinje entry) → then promote to validated.
2. Scar-related re-entry (regional CV/block masks) and atrial flutter (anatomical obstacles).
3. EAD-capable ionic model and ionic tissue coupling (needed for TdP); BPS2020/ORd for calcium effects.
4. Bounded torso volume conductor to remove near-field V2–V4 artefacts.
