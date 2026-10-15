import { useState } from "react";
import { SCENARIOS, type Criteria, type ScenarioStatus } from "../../simulation/scenarios/scenarios";
import { useStore } from "../../state/store";
import { applyLive, restart } from "../../state/actions";

const STATUS_LABEL: Record<ScenarioStatus, string> = {
  validated: "implemented · validated",
  incomplete: "implemented · incomplete",
  partial: "partially simulated",
  placeholder: "placeholder",
  unsupported: "not supported yet",
};
const STATUS_CLASS: Record<ScenarioStatus, string> = { validated: "ok", incomplete: "warn", partial: "warn", placeholder: "", unsupported: "" };
const CRITERIA: [keyof Criteria, string][] = [
  ["mechanism", "Physiological mechanism"],
  ["initialization", "Parameter initialisation"],
  ["activationSequence", "Simulated activation sequence"],
  ["ecg", "ECG generated & faithful"],
  ["actionPotential", "Action potentials (where supported)"],
  ["explanation", "Causal explanation"],
  ["validation", "Automated validation"],
  ["ui", "Functional UI controls"],
];

export function ScenarioPanel() {
  const scenarioId = useStore((s) => s.scenarioId);
  const set = useStore((s) => s.set);
  const [sel, setSel] = useState<string>(SCENARIOS.some((x) => x.id === scenarioId) ? scenarioId : "nsr");
  const s = SCENARIOS.find((x) => x.id === sel) ?? SCENARIOS[0];
  const groups = [...new Set(SCENARIOS.map((x) => x.group))];
  const counts = SCENARIOS.reduce<Record<string, number>>((a, x) => ((a[x.status] = (a[x.status] ?? 0) + 1), a), {});
  const load = (live: boolean) => {
    if (!s.apply) return;
    set({ scenarioId: s.id, explorerLeads: s.leads.length ? s.leads.slice(0, 3) : useStore.getState().explorerLeads });
    if (live) applyLive(s.apply());
    else restart(s.apply());
  };
  return (
    <>
      <p className="note">
        Every runnable scenario is a parameter set for the same simulator — no stored waveforms. Status:{" "}
        {(Object.keys(STATUS_LABEL) as ScenarioStatus[])
          .filter((k) => counts[k])
          .map((k) => `${counts[k]} ${STATUS_LABEL[k]}`)
          .join(" · ")}
        .
      </p>
      <div style={{ display: "grid", gap: 6 }}>
        {groups.map((g) => (
          <div key={g}>
            <p className="h3">{g}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {SCENARIOS.filter((x) => x.group === g).map((x) => (
                <button
                  key={x.id}
                  className={`btn ${sel === x.id ? "on" : ""}`}
                  style={{ opacity: x.status === "unsupported" ? 0.5 : 1, whiteSpace: "normal", textAlign: "left" }}
                  onClick={() => setSel(x.id)}
                  data-scenario={x.id}
                  data-status={x.status}
                  title={STATUS_LABEL[x.status]}
                >
                  {x.status === "validated" ? "✓ " : x.status === "unsupported" ? "○ " : "◐ "}
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
          <span className={`badge ${STATUS_CLASS[s.status]}`}>{STATUS_LABEL[s.status]}</span>
          <span className="badge">{s.modelClass}</span>
        </div>
        {s.status !== "unsupported" ? (
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
            <dt>Validation</dt>
            <dd>{s.validation}</dd>
          </dl>
        ) : (
          <p className="note">{s.limitations}</p>
        )}
        <details>
          <summary className="note">Completeness criteria ({Object.values(s.criteria).filter(Boolean).length}/8)</summary>
          <ul className="note" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {CRITERIA.map(([k, l]) => (
              <li key={k} style={{ color: s.criteria[k] ? "var(--ok)" : "var(--fg-faint)" }}>
                {s.criteria[k] ? "✓" : "✗"} {l}
              </li>
            ))}
          </ul>
        </details>
        {s.apply && (
          <div className="toolbar">
            <button className="btn primary" onClick={() => load(false)} data-testid="scenario-load">
              Load (restart at t = 0)
            </button>
            {s.id !== "nsr" && (
              <button className="btn" onClick={() => load(true)} title="Apply the parameter changes at the current display time to watch the transition">
                Apply live
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
