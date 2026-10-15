/**
 * Ionic single-cell lab (TP06). Paces epicardial, M and endocardial cells under baseline and
 * modified conditions, plots the last beat and reports APD90, resting potential and dV/dt_max.
 * Results can be mapped onto the reduced-order tissue model (APD and CV scaling).
 */
import { useEffect, useRef, useState } from "react";
import { TP06_DEFAULT_MODS, type PacedResult, type TP06Cell, type TP06Mods } from "../../simulation/cellular/tp06";
import { runPacing } from "../../simulation/cellular/ionicClient";
import { applyMapping, mapToTissue } from "../../simulation/cellular/ionicMapping";
import { DEFAULT_PARAMS } from "../../simulation/core/params";
import { useStore } from "../../state/store";
import { applyLive } from "../../state/actions";
import { tokens } from "../../visualization/frameLoop";

const CELLS: TP06Cell[] = ["epi", "mid", "endo"];
const CELL_LABEL: Record<TP06Cell, string> = { epi: "Epicardial", mid: "M cell", endo: "Endocardial" };
const CELL_COLOR: Record<TP06Cell, string> = { epi: "#e8a33d", mid: "#c86bd8", endo: "#6fb3c8" };

type Row = [keyof TP06Mods, string, number, number, number, string];
const ROWS: Row[] = [
  ["gKr", "IKr conductance", 0, 2, 0.05, "×"],
  ["gKs", "IKs conductance", 0, 3, 0.05, "×"],
  ["gNa", "INa conductance", 0.1, 1.5, 0.05, "×"],
  ["gCaL", "ICaL conductance", 0, 2, 0.05, "×"],
  ["gK1", "IK1 conductance", 0.2, 2, 0.05, "×"],
  ["gto", "Ito conductance", 0, 2, 0.05, "×"],
  ["Ko", "Extracellular K⁺", 2.5, 9, 0.1, "mM"],
];
const PRESETS: [string, Partial<TP06Mods>][] = [
  ["IKr −50 %", { gKr: 0.5 }],
  ["IKr −90 %", { gKr: 0.1 }],
  ["IKr ×2 (short QT)", { gKr: 2 }],
  ["K⁺ 8 mM", { Ko: 8 }],
  ["K⁺ 3 mM", { Ko: 3 }],
  ["INa −50 %", { gNa: 0.5 }],
  ["ICaL −50 %", { gCaL: 0.5 }],
];

function Plot({ base, mod }: { base: PacedResult[] | null; mod: PacedResult[] | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tk = tokens();
    g.fillStyle = tk.panel;
    g.fillRect(0, 0, w, h);
    const tMax = 600;
    const X = (t: number) => 34 + ((w - 40) * t) / tMax;
    const Y = (v: number) => 8 + ((h - 26) * (50 - v)) / 145;
    g.strokeStyle = tk.line;
    g.fillStyle = tk["fg-faint"];
    g.font = "10px IBM Plex Mono, monospace";
    for (const v of [40, 0, -40, -80]) {
      g.beginPath();
      g.moveTo(34, Y(v));
      g.lineTo(w - 6, Y(v));
      g.stroke();
      g.fillText(`${v}`, 4, Y(v) + 3);
    }
    for (let t = 0; t <= tMax; t += 100) g.fillText(`${t}`, X(t) - 8, h - 4);
    const draw = (rs: PacedResult[] | null, dash: number[]) => {
      if (!rs) return;
      for (const r of rs) {
        g.strokeStyle = CELL_COLOR[r.cell];
        g.setLineDash(dash);
        g.lineWidth = 1.6;
        g.beginPath();
        for (let i = 0; i < r.v.length && i * r.sampleDt <= tMax; i++) {
          const x = X(i * r.sampleDt);
          const y = Y(r.v[i]);
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      g.setLineDash([]);
    };
    draw(base, [4, 3]);
    draw(mod, []);
  }, [base, mod]);
  return <canvas ref={ref} style={{ width: "100%", height: 200, display: "block", borderRadius: 4 }} aria-label="TP06 action potentials (dashed baseline, solid modified)" />;
}

export function IonicLab() {
  const [mods, setMods] = useState<TP06Mods>({ ...TP06_DEFAULT_MODS });
  const [cl, setCl] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [base, setBase] = useState<PacedResult[] | null>(null);
  const [mod, setMod] = useState<PacedResult[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setMsg(null);
    const beats = 20;
    const b = await Promise.all(CELLS.map((c) => runPacing(c, TP06_DEFAULT_MODS, cl, beats)));
    const m = await Promise.all(CELLS.map((c) => runPacing(c, mods, cl, beats)));
    setBase(b);
    setMod(m);
    setBusy(false);
  };
  const mapping = base && mod ? mapToTissue(base, mod) : null;
  return (
    <div className="ionic-lab" data-testid="ionic-lab">
      <p className="note">
        Ten Tusscher–Panfilov 2006 human ventricular cell model (state equations, Rush–Larsen, dt 0.02 ms). Single cells paced for 20 beats; the last beat is shown.
        Local APD90 of one cell is <b>not</b> the surface QT.
      </p>
      <div className="chips">
        {PRESETS.map(([l, m]) => (
          <button key={l} className="chip" onClick={() => setMods({ ...TP06_DEFAULT_MODS, ...m })}>
            {l}
          </button>
        ))}
        <button className="chip" onClick={() => setMods({ ...TP06_DEFAULT_MODS })}>
          Reset
        </button>
      </div>
      {ROWS.map(([k, label, min, max, step, unit]) => (
        <div className="param" key={k}>
          <div className="row">
            <label className="name" htmlFor={`ion-${k}`}>
              {label}
            </label>
            <span className={`val ${mods[k] !== TP06_DEFAULT_MODS[k] ? "changed" : ""}`}>
              {mods[k].toFixed(2)} {unit}
            </span>
          </div>
          <input id={`ion-${k}`} type="range" min={min} max={max} step={step} value={mods[k]} onChange={(e) => setMods({ ...mods, [k]: +e.target.value })} />
        </div>
      ))}
      <div className="toolbar">
        <label>
          Pacing CL
          <select value={cl} onChange={(e) => setCl(+e.target.value)}>
            {[500, 800, 1000, 1500, 2000].map((x) => (
              <option key={x} value={x}>
                {x} ms
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" onClick={run} disabled={busy} data-testid="ionic-run">
          {busy ? "Pacing…" : "Run cells"}
        </button>
      </div>
      <Plot base={base} mod={mod} />
      <div className="note">dashed = baseline · solid = modified · {CELLS.map((c) => <span key={c} style={{ color: CELL_COLOR[c], marginRight: 8 }}>■ {CELL_LABEL[c]}</span>)}</div>
      {base && mod && (
        <table className="meas">
          <thead>
            <tr>
              <th>Cell</th>
              <th>APD90</th>
              <th>V rest</th>
              <th>dV/dt max</th>
              <th>EAD</th>
            </tr>
          </thead>
          <tbody>
            {CELLS.map((c, i) => (
              <tr key={c}>
                <td style={{ color: CELL_COLOR[c] }}>{CELL_LABEL[c]}</td>
                <td>
                  {base[i].apd90.toFixed(0)} → <b>{mod[i].apd90.toFixed(0)}</b>
                </td>
                <td>
                  {base[i].vRest.toFixed(1)} → <b>{mod[i].vRest.toFixed(1)}</b>
                </td>
                <td>
                  {base[i].dvdtMax.toFixed(0)} → <b>{mod[i].dvdtMax.toFixed(0)}</b>
                </td>
                <td>{mod[i].ead ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {mapping && (
        <div className="card">
          <p>
            <b>Map onto tissue (reduced-order):</b> APD × {mapping.apdScale.toFixed(3)}, ventricular CV × {mapping.cvScale.toFixed(3)} (CV ∝ √dV/dt<sub>max</sub>).
          </p>
          <p className="note">The tissue keeps its reduced-order AP shape: changes in repolarisation slope (e.g. peaked T in hyperkalaemia) and EADs are not transferred.</p>
          <div className="toolbar">
            <button
              className="btn"
              onClick={() => {
                const p = applyMapping(useStore.getState().params, mapping, DEFAULT_PARAMS);
                useStore.getState().set({ scenarioId: "custom" });
                applyLive(p);
                setMsg("Applied live to the tissue model — compare QRS and QT before/after in the ECG.");
              }}
            >
              Apply to tissue (live)
            </button>
          </div>
          {msg && <p className="note">{msg}</p>}
        </div>
      )}
      <p className="note">
        Known model limitation: TP06 predicts a <i>longer</i> APD with higher extracellular Ca²⁺ — opposite to the clinical QT–calcium relationship — so calcium
        disorders are not offered here. TP06 did not produce EADs under the IKr/ICaL/IKs combinations tested (see SCIENTIFIC_LIMITATIONS).
      </p>
    </div>
  );
}
