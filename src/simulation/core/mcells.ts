/**
 * Midmyocardial (M) cells — the layer this model was missing.
 *
 * WHY. Until v1.5 the ventricular action-potential duration varied monotonically across the wall
 * (endocardium longest, epicardium shortest). Real ventricle is not monotonic: a band of
 * midmyocardial cells with weak slow delayed-rectifier current (IKs) and a large late Na⁺ current
 * repolarises LAST, so the transmural profile has a hump in the middle of the wall. The difference
 * matters for two things this simulator does:
 *
 *  1. The end of the T wave. Transmural dispersion of repolarisation (TDR) is what the Tpeak–Tend
 *     interval measures: the peak of the T coincides with epicardial repolarisation and its end with
 *     the latest (M) repolarisation (Yan & Antzelevitch, Circulation 1998;98:1928).
 *  2. Torsades. In the arterially perfused LQT2 wedge, transmural dispersion rises from 2.7 ± 0.9 to
 *     12.2 ± 2.1 ms/mm and "islands of midmyocardial (M) cells formed zones of increased
 *     refractoriness … directly responsible for conduction block and self-sustained intramural
 *     reentrant circuits underlying TdP" (Akar, Yan, Antzelevitch & Rosenbaum, Circulation
 *     2002;105:1247). A monotonic gradient cannot do this: its longest-APD region is a face of the
 *     wall, which a wavefront stops at but cannot circle. An island can be circled, which is what
 *     makes functional re-entry — and therefore an emergent torsades — possible here.
 *
 * SHAPE. APD gains `mCellBoost · w(i)` ms, with w the product of three Gaussians:
 *   • across the wall, centred on the deep subepicardium (transmural 0.45, SD 0.33);
 *   • around the circumference, centred on the LV lateral wall (SD 55°), tapering to a floor
 *     elsewhere, because M cells are unevenly distributed — the "unique topographical distribution"
 *     of the title above;
 *   • along the long axis, centred mid-ventricle (SD 0.22 of base→apex).
 * The last two bound the zone IN THE PLANE OF THE WALL, which is what makes it an island a wavefront
 * can travel around; a band that merely spans the wall is a layer, and a wave stops at it instead.
 *
 * The transmural SD is deliberately wider than the wedge profile. The intact wall here is smoothed by
 * an electrotonic radius of 4 mm (`ventricles.electrotonicSmoothing`), which is more than the whole
 * thickness of a sharp M band, so a thin band is erased — the same electrotonic blunting that makes
 * transmural dispersion smaller in the intact heart than in an isolated wedge. The widths are NOMINAL:
 * the wedge studies give a transmural profile, not a 3-D density map. The amplitude is calibrated —
 * see SCIENTIFIC_LIMITATIONS.md ("M cells").
 */
import type { CardiacModel } from "./model";
import { CT } from "./model";

/** Centre and width of the M band across the wall (0 = endocardium, 1 = epicardium). */
export const M_TRANSMURAL_CENTRE = 0.45;
export const M_TRANSMURAL_SD = 0.33;
/** Circumferential centre (deg from mid-septum; 180° = LV lateral wall) and width of the island. */
export const M_PHI_CENTRE = 180;
export const M_PHI_SD = 55;
/** Centre and width of the island along the long axis (0 = base, 1 = apex). */
export const M_LONG_CENTRE = 0.45;
export const M_LONG_SD = 0.22;
/** Density away from the island centre, as a fraction of the peak (septum and RV retain some M cells). */
export const M_FLOOR = 0.25;

const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * Per-node weight 0…1 of the M-cell band. Ventricular myocardium only; 0 elsewhere.
 * Cached on the model, because it depends only on geometry.
 */
export interface MShape {
  transmuralSd: number;
  phiSd: number;
  longSd: number;
  floor: number;
}
export const M_SHAPE: MShape = { transmuralSd: M_TRANSMURAL_SD, phiSd: M_PHI_SD, longSd: M_LONG_SD, floor: M_FLOOR };

const cache = new WeakMap<CardiacModel, Map<string, Float32Array>>();
export function mCellWeights(model: CardiacModel, shape: MShape = M_SHAPE): Float32Array {
  const key = `${shape.transmuralSd}|${shape.phiSd}|${shape.longSd}|${shape.floor}`;
  let byShape = cache.get(model);
  if (!byShape) cache.set(model, (byShape = new Map()));
  const hit = byShape.get(key);
  if (hit) return hit;
  const w = new Float32Array(model.n);
  const f = model.frame;
  for (let i = 0; i < model.n; i++) {
    if (model.cellType[i] !== CT.VENTRICULAR) continue;
    const rx = model.pos[3 * i] - f.baseCenter[0];
    const ry = model.pos[3 * i + 1] - f.baseCenter[1];
    const rz = model.pos[3 * i + 2] - f.baseCenter[2];
    const a = rx * f.septalDir[0] + ry * f.septalDir[1] + rz * f.septalDir[2];
    const b = rx * f.anteriorDir[0] + ry * f.anteriorDir[1] + rz * f.anteriorDir[2];
    const phi = (Math.atan2(b, a) * 180) / Math.PI;
    const zt = (model.transmural[i] - M_TRANSMURAL_CENTRE) / shape.transmuralSd;
    const zp = wrap(phi - M_PHI_CENTRE) / shape.phiSd;
    const zl = (model.apicobasal[i] - M_LONG_CENTRE) / shape.longSd;
    const across = Math.exp(-0.5 * zt * zt);
    const inPlane = shape.floor + (1 - shape.floor) * Math.exp(-0.5 * (zp * zp + zl * zl));
    w[i] = across * inPlane;
  }
  byShape.set(key, w);
  return w;
}
