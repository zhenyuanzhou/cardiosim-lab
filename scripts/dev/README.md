Development scripts used while calibrating the Phase-1 model (run with `npx tsx scripts/dev/<file>.ts`):

- `tune.ts '<json>'` — run the baseline with anatomy/parameter overrides; prints QRS/T axes, R/S amplitudes per lead, activation-time profile.
- `decomp.ts '<json>' <channel>` — decomposes a lead's QRS integral by tissue group.
- `measure.ts '<json params>'` — signal-derived measurements vs model timings for a parameter set.
- `signcheck.ts` — forward-model sign check with a synthetic wavefront.
- `perf.ts` — timing of 5 s of simulation.
