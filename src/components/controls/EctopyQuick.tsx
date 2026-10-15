/**
 * Premature-beat controls: fire one premature beat now, or start a repeating pattern, from a
 * chosen atrial or ventricular site. Everything is applied live at the current time through the
 * ordinary parameter path (deterministic replay), so the event log, APs, vectors and ECG all show it.
 */
import { useState } from "react";
import { SITE_LABELS, cloneParams, isAtrialSite, type EctopicSite, type EctopyPattern } from "../../simulation/core/params";
import { useStore } from "../../state/store";
import { applyLive } from "../../state/actions";

const SITES: EctopicSite[] = ["lv-lateral", "rvot", "rv-apex", "septum", "lv-apex", "lv-anterobasal", "lv-inferobasal", "ra-high", "ra-low", "la"];
const PATTERNS: [EctopyPattern, string, string][] = [
  ["single", "Single every 4 beats", "one premature beat after every 4th normal beat"],
  ["bigeminy", "Bigeminy", "after every normal beat"],
  ["trigeminy", "Trigeminy", "after every 2nd normal beat"],
  ["couplet", "Couplets", "two in a row after every 4th beat"],
];

export function EctopyQuick({ compact = false }: { compact?: boolean }) {
  const params = useStore((s) => s.params);
  const e = params.ectopy;
  const [site, setSite] = useState<EctopicSite>(e.site !== "none" ? e.site : "lv-lateral");
  const [coupling, setCoupling] = useState<number>(isAtrialSite(site) ? 520 : 450);
  const [msg, setMsg] = useState<string | null>(null);
  const apply = (pattern: EctopyPattern | "off", shot = false) => {
    const p = cloneParams(useStore.getState().params);
    if (pattern === "off") p.ectopy = { ...p.ectopy, site: "none" };
    else p.ectopy = { ...p.ectopy, site, pattern, coupling, every: pattern === "once" ? 1 : 4, shot: shot ? p.ectopy.shot + 1 : p.ectopy.shot };
    useStore.getState().set({ scenarioId: "custom" });
    applyLive(p);
    setMsg(
      pattern === "off"
        ? "Ectopy stopped."
        : pattern === "once"
          ? `One ${isAtrialSite(site) ? "premature atrial" : "premature ventricular"} beat from ${SITE_LABELS[site]} will fire ${coupling} ms after the next ${isAtrialSite(site) ? "P-wave onset" : "QRS onset"}.`
          : `${pattern} from ${SITE_LABELS[site]} (coupling ${coupling} ms) — applied live.`,
    );
  };
  const active = e.site !== "none";
  return (
    <div className={`card ectopy-quick ${compact ? "compact" : ""}`} data-testid="ectopy-quick">
      <h4>Premature beats</h4>
      <div className="toolbar">
        <label>
          Site
          <select value={site} onChange={(ev) => {
            const s = ev.target.value as EctopicSite;
            setSite(s);
            setCoupling(isAtrialSite(s) ? 520 : 450);
          }} data-testid="ectopy-site">
            <optgroup label="Ventricular">
              {SITES.filter((s) => !isAtrialSite(s)).map((s) => <option key={s} value={s}>{SITE_LABELS[s]}</option>)}
            </optgroup>
            <optgroup label="Atrial">
              {SITES.filter((s) => isAtrialSite(s)).map((s) => <option key={s} value={s}>{SITE_LABELS[s]}</option>)}
            </optgroup>
          </select>
        </label>
        <label>
          Coupling
          <input type="range" min={250} max={800} step={10} value={coupling} onChange={(ev) => setCoupling(+ev.target.value)} aria-label="Coupling interval" />
          <span className="mono">{coupling} ms</span>
        </label>
      </div>
      <div className="toolbar">
        <button className="btn primary" onClick={() => apply("once", true)} data-testid="fire-ectopic">
          Fire one premature beat
        </button>
        {PATTERNS.map(([p, label, title]) => (
          <button key={p} className={`btn ${active && e.pattern === p && e.site === site ? "on" : ""}`} title={title} onClick={() => apply(p)} data-pattern={p}>
            {label}
          </button>
        ))}
        <button className="btn" onClick={() => apply("off")} disabled={!active}>
          Stop
        </button>
      </div>
      <p className="note">
        {msg ??
          (active
            ? `Active: ${e.pattern} from ${SITE_LABELS[e.site]}, coupling ${e.coupling} ms.`
            : "Coupling is measured from the preceding QRS onset (ventricular sites) or P-wave onset (atrial sites). Too short a coupling falls in the refractory period and does not capture.")}
      </p>
    </div>
  );
}
