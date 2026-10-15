/** Time-synchronised causal event log: timestamps are the simulator's own, per beat. */
import { sim, useStore } from "../../state/store";
import { seek } from "../frameLoop";
import type { WaveInfo } from "../../simulation/core/engine";

const ORIGIN: Record<string, string> = {
  sinus: "Sinus beat",
  junctional: "Junctional escape",
  "ventricular-escape": "Ventricular escape",
  ectopic: "Ectopic beat",
};

export function milestones(w: WaveInfo): [number, string][] {
  const m: [number, string][] = [];
  const add = (t: number, s: string) => Number.isFinite(t) && m.push([t, s]);
  if (w.origin === "sinus") add(w.t0, "SA node fires");
  else add(w.t0, `${ORIGIN[w.origin]} pacemaker fires`);
  add(w.tFirstAtrial, "Atrial activation begins (P wave onset)");
  if (w.avnBlocked) add(w.tAvnIn, "Impulse BLOCKED in AV node (refractory)");
  else add(w.tAvnIn, "Impulse enters AV node (low septal RA)");
  add(w.tLastAtrial, "Atrial activation complete");
  add(w.tAvnOut, "AV nodal exit → His bundle");
  add(w.tHisDistal, "His bifurcation reached");
  add(Math.min(w.tFirstLBB, w.tFirstRBB), "Bundle branches activated");
  add(Math.min(w.tFirstPurkinjeLV, w.tFirstPurkinjeRV), "Purkinje network activation begins");
  add(w.tFirstVent, "First ventricular myocardium activated (QRS onset)");
  add(w.tLastVent, "Ventricular activation complete");
  add(w.tAtrialRepolEnd, "Atrial repolarisation complete");
  add(w.tVentRepolEnd, "Last ventricular cell repolarised (APD90)");
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
              {ORIGIN[w.origin]} #{w.id} · t₀ = {(w.t0 / 1000).toFixed(3)} s
            </div>
            {ms.map(([tt, label], i) => (
              <div
                key={label}
                className={`row ${tt <= t ? "done" : ""} ${i === nowIdx ? "now" : ""}`}
                onClick={() => seek(tt + 0.5)}
                style={{ cursor: "pointer" }}
                title="Jump to this instant"
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
