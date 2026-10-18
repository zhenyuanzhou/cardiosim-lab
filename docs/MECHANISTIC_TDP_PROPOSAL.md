# A staged route to mechanistic torsades

This is a design proposal, not an implementation. It exists because the present model cannot make
torsades emerge from the substrate, and the reason is structural rather than a matter of tuning:
the engine is an event-driven graph with conduction delays and refractory periods, so it has no
diffusion, hence no wavefront curvature and no source–sink mismatch. Functional re-entry needs an
obstacle that persists for a whole lap, and in a real heart that obstacle is the rotor core held open
by curvature. Only anatomical obstacles work here, which is why flutter and scar VT are validated and
torsades is not. The measurements behind that conclusion are in SCIENTIFIC_LIMITATIONS.md.

Nothing below should be attempted as a modification of the current engine. Each stage is a separate
solver with its own validation, and each is useful on its own even if the next is never built.

## Stage 1 — a single cell that produces EADs on demand

**What.** Extend the existing TP06 implementation (`src/simulation/cellular/`) with the currents that
control early afterdepolarisations: the L-type calcium window current, the sodium–calcium exchanger,
and a late sodium current. Drive it with the Vandersickel 2014 EAD configuration already used to
measure the 390 ms take-off time.

**Why first.** The present model takes the take-off time from a single-cell measurement and then
*imposes* a triggered beat at that coupling interval. A cell model that produces EADs as a function of
IKr block, rate and calcium loading turns that imposed number into a computed one.

**Validation.** Bifurcation diagram of EAD amplitude and take-off time against gKr, pacing cycle
length and extracellular potassium; compare with the published dependence of EAD incidence on rate
(bradycardia-dependent) and on IKr block. Convergence: halve the integration step and require the
take-off time to move by less than 1 ms.

**Cost.** Small. This is an extension of code that already exists.

## Stage 2 — a one-dimensional cable

**What.** A monodomain cable of 100–200 cells at 0.1–0.2 mm spacing with explicit diffusion
(∂V/∂t = −I_ion/C_m + D ∂²V/∂x²), with a transmural distribution of cell types (endocardial,
midmyocardial, epicardial) taken from the wedge studies.

**Why.** This is the smallest system in which the quantity the whole argument turns on — whether a
premature wavefront *blocks* at a zone of long refractoriness instead of propagating through it —
becomes a property of the model rather than an assumption. It also gives the electrotonic smoothing
that the current model applies as a fixed radius, as an emergent consequence of D.

**Validation.** Reproduce the transmural dispersion of repolarisation of the arterially perfused
wedge: 2.7 ± 0.9 ms/mm in control and 12.2 ± 2.1 ms/mm under IKr block (Akar et al., *Circulation*
2002;105:1247). Reproduce the measured conduction velocity and its restitution. Reproduce
unidirectional block of a premature stimulus at the M-cell zone as a function of coupling interval —
the thing the present engine cannot do, where capture is all-or-nothing between 415 and 435 ms.
Convergence: halve Δx and Δt and require the block window to shift by less than 5 ms.

**Cost.** Moderate. A 1-D monodomain solver is a few hundred lines; the cell model dominates runtime.

## Stage 3 — a two-dimensional sheet

**What.** A monodomain sheet, 5 × 5 cm at 0.1–0.25 mm, with fibre anisotropy and the same transmural
cell-type distribution, large enough to hold a rotor (a spiral wave needs a few centimetres of
excitable medium at these wavelengths).

**Why.** This is where a rotor can exist, drift and be measured, and therefore where torsades stops
being imposed. The twisting QRS would then be computed from a drifting spiral rather than scripted.

**Validation.** Spiral-wave induction by cross-field (S1–S2) stimulation; tip trajectory and drift
velocity against the optical-mapping literature; dominant frequency; the dependence of drift on the
repolarisation gradient. The ECG would be computed from the sheet with the existing forward model, and
the same torsades criteria (`src/simulation/ecg-forward/tdpMetrics.ts`) applied to it, so the
acceptance test is unchanged. Convergence: halve Δx and require the rotor period to move by less than
5 % and the tip trajectory to stay within one space step.

**Cost.** Large. A 500 × 500 grid at 0.02 ms for several seconds is on the order of 10⁹ cell updates
per second of simulated time — minutes to hours per run on a CPU, real-time only on a GPU. This is
also why it cannot simply replace the interactive model: the present engine runs 24 s of twelve-lead
ECG in about a second, which is what makes the teaching tool usable.

## What this does not do

A mechanistic sheet would make the arrhythmia emergent, but it would still not predict whether a given
drug causes torsades in people. That needs the proarrhythmia pipeline the CiPA initiative defines
(patch-clamp block of several currents → cell model → population of models → clinical ECG), and the
step from "this model produces an EAD" to "this compound carries clinical risk" is an epidemiological
claim, not a simulation result.

## Relationship to the present model

The current reduced-order engine would remain the interactive one. Stages 1–3 are an offline reference
against which its reduced-order assumptions can be checked — the same role the TP06 cell already plays
for the tissue APD/CV mapping. If stage 3 were built, the sensible product of it would be a library of
pre-computed activation sequences the interactive model could replay, not a live solver in the browser.
