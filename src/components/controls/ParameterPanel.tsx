import { useMemo, useRef, useState } from "react";
import { DEFAULT_PARAMS, PARAM_GROUPS, PARAM_META, getParam, setParam, type ParamMeta, type ParamValue } from "../../simulation/core/params";
import { sim, useStore } from "../../state/store";
import { applyLive, loadScenarioJson, resetDefaults, restart, saveScenarioJson } from "../../state/actions";
import { paramWarnings } from "../education/explainEngine";
import { download } from "../../visualization/ecg/ECGPanel";

function SwitchRow({ m, onCommit }: { m: ParamMeta; onCommit: (path: string, v: ParamValue) => void }) {
  const params = useStore((s) => s.params);
  const v = getParam(params, m.path);
  const ref = getParam(DEFAULT_PARAMS, m.path);
  const [open, setOpen] = useState(false);
  const id = `p-${m.path.replace(".", "-")}`;
  return (
    <div className="param" data-param={m.path}>
      <div className="row">
        {m.kind === "boolean" ? (
          <label className="name" htmlFor={id}>
            <input id={id} type="checkbox" checked={v as boolean} onChange={(e) => onCommit(m.path, e.target.checked)} /> {m.label}
          </label>
        ) : (
          <>
            <label className="name" htmlFor={id}>
              {m.label}
            </label>
            <select id={id} value={v as string} onChange={(e) => onCommit(m.path, e.target.value)}>
              {m.options!.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </>
        )}
        <span className={`val ${v !== ref ? "changed" : ""}`}>{v !== ref ? "changed" : ""}</span>
      </div>
      <div className="meta">
        <span />
        <button className="linkbtn" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "less" : "why?"}
        </button>
      </div>
      {open && (
        <dl className="kv" style={{ marginTop: 4 }}>
          <dt>Structure</dt>
          <dd>{m.structure}</dd>
          <dt>Mechanism</dt>
          <dd>{m.mechanism}</dd>
          <dt>Prediction</dt>
          <dd>{m.prediction}</dd>
        </dl>
      )}
    </div>
  );
}

function ParamRow({ m, onCommit }: { m: ParamMeta; onCommit: (path: string, v: ParamValue) => void }) {
  if (m.kind === "boolean" || m.kind === "choice") return <SwitchRow m={m} onCommit={onCommit} />;
  return <NumberRow m={m} onCommit={onCommit} />;
}

function NumberRow({ m, onCommit }: { m: ParamMeta; onCommit: (path: string, v: ParamValue) => void }) {
  const params = useStore((s) => s.params);
  const committed = getParam(params, m.path) as number;
  const [draft, setDraft] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const ref = getParam(DEFAULT_PARAMS, m.path) as number;
  const v = draft ?? committed;
  const timer = useRef<number | null>(null);
  const commit = (x: number) => {
    setDraft(null);
    if (x !== committed) onCommit(m.path, x);
  };
  const id = `p-${m.path.replace(".", "-")}`;
  const decimals = m.step < 0.01 ? 3 : m.step < 0.1 ? 2 : m.step < 1 ? 1 : 0;
  return (
    <div className="param" data-param={m.path}>
      <div className="row">
        <label className="name" htmlFor={id}>
          {m.label}
        </label>
        <span className={`val ${committed !== ref ? "changed" : ""}`}>
          {v.toFixed(decimals)} {m.unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={m.min}
        max={m.max}
        step={m.step}
        value={v}
        onChange={(e) => {
          const x = +e.target.value;
          setDraft(x);
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => commit(x), 350);
        }}
        onPointerUp={(e) => {
          if (timer.current) window.clearTimeout(timer.current);
          commit(+(e.target as HTMLInputElement).value);
        }}
        onKeyUp={(e) => {
          if (timer.current) window.clearTimeout(timer.current);
          commit(+(e.target as HTMLInputElement).value);
        }}
      />
      <div className="meta">
        <span>
          ref {ref} {m.unit}
          {committed !== ref && (
            <>
              {" · "}
              <button className="linkbtn" onClick={() => onCommit(m.path, ref)}>
                reset
              </button>
            </>
          )}
        </span>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span className={`ev ${m.evidence}`} title={m.source}>
            {m.evidence}
          </span>
          <button className="linkbtn" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "less" : "why?"}
          </button>
        </span>
      </div>
      {open && (
        <dl className="kv" style={{ marginTop: 4 }}>
          <dt>Structure</dt>
          <dd>{m.structure}</dd>
          <dt>Mechanism</dt>
          <dd>{m.mechanism}</dd>
          <dt>Prediction</dt>
          <dd>{m.prediction}</dd>
          <dt>Source</dt>
          <dd>{m.source}</dd>
        </dl>
      )}
    </div>
  );
}

export function ParameterPanel() {
  const params = useStore((s) => s.params);
  const set = useStore((s) => s.set);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"live" | "restart">("live");
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const warnings = useMemo(() => paramWarnings(null, params), [params]);
  const ql = q.trim().toLowerCase();
  const match = (m: ParamMeta) => !ql || `${m.label} ${m.structure} ${m.group} ${m.mechanism}`.toLowerCase().includes(ql);

  const onCommit = (path: string, v: ParamValue) => {
    const next = setParam(useStore.getState().params, path, v);
    set({ scenarioId: "custom" });
    if (mode === "live") {
      applyLive(next);
      setMsg(`Applied at t = ${(sim.data ? useStore.getState().shownTime / 1000 : 0).toFixed(2)} s — see Explain for the measured effect.`);
    } else {
      restart(next);
      setMsg("Restarted from t = 0 with the new value.");
    }
  };

  return (
    <>
      <div className="toolbar">
        <input className="search" placeholder="Search parameters (e.g. bundle, APD, vagal)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search parameters" id="param-search" />
      </div>
      <div className="toolbar">
        <span className="note">Apply changes</span>
        <div className="seg">
          <button className={mode === "live" ? "on" : ""} onClick={() => setMode("live")} title="Change takes effect at the current display time">live</button>
          <button className={mode === "restart" ? "on" : ""} onClick={() => setMode("restart")} title="Restart the simulation from t = 0">restart</button>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={resetDefaults}>Reset all</button>
      </div>
      <div className="toolbar">
        <button className="btn" onClick={() => download(`cardiosim-scenario.json`, saveScenarioJson(), "application/json")}>Save scenario</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>Load…</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          id="scenario-file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const err = loadScenarioJson(await f.text());
            setMsg(err ?? `Loaded ${f.name}.`);
            e.target.value = "";
          }}
        />
        <button
          className="btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(saveScenarioJson());
              setMsg("Scenario JSON copied.");
            } catch {
              setMsg("Clipboard unavailable.");
            }
          }}
        >
          Copy JSON
        </button>
      </div>
      {msg && <div className="note" role="status">{msg}</div>}
      {warnings.map((w, i) => (
        <div key={i} className="warnbox">
          {w.text}
        </div>
      ))}
      {PARAM_GROUPS.map((g) => {
        const items = PARAM_META.filter((m) => m.group === g && match(m));
        if (!items.length) return null;
        return (
          <details key={g} className="group" open={!!ql || g === "Pacemaker function" || g === "His–Purkinje system"}>
            <summary>
              {g} <span className="note">({items.length})</span>
            </summary>
            {items.map((m) => (
              <ParamRow key={m.path} m={m} onCommit={onCommit} />
            ))}
          </details>
        );
      })}
      <div className="toolbar">
        <label htmlFor="seed">
          Random seed
          <input
            id="seed"
            type="number"
            value={params.seed}
            style={{ width: 80, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 6, padding: "2px 6px" }}
            onChange={(e) => restart({ ...params, seed: Math.max(0, Math.floor(+e.target.value || 0)) })}
          />
        </label>
        <span className="note">Deterministic: identical seed and parameters reproduce identical output.</span>
      </div>
    </>
  );
}
