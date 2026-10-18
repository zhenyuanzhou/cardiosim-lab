/**
 * Torsades de pointes — episode state machine and source path.
 *
 * WHAT IS PHYSIOLOGICAL HERE AND WHAT IS SCRIPTED. This matters more than the waveform, so it is
 * stated first and repeated in the scenario text:
 *
 *   • SCRIPTED: that an episode happens at all. The engine cannot grow a drifting rotor (no diffusion,
 *     so no wavefront curvature and no source-sink mismatch; see SCIENTIFIC_LIMITATIONS.md). The
 *     episode is therefore driven by this state machine rather than emerging from the substrate.
 *   • GATED BY THE SUBSTRATE: whether the state machine is allowed to fire. An EAD takes off during
 *     phase 3 of a long action potential; if the action potential at the trigger site is already over
 *     by the take-off time, there is nothing to take off from. `canTrigger()` enforces exactly that,
 *     so a normal-QT substrate produces no episodes however the generator is configured. In v1.6 and
 *     earlier the generator ran regardless of the substrate, which was the main thing wrong with it.
 *   • EMERGENT GIVEN THE SOURCE: the cycle length (each site is re-excited as soon as that tissue has
 *     recovered, so refractoriness on the long-QT substrate sets the rate), the absence of an
 *     isoelectric baseline (the next wavefront starts while the previous one is still propagating),
 *     self-termination (the run ends when the tissue no longer recovers in time), and every feature of
 *     the 12-lead tracing, because the ECG is computed from the same tissue activation the 3-D view
 *     shows. There is no separate synthetic waveform anywhere in this model.
 *
 * THE SOURCE PATH. The twist of the QRS axis is the point of the rhythm, so the path the source
 * travels is ordered BY THE AXIS EACH SITE PRODUCES rather than by anatomical angle. At the onset of a
 * beat starting at node i only that node is depolarised, so the heart vector is the node's own
 * lead-field dipole row W(i); its frontal angle is the axis that beat starts with. Sorting candidate
 * sites by that angle and advancing a continuous angle by `twistDeg` each beat makes successive beats
 * step the frontal axis by a near-constant increment. (Ordering sites by anatomical angle does not:
 * measured on this geometry, a 16-site anatomical ring stepped the axis by anything from -2 deg to
 * +67 deg per site, and a fractional index that is then ROUNDED repeats a site, then jumps two.)
 *
 * Mapping evidence the design follows:
 *  • Initiation is focal, after a long-short sequence: a long-short ventricular cycle preceded 41 of
 *    44 episodes (Kay et al., JACC 1983), and every mapped episode began with focal (EAD-triggered)
 *    activity (Vandersickel et al., JACC Clin Electrophysiol 2017).
 *  • Perpetuation of longer episodes is re-entrant; short ones stay focal (same study; Van Den Abeele
 *    et al., Front Physiol 2023: 2.7 +/- 1.5 simultaneous loops in non-terminating episodes against
 *    1.3 +/- 0.7 in self-terminating ones).
 *  • The undulating axis comes from DRIFT of the source: nonstationary scroll waves give undulating
 *    ECGs, stationary ones monomorphic ECGs (Gray et al., Circulation 1995).
 *  • During re-entry "excitation fronts were constantly present in the heart", against a silent
 *    interval of about 142 ms in focal torsades (Vandersickel 2017).
 */
import type { CardiacModel } from "./model";
import { CT } from "./model";
import { N_COLS } from "../ecg-forward/leadField";

/**
 * Episode phases. Transitions marked (scripted) are imposed by this machine; those marked (emergent)
 * follow from the tissue state.
 *
 *   idle      --(scripted: every k-th sinus beat)--------------------> priming
 *   priming   --(scripted: next sinus beat is the "short" cycle)-----> trigger
 *   trigger   --(GATED: only if the AP at the trigger site is still
 *                repolarising at the take-off time)------------------> run
 *             --(gate fails)--------------------------------------->  idle
 *   run       --(emergent: a site fails to recover in time, or the
 *                scripted beat budget is exhausted)------------------> recovery
 *   recovery  --(emergent: the next sinus beat captures)------------> idle
 */
/** How many times a re-excitation waits for its site to recover before the run self-terminates. */
export const TDP_MAX_RETRY = 3;

export type TdpPhase = "idle" | "priming" | "trigger" | "run" | "recovery";

export interface TdpState {
  /** Invalidation token: every queued torsades event carries it; a change voids them all. */
  epoch: number;
  phase: TdpPhase;
  /** Index of the current site on the source path. */
  index: number;
  /** Frontal axis (deg) the current site starts a beat with; advanced by twistDeg each beat. */
  angle: number;
  /** Scripted upper bound on the run length (beats remaining). */
  beatsLeft: number;
  /** Node the source is expected to activate next (-1 = none). */
  pending: number;
  /** Node whose long action potential is the EAD source for this episode (-1 = none). */
  gate: number;
  /** Whether the triggered beat has already been redirected to recovered tissue (loop guard). */
  redirected: boolean;
  /** Re-excitation attempts at the current site since the last capture (bounded, see engine). */
  retry: number;
  /** Sinus beats counted since the generator was last armed. */
  sinusCount: number;
  /** Time the current episode started (ms, NaN when idle) — for reporting only. */
  tStart: number;
}

export const newTdpState = (): TdpState => ({ epoch: 0, phase: "idle", index: 0, angle: 0, beatsLeft: 0, pending: -1, gate: -1, redirected: false, retry: 0, sinusCount: 0, tStart: NaN });
export const cloneTdpState = (s: TdpState): TdpState => ({ ...s });

export interface TdpSite {
  node: number;
  /** Frontal-plane angle (deg) of the heart vector this site starts a beat with. */
  axis: number;
}

/**
 * Radius (mm) of the tissue taken to be depolarised while the QRS vector is still growing — about
 * 60 ms of conduction at ventricular velocity. See `siteAxis`.
 */
export const EARLY_QRS_RADIUS = 35;

/**
 * The frontal QRS axis a beat starting at `i` produces.
 *
 * The heart vector of a beat is Σ W(j) over the tissue depolarised so far (the lead field's columns
 * 0–2 are the dipole weights, and Σ over ALL nodes is zero, so the sum over the depolarised set is
 * what is left). Early in the QRS that set is the tissue within roughly one conduction radius of the
 * origin, so summing the dipole weights over that ball predicts the axis the beat will show.
 *
 * The single node's own weight W(i) does NOT predict it: on a voxel grid those weights are dominated
 * by the directions of the grid edges, so they quantise to multiples of 45°. Checked against beats
 * actually simulated from twelve spread sites, this ball sum tracks the measured frontal axis to
 * within about 15°, while the single-node weight is uncorrelated with it.
 */
function siteAxis(model: CardiacModel, W: Float32Array, vent: Int32Array, i: number, radius: number): number {
  const r2 = radius * radius;
  const xi = model.pos[3 * i];
  const yi = model.pos[3 * i + 1];
  const zi = model.pos[3 * i + 2];
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < vent.length; k++) {
    const j = vent[k];
    const dx = model.pos[3 * j] - xi;
    const dy = model.pos[3 * j + 1] - yi;
    const dz = model.pos[3 * j + 2] - zi;
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    const o = j * N_COLS;
    sx += W[o];
    sy += W[o + 1];
  }
  return (Math.atan2(sy, sx) * 180) / Math.PI;
}

/**
 * The source path: mid-wall ventricular sites around the circumference, ordered ANATOMICALLY, each
 * annotated with the frontal QRS axis a beat from it produces.
 *
 * The order is anatomical, not by axis, because the source is a drifting rotor: it travels through
 * adjacent tissue, and each beat's wavefront has to reach the next site to keep the chain going.
 * Sorting the path by axis instead makes consecutive sites spatially unrelated, and the run dies
 * within a beat or two (measured: 11 beats over 1.8 s, against 58 beats with the anatomical order).
 * The axis annotation is what makes the STEP SIZE adaptive — see `advanceIndex` — so the twist comes
 * out even without giving up spatial continuity.
 */
export function torsadesPath(model: CardiacModel, W: Float32Array, bins: number): TdpSite[] {
  const ventList: number[] = [];
  for (let i = 0; i < model.n; i++) if (model.cellType[i] === CT.VENTRICULAR) ventList.push(i);
  const vent = Int32Array.from(ventList);
  const f = model.frame;
  const best: { node: number; score: number }[] = Array.from({ length: bins }, () => ({ node: -1, score: Infinity }));
  for (const i of ventList) {
    const ab = model.apicobasal[i];
    if (ab < 0.25 || ab > 0.75) continue;
    if (Math.abs(model.transmural[i] - 0.5) > 0.3) continue;
    const rx = model.pos[3 * i] - f.baseCenter[0];
    const ry = model.pos[3 * i + 1] - f.baseCenter[1];
    const rz = model.pos[3 * i + 2] - f.baseCenter[2];
    const a = rx * f.septalDir[0] + ry * f.septalDir[1] + rz * f.septalDir[2];
    const b = rx * f.anteriorDir[0] + ry * f.anteriorDir[1] + rz * f.anteriorDir[2];
    const phi = Math.atan2(b, a);
    const k = ((Math.round((phi / (2 * Math.PI)) * bins) % bins) + bins) % bins;
    const score = Math.abs(model.transmural[i] - 0.5) + Math.abs(ab - 0.5);
    if (score < best[k].score) best[k] = { node: i, score };
  }
  return best.filter((x) => x.node >= 0).map(({ node }) => ({ node, axis: siteAxis(model, W, vent, node, EARLY_QRS_RADIUS) }));
}

/**
 * Index of the next source site: walk forward along the anatomical path until the QRS axis has
 * turned by `twistDeg`, always advancing at least one site.
 *
 * This is what replaces `Math.round(position += drift)`. Rounding a fractional index repeats a site
 * and then jumps two (measured on the old 16-site ring at drift 0.6: 0 1 1 2 2 3 4 4 5 5 …), and
 * because the sites were not spaced by equal axis increments the realised twist varied from −2° to
 * +67° per step. Accumulating the axis change instead makes every beat turn the axis by about the
 * same amount, using a variable number of anatomical steps to do it.
 */
export function advanceIndex(path: TdpSite[], from: number, twistDeg: number): number {
  const n = path.length;
  if (n < 2) return from;
  const want = Math.abs(twistDeg);
  const dir = twistDeg >= 0 ? 1 : -1;
  let turned = 0;
  let k = from;
  for (let step = 0; step < n; step++) {
    const next = (((k + dir) % n) + n) % n;
    turned += Math.abs(angleDiff(path[next].axis, path[k].axis));
    k = next;
    if (turned >= want) break;
  }
  return k;
}

/** Shortest signed difference a − b, wrapped to (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/**
 * Substrate gate for the triggered beat.
 *
 * An EAD takes off during phase 3, so a triggered beat at coupling interval `coupling` after the
 * upstroke requires an action potential that is still repolarising then: APD at the trigger site must
 * exceed the take-off time. This is the whole of the model's claim to substrate dependence — it says
 * "a normal action potential has nothing to take off from", not that this model computes EAD dynamics
 * in tissue (it does not; the take-off time itself is measured in the TP06 single cell).
 */
export function canTrigger(apdAtSite: number, coupling: number): boolean {
  return apdAtSite > coupling;
}

/**
 * Where the triggered wavefront actually emerges.
 *
 * The EAD takes off during phase 3 of a long action potential, so the cell it arises in is itself
 * still refractory: the propagating beat is carried by the nearest tissue that HAS recovered. This
 * returns the path site closest in axis to the EAD source among those out of their refractory period
 * at time `t`, which is why the first complex of an episode starts near — but not at — the long-QT
 * zone. Returns null if nothing has recovered, in which case the EAD does not propagate at all.
 */
export function emergenceSite(path: TdpSite[], axis: number, t: number, lastAct: Float64Array, erp: Float32Array): TdpSite | null {
  let best: TdpSite | null = null;
  let bd = Infinity;
  for (const s of path) {
    if (t - lastAct[s.node] < erp[s.node]) continue;
    const d = Math.abs(angleDiff(s.axis, axis));
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}
