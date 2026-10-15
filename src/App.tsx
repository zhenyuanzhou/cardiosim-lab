import { useEffect, useState } from "react";
import { sim, useStore, type Tab } from "./state/store";
import { HeartView, legendGradient } from "./visualization/heart/HeartView";
import { APPanel } from "./visualization/action-potentials/APPanel";
import { ECGPanel } from "./visualization/ecg/ECGPanel";
import { ParameterPanel } from "./components/controls/ParameterPanel";
import { ScenarioPanel } from "./components/controls/ScenarioPanel";
import { ExplainPanel } from "./components/education/ExplainPanel";
import { ValidationPanel } from "./components/measurements/ValidationPanel";
import { ComparePanel, CompareView } from "./components/controls/ComparePanel";
import { AboutPanel } from "./components/education/AboutPanel";
import { seek } from "./visualization/frameLoop";
import { jumpBeat, restart } from "./state/actions";
import { clock } from "./state/store";
import { deriveAutonomic } from "./simulation/core/derive";

const TABS: [Tab, string][] = [
  ["scenarios", "Scenarios"],
  ["parameters", "Parameters"],
  ["explain", "Explain"],
  ["validation", "Validation"],
  ["compare", "A/B"],
  ["about", "About"],
];

export default function App() {
  const st = useStore();
  const [buildMs, setBuildMs] = useState(0);

  useEffect(() => {
    const off = sim.on((e) => {
      if (e.type === "ready") {
        setBuildMs(e.buildMs);
        useStore.getState().set({ ready: true });
      } else if (e.type === "error") useStore.getState().set({ error: e.message });
    });
    sim.init(useStore.getState().params, 1000 / useStore.getState().sampleRate);
    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", st.theme);
  }, [st.theme]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const s = useStore.getState();
      if (e.code === "Space") {
        e.preventDefault();
        s.set({ playing: !s.playing });
      } else if (e.key === "ArrowLeft") seek(clock.t - 20);
      else if (e.key === "ArrowRight") seek(clock.t + 20);
      else if (e.key === "[") jumpBeat(-1);
      else if (e.key === "]") jumpBeat(1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const rate = deriveAutonomic(st.params).sinusRateBpm;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>
            Cardio<span>Sim</span> Lab
          </h1>
          <small>EP → ECG</small>
        </div>
        <span className="badge warn" title="Not a clinically validated diagnostic system or patient-specific prediction tool">Education · not for clinical use</span>
        <div className="spacer" />
        <div className="transport" role="toolbar" aria-label="Playback">
          <button className="btn icon" title="Rewind to the start of the retained history" onClick={() => seek(sim.data?.tStart ?? 0)} aria-label="Rewind">⏮</button>
          <button className="btn icon" title="Previous beat ( [ )" onClick={() => jumpBeat(-1)} aria-label="Previous beat">⏪</button>
          <button className="btn icon" title="Step back 20 ms (←)" onClick={() => seek(clock.t - 20)} aria-label="Step back">◂</button>
          <button className="btn primary" style={{ minWidth: 76 }} onClick={() => st.set({ playing: !st.playing })} data-testid="play" aria-label={st.playing ? "Pause" : "Play"}>
            {st.playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button className="btn icon" title="Step forward 20 ms (→)" onClick={() => seek(clock.t + 20)} aria-label="Step forward">▸</button>
          <button className="btn icon" title="Next beat ( ] )" onClick={() => jumpBeat(1)} aria-label="Next beat">⏩</button>
          <button
            className="btn"
            title="Replay the last 3 seconds"
            onClick={() => {
              seek(clock.t - 3000, false);
              st.set({ playing: true });
            }}
          >
            Replay 3 s
          </button>
          <select value={st.speed} onChange={(e) => st.set({ speed: +e.target.value })} aria-label="Display speed (× real time)" title="Display speed relative to real time" id="speed">
            {[0.1, 0.25, 0.5, 1, 2].map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
        </div>
        <div className="clockread" data-testid="clock">
          <small>simulation time</small>
          {(st.shownTime / 1000).toFixed(3)} s
        </div>
        <div className="clockread" style={{ minWidth: 70 }}>
          <small>sinus rate</small>
          {rate.toFixed(0)} bpm
        </div>
        <select
          value={st.sampleRate}
          onChange={(e) => restart(useStore.getState().params, +e.target.value as 500 | 1000)}
          aria-label="ECG sampling rate"
          id="sample-rate"
          title="Changing the sampling rate restarts the simulation"
        >
          <option value={500}>500 Hz</option>
          <option value={1000}>1000 Hz</option>
        </select>
        <button className="btn" onClick={() => restart(useStore.getState().params)} title="Restart from t = 0 with current parameters">
          Restart
        </button>
        <button className="btn icon" onClick={() => st.set({ theme: st.theme === "dark" ? "light" : "dark" })} title="Toggle light/dark" aria-label="Toggle theme">
          {st.theme === "dark" ? "☀" : "☾"}
        </button>
      </header>

      {st.error && <div className="errbox" style={{ margin: 8 }}>{st.error}</div>}

      <main className="grid">
        <section className="panel panel-heart" aria-label="Panel A: cardiac anatomy and activation">
          <header>
            <h2>
              <b>A</b>Activation
            </h2>
            <span className="fid">L1+L2 · idealised anatomy</span>
            <span className="spacer" />
            <div className="seg" role="group" aria-label="Colour mode">
              {(
                [
                  ["vm", "Vm"],
                  ["activation", "Isochrones"],
                  ["state", "Refractory"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} className={st.heartColor === k ? "on" : ""} onClick={() => st.set({ heartColor: k })}>
                  {l}
                </button>
              ))}
            </div>
          </header>
          <div className="toolbar" style={{ padding: "4px 10px", borderBottom: "1px solid var(--line)" }}>
            {(
              [
                ["atria", "Atria"],
                ["ventricles", "Ventricles"],
                ["conduction", "Conduction system"],
                ["cutaway", "Cut-away"],
                ["labels", "Labels"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} htmlFor={`layer-${k}`}>
                <input id={`layer-${k}`} type="checkbox" checked={st.layers[k]} onChange={(e) => st.set({ layers: { ...st.layers, [k]: e.target.checked } })} />
                {l}
              </label>
            ))}
          </div>
          <div className="panel-body">
            {st.ready ? <HeartView /> : <div className="loading">Building heart model…</div>}
            <div className="heart-legend">
              <span>{st.heartColor === "vm" ? "rest" : st.heartColor === "activation" ? "early" : "front"}</span>
              <span className="bar" style={{ background: legendGradient(st.heartColor) }} />
              <span>{st.heartColor === "vm" ? "peak Vm" : st.heartColor === "activation" ? "late (10 ms bands)" : "rest"}</span>
            </div>
          </div>
        </section>

        <section className="panel panel-ap" aria-label="Panel B: cellular action potentials">
          <header>
            <h2>
              <b>B</b>Cellular action potentials
            </h2>
            <span className="fid" title="Lane labels show APD90 / ERP of the latest action potential. AV node ERP (*) is the functional refractoriness of the recovery model, which outlasts its APD (post-repolarisation refractoriness).">reduced-order · APD90 / ERP per cell · same clock as ECG</span>
            <span className="spacer" />
            <details style={{ position: "relative" }}>
              <summary className="btn" style={{ listStyle: "none" }}>
                Cells…
              </summary>
              <div className="card" style={{ position: "absolute", right: 0, zIndex: 5, width: 240 }}>
                {sim.meta?.probes.map((p) => (
                  <label key={p.id} htmlFor={`probe-${p.id}`} style={{ display: "flex", gap: 6 }}>
                    <input
                      id={`probe-${p.id}`}
                      type="checkbox"
                      checked={st.probes.includes(p.id)}
                      onChange={(e) => st.set({ probes: e.target.checked ? [...st.probes, p.id] : st.probes.filter((x) => x !== p.id) })}
                    />
                    {p.label}
                  </label>
                ))}
                {st.customNode !== null && (
                  <button className="linkbtn" onClick={() => st.set({ customNode: null })}>
                    Remove selected cell
                  </button>
                )}
              </div>
            </details>
          </header>
          <div className="panel-body">{st.ready && <APPanel />}</div>
        </section>

        <section className="panel panel-ecg" aria-label="Panel C: ECG monitor">
          <header>
            <h2>
              <b>C</b>12-lead ECG
            </h2>
            <span className="fid">forward-computed from the simulated membrane potentials</span>
          </header>
          <div className="panel-body">{st.ready ? st.showCompare && st.compare ? <CompareView /> : <ECGPanel /> : <div className="loading">Starting simulation…</div>}</div>
        </section>

        <section className="panel panel-ctrl" aria-label="Panel D: parameters and explanations">
          <nav className="tabs" role="tablist">
            {TABS.map(([k, l]) => (
              <button key={k} role="tab" aria-selected={st.tab === k} className={st.tab === k ? "on" : ""} onClick={() => st.set({ tab: k })} data-tab={k}>
                {l}
                {k === "explain" && st.paramChanges.length > 0 ? ` (${st.paramChanges.length})` : ""}
              </button>
            ))}
          </nav>
          <div className="ctrl-body">
            {!st.ready ? (
              <div className="loading">…</div>
            ) : st.tab === "parameters" ? (
              <ParameterPanel />
            ) : st.tab === "scenarios" ? (
              <ScenarioPanel />
            ) : st.tab === "explain" ? (
              <ExplainPanel />
            ) : st.tab === "validation" ? (
              <ValidationPanel />
            ) : st.tab === "compare" ? (
              <ComparePanel />
            ) : (
              <AboutPanel buildMs={buildMs} />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
