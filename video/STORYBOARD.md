# Demo video — script and storyboard

File: `CardioSim-demo.mp4`
- 1920×1080, 30 fps, H.264, 3 min 10 s.
- Captions are burned in. There is no narration, because no reliable local text-to-speech engine was available.
- Every frame is a screenshot of the running application (production build). The recorder in `video/record.mjs` steps the shared simulation clock deterministically.
- Animated scenes capture 15 distinct frames per second; each frame is shown twice in the 30 fps file because software rendering of WebGL is slow.

| # | Time | View | Content and captions |
|---|---|---|---|
| 1 | 0:00–0:08 | Simulator (dimmed) + title card | "CardioSim Lab — From Cardiac Electrophysiology to the 12-Lead ECG"; recorded from the running application; reduced-order educational model |
| 2 | 0:08–0:43 | Split view, NSR, one beat at ≈ 1/27 speed | SA node fires (ECG-silent) → atrial activation → P wave (lead-field sum, not membrane voltage) → AV-nodal delay = PR segment → His/bundles/Purkinje (silent) → septum first, free walls → QRS → plateau → ST → recovery gradients → T; QT ≠ one cell's APD |
| 3 | 0:43–1:19 | Leads & Vectors, II vs aVR, then V1 vs V6 | Lead definitions, projection of the heart vector (exact for limb leads), aVR mirrors II; chest leads referenced to the Wilson central terminal; lead field vs dipole estimate; septal r/q, LV dominance |
| 4 | 1:19–1:49 | Simulator, scenario "PVC" | LV-lateral focus, coupling 450 ms; no P; wide QRS; discordant ST–T; concealed retrograde AV-nodal conduction blocks the next P; fully compensatory pause |
| 5 | 1:49–2:14 | A/B mode, A = default, B = LBBB | Septum activated from the right (no septal q in I/V6); slow LV activation → broad QRS; QRS ≈ 140 ms (meets the Strauss 2011 LBBB criterion of ≥ 140 ms); secondary ST–T |
| 6 | 2:14–3:02 | Simulator + Ionic cell tab | TP06 IKr −50 %: APD90 rises in epi/M/endo cells (most in M cell); mapped to tissue APD × 1.085 and applied live; QT lengthens, QRS unchanged; Explain tab shows the measured effect |
| 7 | 3:02–3:10 | Closing card | "Understand the mechanisms behind the waveform." / "Interactive cardiac electrophysiology education — Not for clinical use." |

To reproduce:
1. `npm run build && npx vite preview --port 5180`
2. `node video/record.mjs frames s1 s2 s3 s4 s5 s6 s7`
3. `bash video/encode.sh frames CardioSim-demo.mp4`
