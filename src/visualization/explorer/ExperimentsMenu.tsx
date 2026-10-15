/** Experiment menu (filled in Milestone 3; registry lives in experiments.ts). */
import { useState } from "react";
import { EXPERIMENTS } from "./experiments";
import { useStore } from "../../state/store";
import { restart } from "../../state/actions";
import { EctopyQuick } from "../../components/controls/EctopyQuick";

export function ExperimentsMenu() {
  const [open, setOpen] = useState(false);
  const active = useStore((s) => s.experimentId);
  const cur = EXPERIMENTS.find((e) => e.id === active);
  return (
    <div className="exp-menu">
      <button className={`btn ${open ? "on" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open} data-testid="experiments-button">
        Experiments{cur ? `: ${cur.short}` : ""} ▾
      </button>
      {open && (
        <div className="exp-pop card" role="menu">
          {EXPERIMENTS.map((e) => (
            <div key={e.id} className="exp-item">
              <div>
                <b>{e.title}</b>
                <div className="note">{e.summary}</div>
                <div className="note"><i>Fidelity: {e.fidelity}</i></div>
              </div>
              <div className="toolbar">
                {e.variants.map((v) => (
                  <button
                    key={v.id}
                    className="btn"
                    title={v.look}
                    data-variant={`${e.id}:${v.id}`}
                    onClick={() => {
                      useStore.getState().set({ scenarioId: `exp:${v.id}` });
                      restart(v.params());
                      useStore.getState().set({ experimentId: e.id, explorerLeads: v.leads ?? useStore.getState().explorerLeads });
                      setOpen(false);
                    }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Popover with the premature-beat controls (explorer and split views). */
export function EctopyMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="exp-menu">
      <button className={`btn ${open ? "on" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open} data-testid="ectopy-button">
        Premature beats ▾
      </button>
      {open && (
        <div className="exp-pop" role="dialog">
          <EctopyQuick compact />
        </div>
      )}
    </div>
  );
}
