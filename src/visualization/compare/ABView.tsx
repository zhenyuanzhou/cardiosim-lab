/**
 * A/B side-by-side: two independent runs (same duration, both from t = 0) animated on one shared
 * clock — activation maps with heart vectors, selected ECG leads (A and B overlaid on identical
 * scaling) and the parameter differences.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { SimData } from "../../simulation/worker/client";
import type { CompareRun } from "../../simulation/worker/protocol";
import { DEFAULT_PARAMS, META_BY_PATH, cloneParams, diffParams } from "../../simulation/core/params";
import { sim, useStore } from "../../state/store";
import { HeartScene } from "../heart/HeartScene";
import { fitCanvas, tokens } from "../frameLoop";
import { leadIndex } from "../explorer/leadMath";
import { Panel } from "../../components/layout/Panel";
import { LeadPicker } from "../explorer/ExplorerView";

const DURATION = 10000;
const T0 = 2000;
const T1 = DURATION - 600;
const COL_A = "#6fb3c8";
const COL_B = "#e8a33d";

function toData(r: CompareRun, n: number, dt: number): SimData {
  const d = new SimData(n, dt);
  d.append({ recT: r.recT, recNode: r.recNode, recApd: r.recApd, recWave: r.recWave, ecg: r.ecg, ecgStartIndex: 0, waves: r.waves }, DURATION);
  return d;
}

function ABHeart({ data, label, color, clockRef }: { data: SimData; label: string; color: string; clockRef: React.MutableRefObject<number> }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const meta = sim.meta;
    if (!meta) return;
    const scene = new HeartScene(host.current!);
    scene.setModel(meta, sim.surfaces);
    scene.layers = { ...useStore.getState().heartLayers, vectors: true, labels: true };
    let raf = 0;
    const loop = () => {
      const st = useStore.getState();
      scene.opacity = st.heartOpacity;
      scene.activationDisplay = st.activationDisplay;
      scene.update(clockRef.current, { meta, data, params: st.params });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      scene.dispose();
    };
  }, [data, clockRef]);
  return (
    <div className="scene-wrap">
      <div ref={host} className="scene-host" />
      <div className="ab-tag" style={{ borderColor: color, color }}>
        {label}
      </div>
    </div>
  );
}

function ABStrips({ a, b, clockRef }: { a: SimData; b: SimData; clockRef: React.MutableRefObject<number> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const leads = useStore((s) => s.explorerLeads);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const cv = ref.current;
      if (cv) {
        const ctx = cv.getContext("2d")!;
        const { w, h, dpr } = fitCanvas(cv);
        const tk = tokens();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = tk.paper;
        ctx.fillRect(0, 0, w, h);
        const t = clockRef.current;
        const win = 3000;
        const start = Math.max(0, Math.min(DURATION - win, t - win * 0.7));
        const x0 = 44;
        const X = (tt: number) => x0 + ((tt - start) / win) * (w - x0 - 8);
        const rowH = h / leads.length;
        const mmPx = (w - x0 - 8) / ((win / 1000) * 25);
        ctx.lineWidth = 1;
        for (let k = 0; k * mmPx < w; k++) {
          ctx.strokeStyle = k % 5 ? tk["grid-minor"] : tk["grid-major"];
          ctx.beginPath();
          ctx.moveTo(x0 + k * mmPx, 0);
          ctx.lineTo(x0 + k * mmPx, h);
          ctx.stroke();
        }
        leads.forEach((lead, li) => {
          const ch = leadIndex(lead);
          const y0 = rowH * (li + 0.6);
          const sc = Math.min(mmPx * 10, rowH * 0.3); // ≤ 10 mm/mV, reduced to fit the row
          ctx.fillStyle = tk.fg;
          ctx.font = "600 14px IBM Plex Mono, monospace";
          ctx.fillText(lead, 6, y0 - rowH * 0.3);
          for (const [d, col] of [
            [a, COL_A],
            [b, COL_B],
          ] as const) {
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            let first = true;
            for (let tt = start; tt <= Math.min(t, start + win); tt += 2) {
              const v = d.at(tt, ch);
              if (Number.isNaN(v)) continue;
              const x = X(tt);
              const y = y0 - v * sc;
              if (first) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
              first = false;
            }
            ctx.stroke();
          }
        });
        ctx.strokeStyle = tk.cursor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(X(t), 0);
        ctx.lineTo(X(t), h);
        ctx.stroke();
        ctx.fillStyle = tk.cursor;
        ctx.font = "12px IBM Plex Mono, monospace";
        ctx.fillText(`${(t / 1000).toFixed(2)} s`, X(t) + 4, h - 6);
        ctx.fillStyle = tk["fg-dim"];
        ctx.fillText(`25 mm/s · ${(Math.min(mmPx * 10, rowH * 0.3) / mmPx).toFixed(1)} mm/mV (A and B identical)`, x0 + 4, h - 6);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [a, b, leads, clockRef]);
  return <canvas ref={ref} className="fill" aria-label="Selected leads, A (blue) and B (amber) on identical scaling" data-testid="ab-strips" />;
}

export function ABView() {
  const st = useStore();
  const c = st.compare;
  const meta = sim.meta;
  const clockRef = useRef(T0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(0.5);
  const pair = useMemo(() => (c && meta ? { a: toData(c.a, meta.n, c.dt), b: toData(c.b, meta.n, c.dt) } : null), [c, meta]);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dtw = Math.min(100, now - last);
      last = now;
      const ov = (window as unknown as { __cardiosim?: { abTime?: number } }).__cardiosim?.abTime;
      if (ov !== undefined) clockRef.current = ov;
      else if (playing) {
        clockRef.current += dtw * speed;
        if (clockRef.current > T1) clockRef.current = T0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);
  const runDefaultVsCurrent = async () => {
    const a = cloneParams(DEFAULT_PARAMS);
    st.set({ compareBusy: true, baselineA: a });
    const r = await sim.compare(a, st.params, DURATION);
    useStore.getState().set({ compare: { ...r, a_params: a, b_params: useStore.getState().params }, compareBusy: false });
  };
  if (!c || !pair) {
    return (
      <main className="explorer">
        <div className="card" style={{ margin: 16, maxWidth: 640 }}>
          <h4>A/B side-by-side</h4>
          <p>Compare two parameter sets. Both are simulated from t = 0 for {DURATION / 1000} s and animated on one clock.</p>
          <p className="note">Use the A/B tab in the Simulator to set a custom baseline, or compare the default model (A) with the current parameters (B):</p>
          <div className="toolbar">
            <button className="btn primary" onClick={runDefaultVsCurrent} disabled={st.compareBusy} data-testid="ab-run">
              {st.compareBusy ? "Simulating…" : "A = default, B = current"}
            </button>
          </div>
        </div>
      </main>
    );
  }
  const diffs = diffParams(c.a_params, c.b_params);
  return (
    <main className="explorer" data-testid="ab-view">
      <div className="explorer-bar">
        <LeadPicker />
        <span className="spacer" />
        <button className="btn" onClick={() => setPlaying(!playing)}>{playing ? "Pause" : "Play"}</button>
        <select value={speed} onChange={(e) => setSpeed(+e.target.value)} aria-label="A/B playback speed">
          {[0.1, 0.25, 0.5, 1].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <button className="btn" onClick={runDefaultVsCurrent} disabled={st.compareBusy}>
          {st.compareBusy ? "Simulating…" : "Re-run (A = default, B = current)"}
        </button>
      </div>
      <div className="ab-grid">
        <Panel id="ab-a" title="A" label="A: baseline activation">
          <ABHeart data={pair.a} label="A" color={COL_A} clockRef={clockRef} />
        </Panel>
        <Panel id="ab-b" title="B" label="B: modified activation">
          <ABHeart data={pair.b} label="B" color={COL_B} clockRef={clockRef} />
        </Panel>
        <Panel id="ab-ecg" title="ECG — A (blue) vs B (amber)" className="ab-wide">
          <ABStrips a={pair.a} b={pair.b} clockRef={clockRef} />
        </Panel>
        <Panel id="ab-diff" title="What differs" className="ab-wide">
          <div className="lead-info">
            {diffs.length === 0 ? (
              <p className="note">A and B have identical parameters.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {diffs.map((d) => (
                  <li key={d.path}>
                    <b>{META_BY_PATH[d.path]?.label ?? d.path}</b>: {String(d.a)} → {String(d.b)} {META_BY_PATH[d.path]?.unit ?? ""}
                  </li>
                ))}
              </ul>
            )}
            <p className="note">Both runs share the same anatomy, lead field, sampling and scaling; only the listed parameters differ.</p>
          </div>
        </Panel>
      </div>
    </main>
  );
}
