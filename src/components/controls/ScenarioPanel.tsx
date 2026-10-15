import { useState } from "react";
import { SCENARIOS, type Scenario } from "../../simulation/scenarios/scenarios";
import { useStore } from "../../state/store";
import { applyLive, restart } from "../../state/actions";

const STATUS_LABEL: Record<Scenario["status"], string> = {
  "validated-baseline": "validated baseline",
  preview: "preview · unvalidated",
  planned: "planned",
};

export function ScenarioPanel() {
  const scenarioId = useStore((s) => s.scenarioId);
  const set = useStore((s) => s.set);
  const params = useStore((s) => s.params);
  const [sel, setSel] = useState<string>(scenarioId === "custom" ? "nsr" : scenarioId);
  const s = SCENARIOS.find((x) => x.id === sel) ?? SCENARIOS[0];
  const families = [...new Set(SCENARIOS.map((x) => x.family))];
  return (
    <>
      <p className="note">
        Phase 1 validates normal sinus rhythm. "Preview" entries are produced by the same Phase-1 mechanisms (no hard-coded waveforms) but have not yet been checked against reference data.
      </p>
      <div style={{ display: "grid", gap: 6 }}>
        {families.map((f) => (
          <div key={f}>
            <p className="h3">{f}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {SCENARIOS.filter((x) => x.family === f).map((x) => (
                <button
                  key={x.id}
                  className={`btn ${sel === x.id ? "on" : ""}`}
                  style={{ opacity: x.status === "planned" ? 0.55 : 1, whiteSpace: "normal", textAlign: "left" }}
                  onClick={() => setSel(x.id)}
                  data-scenario={x.id}
                >
                  {x.name}
                  {scenarioId === x.id && " ●"}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="card" data-testid="scenario-card">
        <h4>{s.name}</h4>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className={`badge ${s.status === "validated-baseline" ? "ok" : s.status === "preview" ? "warn" : ""}`}>{STATUS_LABEL[s.status]}</span>
          <span className="badge">Phase {s.phase}</span>
          <span className="badge">{s.fidelity}</span>
        </div>
        {s.status !== "planned" ? (
          <dl className="kv">
            <dt>Mechanism</dt>
            <dd>{s.mechanism}</dd>
            <dt>Structures</dt>
            <dd>{s.structures}</dd>
            <dt>Parameters</dt>
            <dd>{s.changes}</dd>
            <dt>Activation</dt>
            <dd>{s.activation}</dd>
            <dt>Expected ECG</dt>
            <dd>{s.ecg}</dd>
            <dt>Initiation</dt>
            <dd>{s.initiation}</dd>
            <dt>Limitations</dt>
            <dd>{s.limitations}</dd>
          </dl>
        ) : (
          <p className="note">{s.limitations}</p>
        )}
        {s.apply && (
          <div className="toolbar">
            <button
              className="btn primary"
              onClick={() => {
                set({ scenarioId: s.id });
                restart(s.apply!(params));
              }}
            >
              Load (restart at t = 0)
            </button>
            {s.id !== "nsr" && (
              <button
                className="btn"
                onClick={() => {
                  set({ scenarioId: s.id });
                  applyLive(s.apply!(useStore.getState().params));
                }}
                title="Apply the parameter changes at the current display time to watch the transition"
              >
                Apply live
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
