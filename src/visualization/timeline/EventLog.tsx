/** Time-synchronised causal event log: timestamps are the simulator's own, per beat. */
import { sim, useStore } from "../../state/store";
import { seek } from "../frameLoop";
import type { WaveInfo } from "../../simulation/core/engine";
import { RG } from "../../simulation/core/model";
import type { ModelMeta } from "../../simulation/worker/protocol";

const ORIGIN: Record<string, string> = {
  sinus: "Sinus beat",
  junctional: "Junctional escape",
  "ventricular-escape": "Ventricular escape",
  ectopic: "Ectopic beat",
  retrograde: "Retrograde / re-entrant beat",
  reentry: "Re-entrant beat",
};

type Kind = "san" | "atrialStart" | "avnIn" | "avnBlock" | "atrialEnd" | "avnOut" | "his" | "bundles" | "purkinje" | "ventStart" | "ventEnd" | "atrialRepol" | "ventRepol" | "origin";

/** What each event means and how it relates to the surface ECG (shown when an event is clicked). */
const EXPLAIN: Record<Kind, string> = {
  origin: "The impulse originates here. Pacemaker depolarisation itself involves too little tissue to be seen on the surface ECG.",
  san: "SA-node depolarisation is ECG-silent: the P wave starts only when enough atrial myocardium is activated.",
  atrialStart: "Atrial myocardium begins to depolarise → P-wave onset. The P wave is the lead-field-weighted sum of atrial wavefronts, not the atrial membrane voltage.",
  avnIn: "The impulse enters the AV node. Nodal conduction is slow and ECG-silent; it occupies most of the PR segment.",
  avnBlock: "The AV node is still refractory: the impulse stops here — a P wave without a QRS.",
  atrialEnd: "All atrial cells are depolarised → end of the P wave (atrial repolarisation, Ta, is small and hidden in the PR segment/QRS).",
  avnOut: "The impulse leaves the AV node into the His bundle (end of the AH interval).",
  his: "His bundle activation — ECG-silent at the body surface (recorded only with an intracardiac catheter).",
  bundles: "Bundle branches carry the impulse to both sides of the septum; still ECG-silent.",
  purkinje: "Purkinje network spreads activation over the endocardium within a few tens of ms — the reason the normal QRS is narrow.",
  ventStart: "First ventricular myocardium depolarises → QRS onset (usually left mid-septum → initial septal q/r).",
  ventEnd: "The last ventricular region (typically posterobasal) depolarises → end of the QRS (J point).",
  atrialRepol: "Atrial repolarisation ends (normally buried in the QRS).",
  ventRepol: "The last ventricular cell repolarises (APD90) → near the end of the T wave. QT spans earliest activation to latest recovery, not one cell's APD.",
};

export function nodesFor(kind: Kind, w: WaveInfo, meta: ModelMeta): number[] {
  const out: number[] = [];
  const byRegion = (...rs: number[]) => {
    for (let i = 0; i < meta.n; i++) if (rs.includes(meta.region[i])) out.push(i);
    return out;
  };
  const near = (node: number, r: number) => {
    if (node < 0) return out;
    const P = meta.pos;
    for (let i = 0; i < meta.n; i++) if (Math.hypot(P[3 * i] - P[3 * node], P[3 * i + 1] - P[3 * node + 1], P[3 * i + 2] - P[3 * node + 2]) < r) out.push(i);
    return out;
  };
  switch (kind) {
    case "origin":
      return near(w.originNode, 8);
    case "san":
      return byRegion(RG.SAN);
    case "atrialStart":
      return near(meta.san, 14);
    case "avnIn":
    case "avnBlock":
    case "avnOut":
      return near(meta.avn, 7);
    case "atrialEnd":
      return byRegion(RG.LA);
    case "his":
      return byRegion(RG.HIS);
    case "bundles":
      return byRegion(RG.LBB, RG.RBB, RG.LAF, RG.LPF, RG.LSF);
    case "purkinje":
      return byRegion(RG.PURK_LV, RG.PURK_RV);
    case "ventStart":
      return near(w.firstVentNode, 10);
    case "ventEnd":
    case "ventRepol":
      return near(w.lastVentNode, 10);
    default:
      return out;
  }
}

export function milestones(w: WaveInfo): [number, string, Kind][] {
  const m: [number, string, Kind][] = [];
  const add = (t: number, s: string, k: Kind) => Number.isFinite(t) && m.push([t, s, k]);
  if (w.origin === "sinus") add(w.t0, "SA node fires", "san");
  else add(w.t0, `${ORIGIN[w.origin] ?? w.origin}${w.site ? ` (${w.site})` : ""} starts`, "origin");
  add(w.tFirstAtrial, "Atrial activation begins (P wave onset)", "atrialStart");
  if (w.avnBlocked) add(w.tAvnIn, "Impulse BLOCKED in AV node (refractory)", "avnBlock");
  else add(w.tAvnIn, "Impulse enters AV node (low septal RA)", "avnIn");
  add(w.tLastAtrial, "Atrial activation complete", "atrialEnd");
  add(w.tAvnOut, `AV nodal exit → His bundle${w.avnPath === "avn-slow" ? " (slow pathway)" : ""}`, "avnOut");
  add(w.tHisDistal, "His bifurcation reached", "his");
  add(Math.min(w.tFirstLBB, w.tFirstRBB), "Bundle branches activated", "bundles");
  add(Math.min(w.tFirstPurkinjeLV, w.tFirstPurkinjeRV), "Purkinje network activation begins", "purkinje");
  add(w.tFirstVent, "First ventricular myocardium activated (QRS onset)", "ventStart");
  add(w.tLastVent, "Ventricular activation complete", "ventEnd");
  add(w.tAtrialRepolEnd, "Atrial repolarisation complete", "atrialRepol");
  add(w.tVentRepolEnd, "Last ventricular cell repolarised (APD90)", "ventRepol");
  return m.sort((a, b) => a[0] - b[0]);
}

export function EventLog() {
  const t = useStore((s) => s.shownTime);
  const data = sim.data;
  if (!data) return null;
  const ws = data.wavesSorted().filter((w) => w.t0 <= t);
  const show = ws.slice(-2);
  return (
    <div className="evlog" data-testid="event-log">
      <p className="h3">Causal event log (times from the simulator)</p>
      {show.length === 0 && <div className="note">Waiting for the first beat…</div>}
      {show.map((w) => {
        const ms = milestones(w);
        let nowIdx = -1;
        ms.forEach(([tt], i) => {
          if (tt <= t) nowIdx = i;
        });
        return (
          <div key={w.id}>
            <div className="beat">
              {ORIGIN[w.origin] ?? w.origin} #{w.id} · t₀ = {(w.t0 / 1000).toFixed(3)} s
            </div>
            {ms.map(([tt, label, kind], i) => (
              <div
                key={label}
                className={`row ${tt <= t ? "done" : ""} ${i === nowIdx ? "now" : ""}`}
                onClick={() => {
                  seek(tt + 0.5);
                  useStore.getState().set({ playing: false, highlight: sim.meta ? { nodes: nodesFor(kind, w, sim.meta), label: `${label} — ${EXPLAIN[kind]}` } : null });
                }}
                style={{ cursor: "pointer" }}
                title="Jump to this instant, highlight the structure and explain it"
              >
                <span className="mono">{(tt - w.t0).toFixed(0).padStart(4)} ms</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
