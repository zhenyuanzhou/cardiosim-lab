/**
 * Beat-to-beat QRS morphology, used to tell a monomorphic ventricular rhythm from a polymorphic
 * one and to detect the rotating axis of torsades de pointes.
 *
 * The heart vector P = (Px, Py, Pz) is output channels 12–14 of the simulated ECG. During each
 * depolarisation the vector sweeps a loop; the direction of its largest frontal-plane excursion is
 * that beat's electrical axis. A monomorphic rhythm repeats one axis; a polymorphic rhythm does
 * not; torsades additionally rotates the axis progressively, so successive beats step around the
 * circle in a consistent direction instead of jumping at random.
 *
 * Beat instants are taken from the simulator's own activation records (the first ventricular
 * activation of each wave) rather than detected from the ECG. In a wide-complex rhythm the T wave
 * can rival the QRS in both size and rate of change, so ECG-only detection double-counts beats;
 * the activation records are unambiguous.
 *
 * These are descriptors of the simulated signal, not clinical diagnostic criteria.
 */
import { N_CHANNELS } from "./leadField";

export interface MorphologySummary {
  /** Frontal-plane axis of each beat, degrees in [−180, 180). */
  axes: number[];
  /** The activation times used (ms). */
  times: number[];
  /** Circular standard deviation of the axes (degrees); small = monomorphic. */
  axisDispersion: number;
  /**
   * Net rotation per beat (degrees, signed). A consistently signed value of appreciable size is
   * the "twisting" of torsades; random polymorphism averages towards zero.
   */
  meanRotation: number;
  /** Fraction of consecutive steps rotating the same way as `meanRotation` (0.5 = random). */
  rotationConsistency: number;
}

const TAU = Math.PI * 2;
const EMPTY: MorphologySummary = { axes: [], times: [], axisDispersion: NaN, meanRotation: NaN, rotationConsistency: NaN };

/**
 * Frontal-plane axis of each beat.
 *
 * Activations closer together than `mergeMs` are treated as ONE beat. Two wavefronts that start a
 * few milliseconds apart — two triggered foci firing almost together, say — depolarise the
 * ventricles as a single fused QRS with one axis, and counting them separately would both double
 * the apparent rate and make a smoothly rotating axis look like a zigzag.
 *
 * @param ecg          interleaved ECG buffer (N_CHANNELS per sample)
 * @param dt           sample interval (ms)
 * @param activations  activation times (ms) — e.g. `tFirstVent` of each wave
 * @param window       how long after each activation to look for the peak vector (ms)
 * @param mergeMs      activations within this of the previous one belong to the same QRS
 */
export function analyseMorphology(ecg: Float32Array, dt: number, activations: number[], window = 120, mergeMs = 80): MorphologySummary {
  const nSamples = ecg.length / N_CHANNELS;
  const axes: number[] = [];
  const times: number[] = [];
  const sorted = [...activations].sort((a, b) => a - b);
  const merged: number[] = [];
  for (const t of sorted) if (!merged.length || t - merged[merged.length - 1] > mergeMs) merged.push(t);
  for (const t of merged) {
    const i0 = Math.max(0, Math.round(t / dt));
    const i1 = Math.min(nSamples - 1, Math.round((t + window) / dt));
    if (i1 <= i0) continue;
    let bi = i0;
    let best = -1;
    for (let i = i0; i <= i1; i++) {
      const o = i * N_CHANNELS;
      const mg = Math.hypot(ecg[o + 12], ecg[o + 13]);
      if (mg > best) {
        best = mg;
        bi = i;
      }
    }
    const o = bi * N_CHANNELS;
    axes.push((Math.atan2(ecg[o + 13], ecg[o + 12]) * 180) / Math.PI);
    times.push(bi * dt);
  }
  if (axes.length < 2) return { ...EMPTY, axes, times };

  let sx = 0;
  let sy = 0;
  for (const a of axes) {
    sx += Math.cos((a * Math.PI) / 180);
    sy += Math.sin((a * Math.PI) / 180);
  }
  const R = Math.hypot(sx, sy) / axes.length;
  const axisDispersion = (Math.sqrt(Math.max(0, -2 * Math.log(Math.max(1e-9, R)))) * 180) / Math.PI;

  const steps: number[] = [];
  for (let k = 1; k < axes.length; k++) {
    let d = (((axes[k] - axes[k - 1]) * Math.PI) / 180) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    steps.push((d * 180) / Math.PI);
  }
  const meanRotation = steps.reduce((a, b) => a + b, 0) / steps.length;
  const sameWay = steps.filter((s) => Math.sign(s) === Math.sign(meanRotation)).length;
  return { axes, times, axisDispersion, meanRotation, rotationConsistency: sameWay / steps.length };
}
