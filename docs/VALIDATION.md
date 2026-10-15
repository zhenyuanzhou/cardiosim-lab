# Validation

Run `npm test` for the 38 unit/physiology tests (about 2–3 min) and `npm run test:e2e` for the 7 browser tests. The last full run passed every test.

## Normal physiology (tests/physiology)
| Test | Criterion |
|---|---|
| Only sinus beats in NSR | latent pacemakers stay suppressed |
| Activation order every beat | SA ≤ first atrial ≤ AV in ≤ AV out ≤ His ≤ bundles ≤ Purkinje ≤ first V ≤ last V |
| 1:1 conduction | every sinus wave activates all atrial and all ventricular cells exactly once |
| RA before LA | first RA activation < first LA activation |
| Durrer sequence | first ventricular cell in septum/LV endocardium; last cell basal (apicobasal < 0.35); left septum before RV free wall |
| Rate | RR = autonomically modulated SA cycle (±1 sample) |
| AH, HV | within ±2 SD of Lee & Lien 1975 |
| PR, P, QRS, QTc, axes | adult normal ranges (signal-derived) |
| Morphology stability | QRS range ≤ 4 ms, QT range ≤ 6 ms beat-to-beat |
| T concordance | QRS and T areas both positive in II and V5 |
| Restitution | steady-state APD–CL slope 0.20–0.27 (Franz 1988 ≈ 0.23); APD monotonic in DI |
| Rate effects | faster rate → shorter QT and longer AH; vagal tone → longer RR and PR |

## Simulation and conduction (tests/simulation)
| Test | Criterion |
|---|---|
| Determinism | identical parameters and seed give bit-identical ECG and records |
| Checkpoint replay | restore + replay reproduces the continuation exactly |
| Live change | PR changes only after the change time |
| Long AH | PR +100 ms or more, QRS unchanged |
| AV refractoriness > recovery time | some P waves have no ventricular activation (blocked), others conduct |
| Sinus arrest | junctional escape at about 45 bpm with narrow QRS |
| RBB slowing | QRS +20 ms or more, last cell in RV |
| LBB slowing | last cell in LV, activation > 100 ms |
| Premature ventricular stimulus | whole-ventricle activation, wide QRS, retrograde His activation |
| Stimulus in ERP | blocked |
| No sustained reentry in normal substrate | after the ectopic wave, all ventricular activations are sinus |
| One activation per cell per wave | holds for all cells |

## ECG signal (tests/ecg)
| Test | Criterion |
|---|---|
| Einthoven / Goldberger | residual < 1e‑5 mV |
| Lead field | column sums ≈ 0 |
| Sign | wave toward the chest gives positive V2 and Pz |
| Isoelectric rest | zero before first SA discharge |
| Common timing | each lead's QRS onset within 20 ms of first ventricular activation |
| ECG ↔ activation | QRS onset ±6 ms, QRS ±10 ms, PR ±10 ms, QT ±20 ms vs model timings |
| Reproducible measurements | identical runs give identical measurements |
| Activation-vector changes | RBB: terminal V1 more positive and lead I more negative; LBB: initial lead I forces rise; LAF: QRS wider (left-axis deviation **not yet** reproduced) |

## Browser (tests/integration)
App loads with all panels drawn and the clock running · pause freezes time · a live AV-nodal change prolongs the measured PR and produces an explanation with measured effects · ECG inspect shows the heart state · validation tab passes lead and coherence checks · A/B comparison shows ΔQRS > 15 ms for RBB slowing · CSV export has the 12-lead header.

## Not validated
No clinical validation. Amplitudes, morphology details and every "preview" scenario are unvalidated. See `FIDELITY_MATRIX.md`.
