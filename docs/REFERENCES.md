# References

Each entry says what the model uses it for. Entries with a DOI were checked against PubMed metadata during development. Entries listed with a PMID only were matched by citation in PubMed but their full text was not re-read.

## Anchors for default values and calibration targets

| Reference | Used for |
|---|---|
| Lee YS, Lien WP. Left ventricular approach for recording His bundle potential in man. *Chest* 1975;67:696–701. doi:10.1378/chest.67.6.696 | AH 76 ± 16 ms, HV 45 ± 6 ms, His potential 19 ± 3 ms, PA 28 ± 7 ms (calibration targets) |
| Jose AD, Collison D. The normal range and determinants of the intrinsic heart rate in man. *Cardiovasc Res* 1970;4:160–167. doi:10.1093/cvr/4.2.160 | Intrinsic heart rate ≈ 118.1 − 0.57 × age |
| van Schie MS et al. Identification of local atrial conduction heterogeneities using high-density conduction velocity estimation. *Europace* 2021;23:1815–1825. doi:10.1093/europace/euab088 | Atrial CV ≈ 0.9 m/s (median, sinus rhythm) |
| Franz MR, Swerdlow CD, Liem LB, Schaefer J. Cycle length dependence of human action potential duration in vivo. *J Clin Invest* 1988;82:972–979. doi:10.1172/JCI113706 | Steady-state APD–CL slope ≈ 23 ms per 100 ms (restitution fit) |
| Franz MR et al. Monophasic action potential mapping in human subjects with normal electrocardiograms. *Circulation* 1987;75:379–386. doi:10.1161/01.cir.75.2.379 | Epicardial vs endocardial repolarisation times (transmural gradient calibration); APD inversely related to activation time |
| Durrer D et al. Total excitation of the isolated human heart. *Circulation* 1970;41:899–912. PMID 5482907 | Ventricular activation sequence (early left septal/paraseptal sites, late posterobasal regions) |
| Taggart P et al. Inhomogeneous transmural conduction during early ischaemia in patients with coronary artery disease. *J Mol Cell Cardiol* 2000;32:621–630. doi:10.1006/jmcc.2000.1105 | Order of magnitude of transmural activation time in human LV (≈ 13 ms between plunge terminals) |
| Opthof T et al. Cardiac activation–repolarization patterns and ion channel expression mapping in intact isolated normal human hearts. *Heart Rhythm* 2017;14:265–272. doi:10.1016/j.hrthm.2016.10.010 | Human repolarisation gradients occur along all axes and differ between hearts (justifies `nominal` apicobasal gradient) |
| Meijborg VMF et al. Electrocardiographic T wave and its relation with ventricular repolarization along major anatomical axes. *Circ Arrhythm Electrophysiol* 2014;7:524–531. doi:10.1161/CIRCEP.113.001622 | Repolarisation dispersion along axes (pig); transmural dispersion small (14 ± 7 ms) |
| Surawicz B et al. AHA/ACCF/HRS recommendations … Part III: intraventricular conduction disturbances. *Circulation* 2009;119:e235–e240. PMID 19228822 | QRS limits in validation checks |
| Rautaharju PM et al. AHA/ACCF/HRS recommendations … Part IV: the ST segment, T and U waves, and the QT interval. *Circulation* 2009;119:e241–e250. PMID 19228821 | QTc limits in validation checks |
| Kligfield P et al. Recommendations for the standardization and interpretation of the electrocardiogram, Part I. *Circulation* 2007;115:1306–1324. PMID 17322457 | Lead definitions, paper conventions |

## Model and method choices

| Reference | Used for |
|---|---|
| Mitchell CC, Schaeffer DG. A two-current model for the dynamics of cardiac membrane. *Bull Math Biol* 2003;65:767–793. doi:10.1016/S0092-8240(03)00041-7 | Functional form of the APD restitution map |
| Sun J, Amellal F, Glass L, Billette J. Alternans and period-doubling bifurcations in atrioventricular nodal conduction. *J Theor Biol* 1995;173:79–91. doi:10.1006/jtbi.1995.0045 | Form of the AV nodal recovery model (recovery term in Phase 1; facilitation and fatigue in Phase 2) |
| Neic A et al. Efficient computation of electrograms and ECGs in human whole heart simulations using a reaction-eikonal model. *J Comput Phys* 2017;346:191–211. doi:10.1016/j.jcp.2017.06.020 | Justification for decoupling activation (eikonal/graph) from Vm waveforms when computing ECGs |
| van Oosterom A, Oostendorp TF. ECGSIM: an interactive tool for studying the genesis of QRST waveforms. *Heart* 2004;90:165–168. PMID 14729788 | Activation/recovery-time-driven QRST simulation for teaching |
| Kléber AG, Rudy Y. Basic mechanisms of cardiac impulse propagation and associated arrhythmias. *Physiol Rev* 2004;84:431–488. PMID 15044680 | Order of magnitude for ventricular CV and anisotropy (nominal defaults) |
| Gima K, Rudy Y. Ionic current basis of electrocardiographic waveforms: a model study. *Circ Res* 2002;90:889–896. PMID 11988490 | Background: transmural heterogeneity and T-wave genesis |
| ten Tusscher KHWJ, Panfilov AV. Alternans and spiral breakup in a human ventricular tissue model. *Am J Physiol Heart Circ Physiol* 2006;291:H1088–H1100. PMID 16565318 | Candidate Level‑3 ionic model for Phase 4 |
| Fridericia LS (translation). *Ann Noninvasive Electrocardiol* 2003;8:343–351. PMID 14516292 | QTc (Fridericia) formula |

## Values without a direct source

Every parameter tagged `nominal` in the app, and the scalar torso transfer factors, are teaching or modelling choices. They are not measurements. This covers the autonomic coefficients, AV nodal recovery amplitude/τ/ERP, bundle and Purkinje CVs, PMJ delay, anisotropy ratio, ERP/APD ratios, smoothing radius, the APD floor and CV restitution.

## Phase 2 additions
- ten Tusscher KHWJ, Panfilov AV. Alternans and spiral breakup in a human ventricular tissue model. Am J Physiol Heart Circ Physiol 2006;291:H1088–H1100. doi:10.1152/ajpheart.00109.2006 — TP06 equations as distributed in cbcbeat (gotran/CellML translation).
- Bartolucci C, Passini E, Hyttinen J, Paci M, Severi S. Simulation of the effects of extracellular calcium changes leads to a novel computational model of human ventricular action potential with a revised calcium handling. Front Physiol 2020;11:314. doi:10.3389/fphys.2020.00314 — most human AP models (including ORd) fail to reproduce the inverse APD–[Ca²⁺]o dependence; the basis for marking calcium disorders unsupported.
- Sun J, Amellal F, Glass L, Billette J. Alternans and period-doubling bifurcations in atrioventricular nodal conduction. J Theor Biol 1995;173:79–91 — AV-nodal recovery term reused for the slow pathway.
- Cable-theory relation CV ∝ √(dV/dt_max) used for the ionic→tissue CV mapping is an approximation (uniform fibre); no numerical calibration to human data is claimed.
- Accessory-pathway, slow-pathway and ectopy parameters are nominal (no data source); they are chosen to demonstrate mechanisms.
