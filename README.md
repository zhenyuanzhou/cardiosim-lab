# CardioSim Lab

Interactive cardiac electrophysiology and 12-lead ECG simulator. One causal simulation links cell action potentials, spatial activation of an idealised heart and a forward-computed 12-lead ECG on a single clock. Change a parameter, and the ECG changes because the simulated electrophysiology changed.

> **Research education and concept demonstration only.** This is not a clinically validated diagnostic system or a patient-specific prediction tool, and it does not predict clinical drug effects.

## Quick start

### Option A — no installation
Double-click **`CardioSim-standalone.html`** and open it in a recent Chrome, Edge or Firefox. Everything is inside that one file. Without internet the fonts fall back to system fonts; nothing else changes.

### Option B — development version (Windows, macOS, Linux)
Requires **Node.js 20.19+ or 22.12+** (https://nodejs.org).

```powershell
cd D:\ECG\cardiosim-lab
npm install
npm run dev          # opens http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check and build a static site in `dist/` (serve with `npm run preview`) |
| `npm run build:standalone` | Build one self-contained HTML file in `dist-standalone/index.html` |
| `npm test` | 38 physiology / simulation / ECG unit tests (Vitest, about 2–3 min) |
| `npm run test:e2e` | 7 browser tests (Playwright). First time: `npx playwright install chromium` |
| `npm run validate` | Prints a baseline report: ECG-measured intervals vs model timings vs references |

## Using the app

| Panel | Contents |
|---|---|
| **A · Activation** | 3-D voxel heart. Colour by membrane potential, activation isochrones (10 ms bands) or refractory state. Drag to rotate, shift-drag to pan, wheel to zoom. AP/LL/INF views, cut-away, layer toggles. Click any cell to add its AP to Panel B. |
| **B · Action potentials** | SA node, atrium, AV node, His, LV endo/epi and other cells on one time axis with lead II. Shows phase 0–4 labels, APD90 bar and ERP marker. |
| **C · 12-lead ECG** | Standard 3×4 + rhythm-strip layout or selected leads. 25/50 mm/s, 5/10/20 mm/mV, 500/1000 Hz. Calipers, *Inspect* (click the ECG to freeze time and see what the heart is doing), and SVG/PNG/CSV export. Below it: signal-derived measurements next to the model's own timings, and the causal event log with simulator timestamps. |
| **D · Controls** | Scenarios, searchable parameters with units, reference values, evidence tags and "why?" notes, explanations of each change with measured before/after effects, the validation dashboard, the A/B overlay, and an About page. |

**Keyboard.** Space play/pause · ← → step 20 ms · [ ] previous/next beat.

**Live changes.** In *live* mode a parameter change takes effect at the current display time. The simulation is replayed deterministically up to that point and continues with the new value. Use *restart* to begin again at t = 0.

**Save/Load.** Scenarios are JSON files containing the full parameter set and sampling rate.

## What is and is not simulated (Phase 1)

| Simulated | Reduced-order | Not yet |
|---|---|---|
| Activation sequence, conduction delay/block, refractoriness, overdrive reset, rate-dependent AV conduction, ECG timing | Action-potential shapes, APD restitution, AV node, ECG amplitudes, idealised anatomy | Ionic currents, EAD/DAD, reentry/AF/VT/VF, accessory pathways, ischaemia, drugs (Phases 2–5) |

The details are in `docs/FIDELITY_MATRIX.md`. The baseline (default parameters, measured from the simulated ECG) is HR 66, PR 156 ms, QRS 84 ms, QT 372 ms, QTc 390 ms and QRS axis +18°; the model gives AH 65 ms and HV 41 ms.

## Documentation
- `docs/ARCHITECTURE.md`: layered model, runtime architecture, folder/module structure
- `docs/FIDELITY_MATRIX.md`: fidelity levels, output classes, limitations
- `docs/PARAMETER_DEPENDENCIES.md`: causal graph, defaults with evidence tags, planned parameters
- `docs/ROADMAP.md`: phased plan and next priorities
- `docs/VALIDATION.md`: what the tests check
- `docs/REFERENCES.md`: sources (with DOIs/PMIDs) and which values have none
