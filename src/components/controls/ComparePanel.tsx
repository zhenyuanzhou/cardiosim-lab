/** A/B comparison: two independent runs from t = 0 with identical scaling and time axes. */
import { useEffect, useRef, useState } from "react";
import { META_BY_PATH, diffParams } from "../../simulation/core/params";
import { sim, useStore } from "../../state/store";
import { fitCanvas, tokens } from "../../visualization/frameLoop";
import { LEAD_NAMES } from "../../simulation/ecg-forward/leadField";
import { CT } from "../../simulation/core/model";
import { SHAPES, nodalV, repolMidpoint, ventricularNotchScale, workingA } from "../../simulation/cellular/actionPotential";
import type { BeatMeasurement } from "../../simulation/ecg-forward/measurements";

const DURATION = 10000;

const med = (bs: BeatMeasurement[], f: (b: BeatMeasurement) => number | null) => {
  const v = bs
    .slice(2)
    .map(f)
    .filter((x): x is number => x !== null && Number.isFinite(x))
    .sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

export function ComparePanel() {
  const st = useStore();
  const run = async () => {
    if (!st.baselineA) return;
    st.set({ compareBusy: true });
    const r = await sim.compare(st.baselineA, st.params, DURATION);
    useStore.getState().set({ compare: { ...r, a_params: st.baselineA, b_params: st.params }, compareBusy: false, showCompare: true });
  };
  const diffs = st.baselineA ? diffParams(st.baselineA, st.params) : [];
  const c = st.compare;
  const rows: [string, (b: BeatMeasurement) => number | null, string][] = [
    ["RR", (b) => b.rr, "ms"],
    ["PR", (b) => b.pr, "ms"],
    ["QRS", (b) => b.qrs, "ms"],
    ["QT", (b) => b.qt, "ms"],
    ["QTc (Bazett)", (b) => b.qtcBazett, "ms"],
    ["QRS axis", (b) => b.axisQRS, "°"],
    ["T axis", (b) => b.axisT, "°"],
  ];
  return (
    <>
      <p className="note">Set a baseline (A), change parameters, then compare. Both runs start from t = 0 for {DURATION / 1000} s; ECG overlays use identical lead scaling and the same time axis.</p>
      <div className="toolbar">
        <button className="btn" onClick={() => st.set({ baselineA: structuredClone(st.params), compare: null })}>Set current as A</button>
        <button className="btn primary" disabled={!st.baselineA || st.compareBusy} onClick={run}>
          {st.compareBusy ? "Running…" : "Run A vs B (current)"}
        </button>
        {c && (
          <button className={`btn ${st.showCompare ? "on" : ""}`} onClick={() => st.set({ showCompare: !st.showCompare })}>
            {st.showCompare ? "Hide overlay" : "Show overlay"}
          </button>
        )}
      </div>
      {!st.baselineA && <p className="note">No baseline yet.</p>}
      {st.baselineA && (
        <div className="card">
          <h4>Parameter differences (A → B)</h4>
          {diffs.length === 0 ? (
            <p className="note">B is identical to A.</p>
          ) : (
            <table className="meas">
              <tbody>
                {diffs.map((d) => (
                  <tr key={d.path}>
                    <td style={{ whiteSpace: "normal" }}>{META_BY_PATH[d.path]?.label ?? d.path}</td>
                    <td className="mono">{String(d.a)}</td>
                    <td className="mono">→ {String(d.b)}</td>
                    <td className="dim">{META_BY_PATH[d.path]?.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {c && (
        <div className="card" data-testid="compare-table">
          <h4>Measured (median of steady beats)</h4>
          <table className="meas">
            <thead>
              <tr>
                <th></th>
                <th>A</th>
                <th>B</th>
                <th>Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, f, unit]) => {
                const a = med(c.a.beats, f);
                const b = med(c.b.beats, f);
                const isAngle = unit === "°";
                const dlt = a !== null && b !== null ? (isAngle ? ((((b - a + 180) % 360) + 360) % 360) - 180 : b - a) : null;
                return (
                  <tr key={label}>
                    <td>
                      {label} <span className="note">{unit}</span>
                    </td>
                    <td className="mono">{a?.toFixed(0) ?? "—"}</td>
                    <td className="mono">{b?.toFixed(0) ?? "—"}</td>
                    <td className="mono">{dlt !== null ? `${dlt >= 0 ? "+" : ""}${dlt.toFixed(0)}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Overlay view rendered in Panel C when A/B overlay is active. */
export function CompareView() {
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useStore();
  const [start, setStart] = useState(6000);
  const [lead, setLead] = useState("II");
  const c = st.compare;
  useEffect(() => {
    const cv = ref.current;
    const meta = sim.meta;
    if (!cv || !c || !meta) return;
    const draw = () => {
      const ctx = cv.getContext("2d")!;
      const { w, h, dpr } = fitCanvas(cv);
      const tk = tokens();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const win = 3000;
      const x0 = 50;
      const pw = w - x0 - 10;
      const X = (t: number) => x0 + ((t - start) / win) * pw;
      const ecgH = h * 0.55;
      ctx.fillStyle = tk.paper;
      ctx.fillRect(x0, 0, pw, ecgH);
      // grid: 40 ms / 0.1 mV minor
      const mmPx = pw / ((win / 1000) * 25);
      ctx.lineWidth = 0.5;
      for (let k = 0; k * mmPx <= pw; k++) {
        ctx.strokeStyle = k % 5 ? tk["grid-minor"] : tk["grid-major"];
        ctx.beginPath();
        ctx.moveTo(x0 + k * mmPx, 0);
        ctx.lineTo(x0 + k * mmPx, ecgH);
        ctx.stroke();
      }
      for (let k = 0; k * mmPx <= ecgH; k++) {
        ctx.strokeStyle = k % 5 ? tk["grid-minor"] : tk["grid-major"];
        ctx.beginPath();
        ctx.moveTo(x0, k * mmPx);
        ctx.lineTo(x0 + pw, k * mmPx);
        ctx.stroke();
      }
      const li = LEAD_NAMES.indexOf(lead as never);
      const base = ecgH * 0.6;
      const vS = st.gain * mmPx;
      const trace = (ecg: Float32Array, color: string, width: number) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        let first = true;
        for (let t = start; t <= start + win; t += c.dt) {
          const i = Math.round(t / c.dt);
          if (i * 15 + li >= ecg.length) break;
          const y = base - ecg[i * 15 + li] * vS;
          if (first) ctx.moveTo(X(t), y);
          else ctx.lineTo(X(t), y);
          first = false;
        }
        ctx.stroke();
      };
      trace(c.a.ecg, tk["trace-b"], 1.6);
      trace(c.b.ecg, tk.trace, 1.2);
      ctx.fillStyle = tk.fg;
      ctx.font = "600 12px IBM Plex Sans, system-ui, sans-serif";
      ctx.fillText(lead, 6, 16);
      ctx.fillStyle = tk["trace-b"];
      ctx.fillText("A", 6, 34);
      ctx.fillStyle = tk.trace;
      ctx.fillText("B", 22, 34);
      // AP overlay for the selected cell (or LV epicardium)
      const node = st.customNode ?? meta.probes.find((p) => p.id === "lvepi")!.node;
      const ct = meta.cellType[node];
      const apTop = ecgH + 18;
      const apH = h - apTop - 18;
      const Y = (v: number) => apTop + ((45 - v) / 140) * apH;
      ctx.fillStyle = tk["fg-dim"];
      ctx.font = "11px IBM Plex Sans, system-ui, sans-serif";
      ctx.fillText(`Action potential overlay · ${st.customNode !== null ? "selected cell" : "LV lateral epicardium"}`, x0, apTop - 4);
      const apTrace = (run: typeof c.a, color: string) => {
        const acts: number[] = [];
        for (let k = 0; k < run.recNode.length; k++) if (run.recNode[k] === node) acts.push(k);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        let first = true;
        for (let t = start; t <= start + win; t += 2) {
          let r = -1;
          for (const k of acts) if (run.recT[k] <= t) r = k;
          let v: number;
          if (ct === CT.SAN || ct === CT.AVN) v = r < 0 ? -62 : nodalV(ct === CT.SAN ? "san" : "avn", t - run.recT[r], run.recApd[r], 900);
          else {
            const s = SHAPES[ct];
            const notch = ct === CT.VENTRICULAR ? ventricularNotchScale(meta.transmural[node]) : 1;
            v = r < 0 ? s.vRest : s.vRest + workingA(s, t - run.recT[r], run.recApd[r], repolMidpoint(s, run.recApd[r]), notch) * (s.vPeak - s.vRest);
          }
          if (first) ctx.moveTo(X(t), Y(v));
          else ctx.lineTo(X(t), Y(v));
          first = false;
        }
        ctx.stroke();
      };
      apTrace(c.a, tk["trace-b"]);
      apTrace(c.b, tk.trace);
      ctx.fillStyle = tk["fg-faint"];
      ctx.font = "10px IBM Plex Mono, monospace";
      for (let g = Math.ceil(start / 500) * 500; g <= start + win; g += 500) ctx.fillText(`${(g / 1000).toFixed(1)} s`, X(g) - 10, h - 4);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [c, start, lead, st.gain, st.customNode, st.theme]);
  if (!c) return null;
  return (
    <div className="ecg-stack">
      <div className="toolbar" style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)" }}>
        <b>A/B overlay</b>
        <select value={lead} onChange={(e) => setLead(e.target.value)} aria-label="Lead" id="compare-lead">
          {LEAD_NAMES.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <label htmlFor="compare-start">
          window start
          <input id="compare-start" type="range" min={0} max={DURATION - 3000} step={100} value={start} onChange={(e) => setStart(+e.target.value)} />
          <span className="mono">{(start / 1000).toFixed(1)} s</span>
        </label>
        <span className="spacer" />
        <button className="btn" onClick={() => st.set({ showCompare: false })}>Back to live monitor</button>
      </div>
      <div className="ecg-canvas" style={{ flex: 1 }}>
        <canvas ref={ref} className="fill" aria-label="A/B ECG and action potential overlay" />
      </div>
    </div>
  );
}
