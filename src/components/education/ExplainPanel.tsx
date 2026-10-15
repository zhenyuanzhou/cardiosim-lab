import { sim, useStore } from "../../state/store";
import { explain } from "./explainEngine";
import { seek } from "../../visualization/frameLoop";

export function ExplainPanel() {
  const changes = useStore((s) => s.paramChanges);
  useStore((s) => s.shownTime); // refresh as new beats are simulated
  const data = sim.data;
  if (!data) return null;
  const beats = data.measure();
  const list = [...changes].reverse().slice(0, 8);
  return (
    <>
      <p className="note">
        Each card is generated from the parameter metadata AND from the simulation itself: the numbers compare the beats measured just before the change with steady beats after it.
      </p>
      {list.length === 0 && (
        <div className="card">
          <h4>No parameter changes yet</h4>
          <p>
            Change a slider in <b>Parameters</b> (live mode). The simulation re-runs from the current display time and this panel reports what changed in conduction, refractoriness and the ECG.
          </p>
        </div>
      )}
      {list.map((c) => {
        const ex = explain(c, beats, data.waves);
        return (
          <div className="card" key={c.id} data-testid="explanation">
            <h4>{ex.title}</h4>
            <div className="note">
              applied at t = {(c.at / 1000).toFixed(2)} s ·{" "}
              <button className="linkbtn" onClick={() => seek(c.at - 300)}>
                jump there
              </button>
            </div>
            <dl className="kv">
              <dt>Structure</dt>
              <dd>{ex.structure}</dd>
              <dt>Mechanism</dt>
              <dd>{ex.mechanism}</dd>
              <dt>Prediction</dt>
              <dd>{ex.prediction}</dd>
            </dl>
            <p className="h3" style={{ marginTop: 4 }}>
              Measured in the simulation
            </p>
            {ex.effects === null ? (
              <p className="note">Waiting for complete beats after the change{ex.pendingBeats ? ` (${ex.pendingBeats} more)` : ""}…</p>
            ) : ex.effects.length === 0 ? (
              <p className="note">No change above measurement resolution in timing, intervals or axis.</p>
            ) : (
              <table className="meas">
                <tbody>
                  {ex.effects.map((e) => (
                    <tr key={e.label}>
                      <td>
                        {e.label} <span className="note">({e.source})</span>
                      </td>
                      <td className="mono">{e.before.toFixed(0)}</td>
                      <td className="mono">→ {e.after.toFixed(0)}</td>
                      <td className={`mono ${e.after > e.before ? "up" : "down"}`}>
                        {e.after > e.before ? "+" : ""}
                        {(e.after - e.before).toFixed(0)} {e.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="note">{ex.limitations}</p>
          </div>
        );
      })}
    </>
  );
}
