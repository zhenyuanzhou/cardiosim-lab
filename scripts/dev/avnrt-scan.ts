/** AVNRT: tachycardia CL and surface VA (QRS onset -> retrograde atrial onset) vs nodal parameters. */
import { SCENARIOS } from "../../src/simulation/scenarios/scenarios";
import { buildCardiacModel } from "../../src/simulation/tissue/buildModel";
import { Simulator } from "../../src/simulation/core/engine";
import { sanitizeParams } from "../../src/simulation/core/params";
import { computeLeadField } from "../../src/simulation/ecg-forward/leadField";
const m = buildCardiacModel(); const W = computeLeadField(m);
const base = SCENARIOS.find((s) => s.id === "avnrt")!.apply!;
export function measure(edit: (p: any) => void) {
  const p = base(); edit(p);
  const sim = new Simulator(m, sanitizeParams(p as unknown as Record<string, unknown>), W); sim.run(10000);
  const ws = sim.drain().waves.filter((w) => w.origin === "retrograde" && Number.isFinite(w.tFirstVent) && Number.isFinite(w.tFirstAtrial)).sort((a, b) => a.tFirstVent - b.tFirstVent);
  if (ws.length < 4) return { n: ws.length, cl: NaN, va: NaN, ah: NaN };
  const k = ws.length - 2; const cl = ws[k + 1].tFirstVent - ws[k].tFirstVent;
  // retrograde atrial activation produced after this QRS = next wave's atrial onset
  const va = ws[k + 1].tFirstAtrial - ws[k].tFirstVent;
  return { n: ws.length, cl, va, avn: ws[k].tAvnOut - ws[k].tAvnIn, path: ws[k].avnPath };
}
if (process.argv[2] === "scan") {
  for (const rt of [60, 30, 15]) for (const sl of [200, 230, 260]) for (const re of [180, 150]) {
    const r = measure((p) => { p.avNode.retroTime = rt; p.avNode.slowAhMin = sl; p.avNode.retroErp = re; });
    console.log(`retroTime=${rt} slowAhMin=${sl} retroErp=${re} -> n=${r.n} CL=${r.cl?.toFixed(0)} VA=${r.va?.toFixed(0)} AVNtransit=${(r as any).avn?.toFixed(0)} ${(r as any).path}`);
  }
}
