# Implementation backlog (prioritised)

1. **BBB morphology.**
   - Limit retrograde Purkinje entry in LBBB (PMJ entry asymmetry).
   - Revisit RV mass and trans-septal conduction for RBBB QRS width and axis.
   - Add tests on V1/V6 morphology once the model reproduces it.
2. **Fascicular blocks.** LAF/LPF axis shifts need a better fascicle–Purkinje geometry.
3. **Scar-related re-entrant VT.** Prototype geometry exists (hidden); needs a finer mesh or a source–sink-aware propagation rule to give inducible VT with CL 300–500 ms instead of spontaneous fast re-entry.
4. **Flutter/AF realism.** Anatomically realistic atria (larger RA circuit without the very slow CTI factor), f/F-wave morphology validation, atrial dynamic restitution data.
5. **VF, polymorphic VT, TdP.** These need a continuum (monodomain) ionic tissue model.
6. **EAD-capable ionic model.** E.g. ORd or BPS2020, the latter for the [Ca²⁺]o dependence. Couple ionic models to tissue (operator splitting on a coarse mesh).
7. **Detector.**
   - QRS offset for broad complexes with immediate ST deviation.
   - P detection inside the preceding T.
8. **Torso volume conductor.** A bounded, inhomogeneous torso (BEM) to replace the scalar limb/chest gains and reduce near-field artefacts in V2–V4.
9. **Dynamic APD restitution** (memory) and β-adrenergic APD effects.
10. **Use-dependent Na⁺-channel block** and AV-nodal ionic modulation (Ca²⁺-channel blockers).
