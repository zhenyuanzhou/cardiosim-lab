import { useEffect, useState } from "react";
import { APP_VERSION, RELEASE_DATE } from "./version";
import { clock, sim, useStore, type Mode, type Tab } from "./state/store";
import { HeartPanelBody } from "./visualization/heart/HeartPanel";
import { APPanel } from "./visualization/action-potentials/APPanel";
import { ECGPanel } from "./visualization/ecg/ECGPanel";
import { ParameterPanel } from "./components/controls/ParameterPanel";
import { ScenarioPanel } from "./components/controls/ScenarioPanel";
import { ExplainPanel } from "./components/education/ExplainPanel";
import { ValidationPanel } from "./components/measurements/ValidationPanel";
import { ComparePanel, CompareView } from "./components/controls/ComparePanel";
import { AboutPanel } from "./components/education/AboutPanel";
import { LessonsPanel } from "./components/education/LessonsPanel";
import { IonicLab } from "./components/education/IonicLab";
import { ExplorerView } from "./visualization/explorer/ExplorerView";
import { SplitView } from "./visualization/explorer/SplitView";
import { ABView } from "./visualization/compare/ABView";
import { Panel } from "./components/layout/Panel";
import { Split } from "./components/layout/Split";
import { seek } from "./visualization/frameLoop";
import { jumpBeat, restart } from "./state/actions";
import { deriveAutonomic } from "./simulation/core/derive";

const TABS: [Tab, string][] = [
  ["scenarios", "Scenarios"],
  ["parameters", "Parameters"],
  ["explain", "Explain"],
  ["lessons", "Lessons"],
  ["ionic", "Ionic cell"],
  ["validation", "Validation"],
  ["compare", "A/B"],
  ["about", "About"],
];

const MODES: [Mode, string, string][] = [
  ["simulator", "Simulator", "Cardiac anatomy & activation with APs, 12-lead ECG and controls"],
  ["explorer", "Leads & Vectors", "Torso, electrodes, lead geometry, heart vector and projections"],
  ["split", "Split view", "Synchronised educational view: heart, torso, lead, APs, vector, explanation"],
  ["ab", "A/B", "Side-by-side comparison of two parameter sets on one clock"],
];

function useNarrow(px = 1100) {
  const [narrow, setNarrow] = useState(() => window.matchMedia(`(max-width: ${px}px)`).matches);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px}px)`);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [px]);
  return narrow;
}

export function ControlRack({ buildMs }: { buildMs: number }) {
  const st = useStore();
  return (
    <>
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
        ) : st.tab === "lessons" ? (
          <LessonsPanel />
        ) : st.tab === "ionic" ? (
          <IonicLab />
        ) : st.tab === "validation" ? (
          <ValidationPanel />
        ) : st.tab === "compare" ? (
          <ComparePanel />
        ) : (
          <AboutPanel buildMs={buildMs} />
        )}
      </div>
    </>
  );
}

function CellsMenu() {
  const st = useStore();
  return (
    <details style={{ position: "relative" }}>
      <summary className="btn" style={{ listStyle: "none" }}>
        Cells…
      </summary>
      <div className="card" style={{ position: "absolute", right: 0, zIndex: 5, width: 250 }}>
        {sim.meta?.probes.map((p) => (
          <label key={p.id} htmlFor={`probe-${p.id}`} style={{ display: "flex", gap: 6 }}>
            <input id={`probe-${p.id}`} type="checkbox" checked={st.probes.includes(p.id)} onChange={(e) => st.set({ probes: e.target.checked ? [...st.probes, p.id] : st.probes.filter((x) => x !== p.id) })} />
            {p.label}
          </label>
        ))}
        {st.customNode !== null && (
          <button className="linkbtn" onClick={() => st.set({ customNode: null })}>
            Remove selected cell ({st.customLabel})
          </button>
        )}
      </div>
    </details>
  );
}

function SimulatorLayout({ buildMs }: { buildMs: number }) {
  const st = useStore();
  const narrow = useNarrow();
  const heart = (
    <Panel id="heart" letter="A" title="Anatomy & activation" fid="L1+L2 · idealised anatomy" className="panel-heart" label="Panel A: cardiac anatomy and activation">
      {st.ready ? <HeartPanelBody /> : <div className="loading">Building heart model…</div>}
    </Panel>
  );
  const ap = (
    <Panel
      id="ap"
      letter="B"
      title="Cellular action potentials"
      fid="reduced-order · APD90 / ERP per cell · same clock as ECG"
      className="panel-ap"
      label="Panel B: cellular action potentials"
      tools={<CellsMenu />}
    >
      {st.ready && <APPanel />}
    </Panel>
  );
  const ecg = (
    <Panel id="ecg" letter="C" title="12-lead ECG" fid="forward-computed from the simulated membrane potentials" className="panel-ecg" label="Panel C: ECG monitor">
      {st.ready ? st.showCompare && st.compare ? <CompareView /> : <ECGPanel /> : <div className="loading">Starting simulation…</div>}
    </Panel>
  );
  const ctrl = (
    <section className="panel panel-ctrl" aria-label="Panel D: parameters and explanations" data-panel="ctrl">
      <ControlRack buildMs={buildMs} />
    </section>
  );
  if (st.maximized) {
    const one = { heart, ap, ecg }[st.maximized as "heart" | "ap" | "ecg"];
    if (one) return <main className="grid-max">{one}</main>;
  }
  if (narrow)
    return (
      <main className="stack">
        {ecg}
        {heart}
        {ap}
        {ctrl}
      </main>
    );
  return (
    <main className="layout">
      <Split id="sim-cols" direction="row" initial={[0.29, 0.46, 0.25]} minPx={260}>
        <Split id="sim-left" direction="column" initial={[0.56, 0.44]} minPx={180}>
          {heart}
          {ap}
        </Split>
        {ecg}
        {ctrl}
      </Split>
    </main>
  );
}

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
      else if (e.key === "Escape" && s.maximized) s.set({ maximized: null });
    };
    window.addEventListener("keydown", key);
    const fs = () => {
      if (!document.fullscreenElement && useStore.getState().present) useStore.getState().set({ present: false });
    };
    document.addEventListener("fullscreenchange", fs);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("fullscreenchange", fs);
    };
  }, []);

  const togglePresent = async () => {
    const on = !st.present;
    st.set({ present: on });
    try {
      if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      if (!on && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* fullscreen not permitted: presentation styling still applies */
    }
  };

  const rate = deriveAutonomic(st.params).sinusRateBpm;

  return (
    <div className={`app ${st.present ? "present" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <h1>
            Cardio<span>Sim</span> Lab
          </h1>
          {/* The build is shown here, not only in About: a standalone copy is easy to open from an
              old file, and nothing else on screen says which build it is. */}
          <span className="version mono" title={`Build ${APP_VERSION}, released ${RELEASE_DATE}`}>v{APP_VERSION}</span>
        </div>
        <div className="seg modes" role="tablist" aria-label="View mode">
          {MODES.map(([m, l, title]) => (
            <button key={m} role="tab" aria-selected={st.mode === m} className={st.mode === m ? "on" : ""} onClick={() => st.set({ mode: m, maximized: null })} title={title} data-mode={m}>
              {l}
            </button>
          ))}
        </div>
        <span className="badge warn" title="Not a clinically validated diagnostic system or patient-specific prediction tool">
          Education · not for clinical use
        </span>
        <div className="spacer" />
        <div className="transport" role="toolbar" aria-label="Playback">
          <button className="btn icon" title="Rewind to the start of the retained history" onClick={() => seek(sim.data?.tStart ?? 0)} aria-label="Rewind">
            ⏮
          </button>
          <button className="btn icon" title="Previous beat ( [ )" onClick={() => jumpBeat(-1)} aria-label="Previous beat">
            ⏪
          </button>
          <button className="btn icon" title="Step back 20 ms (←)" onClick={() => seek(clock.t - 20)} aria-label="Step back">
            ◂
          </button>
          <button className="btn primary" style={{ minWidth: 76 }} onClick={() => st.set({ playing: !st.playing })} data-testid="play" aria-label={st.playing ? "Pause" : "Play"}>
            {st.playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button className="btn icon" title="Step forward 20 ms (→)" onClick={() => seek(clock.t + 20)} aria-label="Step forward">
            ▸
          </button>
          <button className="btn icon" title="Next beat ( ] )" onClick={() => jumpBeat(1)} aria-label="Next beat">
            ⏩
          </button>
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
        <select value={st.sampleRate} onChange={(e) => restart(useStore.getState().params, +e.target.value as 500 | 1000)} aria-label="ECG sampling rate" id="sample-rate" title="Changing the sampling rate restarts the simulation">
          <option value={500}>500 Hz</option>
          <option value={1000}>1000 Hz</option>
        </select>
        <button className="btn" onClick={() => restart(useStore.getState().params)} title="Restart from t = 0 with current parameters">
          Restart
        </button>
        <button className={`btn ${st.present ? "on" : ""}`} onClick={togglePresent} title="Full-screen presentation mode (larger type)" data-testid="present">
          Present
        </button>
        <button className="btn icon" onClick={() => st.set({ theme: st.theme === "dark" ? "light" : "dark" })} title="Toggle light/dark" aria-label="Toggle theme">
          {st.theme === "dark" ? "☀" : "☾"}
        </button>
      </header>

      {st.error && (
        <div className="errbox" style={{ margin: 8 }}>
          {st.error}
        </div>
      )}

      {st.mode === "simulator" ? <SimulatorLayout buildMs={buildMs} /> : st.mode === "explorer" ? <ExplorerView /> : st.mode === "ab" ? <ABView /> : <SplitView />}
    </div>
  );
}
