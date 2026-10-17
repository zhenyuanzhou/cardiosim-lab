/**
 * Ionic single-cell lab (TP06). Paces epicardial, M and endocardial cells under baseline and
 * modified conditions, plots the last beat and reports APD90, resting potential and dV/dt_max.
 * Results can be mapped onto the reduced-order tissue model (APD and CV scaling).
 */
import { useEffect, useRef, useState } from "react";
import { TP06_DEFAULT_MODS, type PacedResult, type TP06Cell, type TP06Mods } from "../../simulation/cellular/tp06";
import { DRUGS, DRUG_BY_ID, drugMods } from "../../simulation/cellular/drugs";
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
  ["gCaL", "ICaL conductance", 0, 3, 0.05, "×"],
  ["gK1", "IK1 conductance", 0.2, 2, 0.05, "×"],
  ["gto", "Ito conductance", 0, 2, 0.05, "×"],
  ["Ko", "Extracellular K⁺", 2.5, 9, 0.1, "mM"],
  ["Cao", "Extracellular Ca²⁺", 0.5, 4, 0.1, "mM"],
];
/** Triggered-activity machinery — kept in a separate group because these are model modifications. */
const TRIGGER_ROWS: Row[] = [
  ["tauF", "ICaL f-gate τ (window current)", 0.3, 1.5, 0.05, "×"],
  ["vUp", "SERCA uptake (Vmax_up)", 0.5, 5, 0.1, "×"],
  ["kNaCa", "Na⁺/Ca²⁺ exchanger", 0.5, 3, 0.1, "×"],
  ["vRyRLeak", "RyR SR leak", 0, 0.0005, 0.00002, "ms⁻¹"],
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
/** Published recipes for triggered activity (see tp06.ts for the citations). */
const TRIGGER_PRESETS: [string, string, Partial<TP06Mods>, number][] = [
  ["EAD (ICaL ↑, IKs ↓)", "Vandersickel 2014: τ_f halved, ICaL ×2.5, IKs ×0.2 — pace at 1000 ms", { tauF: 0.5, gCaL: 2.5, gKs: 0.2 }, 1000],
  ["EAD, severe", "As above with ICaL ×3 — repeated EADs / oscillatory plateau", { tauF: 0.5, gCaL: 3, gKs: 0.2 }, 1000],
  ["DAD + triggered beat", "Calcium overload with an RyR leak (Chakraborty et al.): ICaL ×2, SERCA ×4.5, NCX ×2.5, leak 1.8e-4 — pace at 600 ms", { gCaL: 2, vUp: 4.5, kNaCa: 2.5, vRyRLeak: 0.00018 }, 600],
  ["DAD, subthreshold", "Milder load: ICaL ×2, SERCA ×3, leak 1.8e-4 — humps that do not reach threshold", { gCaL: 2, vUp: 3, vRyRLeak: 0.00018 }, 600],
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

function DrugPicker({ onPick }: { onPick: (mods: Partial<TP06Mods>, label: string) => void }) {
  const [id, setId] = useState(DRUGS[0].id);
  const [x, setX] = useState(1);
  const d = DRUG_BY_ID[id];
  const mods = drugMods(d, x);
  const pct = (g: number) => `${Math.round((1 - g) * 100)} %`;
  return (
    <div className="card">
      <h4>Drug block (measured IC50 values)</h4>
      <div className="toolbar">
        <label>
          Drug
          <select value={id} onChange={(e) => setId(e.target.value)} data-testid="drug-select">
            {DRUGS.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Exposure
          <select value={x} onChange={(e) => setX(+e.target.value)} data-testid="drug-conc">
            {[0.5, 1, 2, 4, 10].map((z) => (
              <option key={z} value={z}>
                {z}× free Cmax
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" onClick={() => onPick(mods, `${d.name} ${x}× Cmax`)} data-testid="drug-apply">
          Load into the cell
        </button>
      </div>
      <p className="note">
        {d.name} at {x}× its free therapeutic concentration ({(d.freeCmax * x).toFixed(1)} nM): IKr blocked {pct(mods.gKr)}, ICaL {pct(mods.gCaL)}, INa {pct(mods.gNa)}.
        Torsade risk category: <b>{d.tdpRisk}</b>. {d.note}
      </p>
      <p className="note">
        IC50 values from Crumb et al. 2016 (CiPA ion-channel panel), simple pore block with a Hill coefficient of 1. Use-dependence, channel-state binding and
        kinetics are not modelled, and TP06 has no late sodium current, so late-INa blockers (ranolazine, mexiletine) are deliberately not listed.
      </p>
    </div>
  );
}

export function IonicLab() {
  const [mods, setMods] = useState<TP06Mods>({ ...TP06_DEFAULT_MODS });
  const [cl, setCl] = useState(1000);
  const [loaded, setLoaded] = useState<string | null>(null);
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
          <button key={l} className="chip" onClick={() => { setMods({ ...TP06_DEFAULT_MODS, ...m }); setLoaded(l); }}>
            {l}
          </button>
        ))}
        <button className="chip" onClick={() => { setMods({ ...TP06_DEFAULT_MODS }); setLoaded(null); }}>
          Reset
        </button>
      </div>
      <p className="h3" style={{ marginTop: 10 }}>Triggered activity</p>
      <div className="chips">
        {TRIGGER_PRESETS.map(([l, title, m, presetCl]) => (
          <button key={l} className="chip" title={title} data-testid={`trig-${l.startsWith("EAD") ? "ead" : "dad"}`}
            onClick={() => { setMods({ ...TP06_DEFAULT_MODS, ...m }); setCl(presetCl); setLoaded(l); }}>
            {l}
          </button>
        ))}
      </div>
      {loaded && <p className="note">Loaded: <b>{loaded}</b> — press “Run cells”.</p>}
      {[...ROWS, ...TRIGGER_ROWS].map(([k, label, min, max, step, unit]) => (
        <div className="param" key={k}>
          <div className="row">
            <label className="name" htmlFor={`ion-${k}`}>
              {label}
            </label>
            <span className={`val ${mods[k] !== TP06_DEFAULT_MODS[k] ? "changed" : ""}`}>
              {k === "vRyRLeak" ? mods[k].toExponential(1) : mods[k].toFixed(2)} {unit}
            </span>
          </div>
          <input id={`ion-${k}`} type="range" min={min} max={max} step={step} value={mods[k]} onChange={(e) => setMods({ ...mods, [k]: +e.target.value })} />
        </div>
      ))}
      <DrugPicker onPick={(m, label) => { setMods({ ...TP06_DEFAULT_MODS, ...m }); setLoaded(label); }} />
      <div className="toolbar">
        <label>
          Pacing CL
          <select value={cl} onChange={(e) => setCl(+e.target.value)}>
            {[500, 600, 800, 1000, 1500, 2000].map((x) => (
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
              <th>EADs</th>
              <th>DAD</th>
            </tr>
          </thead>
          <tbody>
            {CELLS.map((c, i) => (
              <tr key={c}>
                <td style={{ color: CELL_COLOR[c] }}>{CELL_LABEL[c]}</td>
                <td>
                  {base[i].apd90.toFixed(0)} → <b>{Number.isNaN(mod[i].apd90) ? "—" : mod[i].apd90.toFixed(0)}</b>
                </td>
                <td>
                  {base[i].vRest.toFixed(1)} → <b>{mod[i].vRest.toFixed(1)}</b>
                </td>
                <td>
                  {base[i].dvdtMax.toFixed(0)} → <b>{mod[i].dvdtMax.toFixed(0)}</b>
                </td>
                <td>{mod[i].eadCount > 0 ? `${mod[i].eadCount}` : "—"}</td>
                <td>
                  {mod[i].triggeredBeat ? <b style={{ color: "var(--warn, #e8a33d)" }}>triggered beat</b> : mod[i].dadAmplitude >= 5 ? `${mod[i].dadAmplitude.toFixed(0)} mV` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {mod?.some((r) => Number.isNaN(r.apd90)) && (
        <p className="note">APD90 is shown as “—” where the driven upstroke did not overshoot: the stimulus fell inside a triggered beat, so the cycle has no single driven action potential.</p>
      )}
      {mapping && (
        <div className="card">
          <p>
            <b>Map onto tissue (reduced-order):</b> APD × {mapping.apdScale.toFixed(3)}, ventricular CV × {mapping.cvScale.toFixed(3)} (CV ∝ √dV/dt<sub>max</sub>).
          </p>
          <p className="note">"Apply to tissue" transfers APD and conduction only. Potassium is handled separately (Parameters → Electrolytes): its AP shape is calibrated so the peaked T of hyperkalaemia and the U wave of hypokalaemia appear, because TP06 itself changes the T wave very little. EADs are not transferred.</p>
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
      <div className="card">
        <p className="h3">What this cell model can and cannot show</p>
        <p className="note">
          <b>Calcium.</b> Raise the extracellular Ca²⁺ slider and APD gets <i>longer</i> — the opposite of the clinical QT–calcium relationship. This is a known
          defect of TP06, ORd and Grandi (Bartolucci, Passini &amp; Severi 2020) and it is why the hyper- and hypocalcaemia scenarios do not use this model: they
          use the measured human QT–calcium slope instead. The slider is kept here so the disagreement can be seen rather than hidden.
        </p>
        <p className="note">
          <b>EADs.</b> Blocking IKr alone does not produce EADs in TP06, even at complete block (APD90 epi 231 → 286 ms, no EAD). The published way to make the
          model EAD-capable is to shorten the ICaL f-gate time constant, which enlarges the window current (τ_f slider, Vandersickel et al. 2014). That is a
          deliberate modification of the model, not an emergent property of IKr block.
        </p>
        <p className="note">
          <b>DADs.</b> Calcium loading alone does not produce DADs here either; a background RyR leak has to be added. Both the leak and the loading factors are
          sliders above, so the threshold between a subthreshold hump and a full triggered beat can be explored.
        </p>
      </div>
    </div>
  );
}
