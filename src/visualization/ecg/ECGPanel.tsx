/** Panel C — 12-lead ECG monitor with measurements and the causal event log. */
import { useEffect, useMemo, useRef, useState } from "react";
import { clock, sim, useStore } from "../../state/store";
import { fitCanvas, registerRenderer, seek, tokens } from "../frameLoop";
import { CanvasPainter, SvgPainter, drawEcg, ecgCsv, layoutEcg, type EcgColors, type EcgViewOpts } from "./ecgRender";
import { LEAD_NAMES } from "../../simulation/ecg-forward/leadField";
import { describeInstant } from "../../components/education/featureMap";
import { MeasurementsTable } from "../../components/measurements/MeasurementsTable";
import { EventLog } from "../timeline/EventLog";

export function download(name: string, content: string | Blob, type = "text/plain") {
  const blob = typeof content === "string" ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const colorsFromTokens = (): EcgColors => {
  const tk = tokens();
  return { paper: tk.paper, minor: tk["grid-minor"], major: tk["grid-major"], trace: tk.trace, traceB: tk["trace-b"], label: tk["fg-dim"], cursor: tk.cursor, fiducial: tk.info };
};

export function ECGPanel() {
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef("");
  const layoutRef = useRef<ReturnType<typeof layoutEcg> | null>(null);
  const st = useStore();
  const [zoom, setZoom] = useState(1);
  const [flash, setFlash] = useState<string | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const opts = (w: number, h: number): EcgViewOpts => {
    const s = useStore.getState();
    return { mode: s.ecgLayout, paperSpeed: s.paperSpeed, gain: s.gain, leads: s.selectedLeads, zoom: zoomRef.current, width: w, height: h };
  };

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const render = (t: number) => {
      const data = sim.data;
      if (!data) return;
      const s = useStore.getState();
      const { w, h, dpr, resized } = fitCanvas(c);
      const key = `${t.toFixed(1)}|${data.version}|${s.ecgLayout}|${s.paperSpeed}|${s.gain}|${s.selectedLeads.join()}|${zoomRef.current}|${s.inspectT}|${s.calipers.join()}|${s.theme}|${resized}|${w}x${h}|${s.compare ? 1 : 0}`;
      if (key === last.current) return;
      last.current = key;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const o = opts(w, h);
      const L = layoutEcg(o, t);
      layoutRef.current = L;
      const beats = data.measure();
      drawEcg(new CanvasPainter(ctx), L, o, data, t, colorsFromTokens(), { beats, inspectT: s.inspectT, calipers: s.calipers });
    };
    return registerRenderer(render);
  }, []);

  const onClick = (e: React.MouseEvent) => {
    const L = layoutRef.current;
    const data = sim.data;
    if (!L || !data) return;
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const strip = L.strips.find((s) => x >= s.x && x <= s.x + s.w && y >= s.top && y <= s.top + s.h);
    if (!strip) return;
    const t = strip.t0 + ((x - strip.x) / strip.w) * (strip.t1 - strip.t0);
    if (t > clock.t || t < data.tStart) return;
    if (st.ecgTool === "calipers" && st.ecgLayout === "leads") {
      const cs = st.calipers.length >= 2 ? [t] : [...st.calipers, t];
      st.set({ calipers: cs });
    } else {
      st.set({ inspectT: t });
      seek(t);
    }
  };

  const exportSvg = () => {
    const c = ref.current!;
    const data = sim.data!;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const o = opts(w, h);
    const L = layoutEcg(o, clock.t);
    const p = new SvgPainter();
    const col = colorsFromTokens();
    drawEcg(p, L, o, data, clock.t, col, { beats: data.measure() });
    download(`cardiosim-ecg-${Math.round(clock.t)}ms.svg`, p.toString(w, h, tokens().panel), "image/svg+xml");
  };
  const exportPng = () => {
    ref.current!.toBlob((b) => b && download(`cardiosim-ecg-${Math.round(clock.t)}ms.png`, b, "image/png"));
  };
  const csvWindow = () => {
    const L = layoutRef.current!;
    return ecgCsv(sim.data!, L.pageStart, Math.min(clock.t, L.pageStart + L.pageDur));
  };
  const exportCsv = () => download(`cardiosim-ecg-${Math.round(clock.t)}ms.csv`, csvWindow(), "text/csv");
  const copyCsv = async () => {
    try {
      await navigator.clipboard.writeText(csvWindow());
      setFlash("CSV copied");
    } catch {
      setFlash("Clipboard unavailable");
    }
    setTimeout(() => setFlash(null), 1800);
  };

  const inspect = useMemo(() => {
    if (st.inspectT === null || !sim.meta || !sim.data) return null;
    return describeInstant(sim.meta, sim.data, sim.data.measure(), st.inspectT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.inspectT, sim.data?.version]);

  const caliper = st.calipers.length === 2 && sim.data ? Math.abs(st.calipers[1] - st.calipers[0]) : null;

  return (
    <div className="ecg-stack">
      <div className="toolbar" style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)" }}>
        <div className="seg" role="group" aria-label="ECG layout">
          <button className={st.ecgLayout === "12lead" ? "on" : ""} onClick={() => st.set({ ecgLayout: "12lead" })}>12-lead</button>
          <button className={st.ecgLayout === "leads" ? "on" : ""} onClick={() => st.set({ ecgLayout: "leads" })}>Selected leads</button>
        </div>
        <div className="seg" role="group" aria-label="Paper speed">
          {[25, 50].map((v) => (
            <button key={v} className={st.paperSpeed === v ? "on" : ""} onClick={() => st.set({ paperSpeed: v as 25 | 50 })}>{v} mm/s</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Gain">
          {[5, 10, 20].map((v) => (
            <button key={v} className={st.gain === v ? "on" : ""} onClick={() => st.set({ gain: v as 5 | 10 | 20 })}>{v} mm/mV</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Pointer tool">
          <button className={st.ecgTool === "inspect" ? "on" : ""} onClick={() => st.set({ ecgTool: "inspect", calipers: [] })} title="Click the ECG to see what the heart is doing at that instant">Inspect</button>
          <button className={st.ecgTool === "calipers" ? "on" : ""} onClick={() => st.set({ ecgTool: "calipers", ecgLayout: "leads", calipers: [] })} title="Two clicks measure an interval">Calipers</button>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={exportSvg}>SVG</button>
        <button className="btn" onClick={exportPng}>PNG</button>
        <button className="btn" onClick={exportCsv}>CSV</button>
        <button className="btn" onClick={copyCsv} title="Copy the visible page as CSV">Copy CSV</button>
        {flash && <span className="note">{flash}</span>}
      </div>
      {st.ecgLayout === "leads" && (
        <div className="toolbar" style={{ padding: "4px 10px", borderBottom: "1px solid var(--line)" }}>
          {LEAD_NAMES.map((l) => (
            <button
              key={l}
              className={`btn ${st.selectedLeads.includes(l) ? "on" : ""}`}
              style={{ padding: "2px 7px" }}
              onClick={() => {
                const cur = st.selectedLeads;
                const next = cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l].sort((a, b) => LEAD_NAMES.indexOf(a as never) - LEAD_NAMES.indexOf(b as never));
                st.set({ selectedLeads: next.length ? next : [l] });
              }}
            >
              {l}
            </button>
          ))}
          <span className="spacer" />
          <label>
            Zoom
            <div className="seg">
              {[1, 2, 4].map((z) => (
                <button key={z} className={zoom === z ? "on" : ""} onClick={() => setZoom(z)}>×{z}</button>
              ))}
            </div>
          </label>
          {caliper !== null && (
            <span className="mono" style={{ color: "var(--accent)" }}>
              Δt {caliper.toFixed(0)} ms · {(60000 / caliper).toFixed(0)} /min
            </span>
          )}
        </div>
      )}
      <div className="ecg-canvas">
        <canvas ref={ref} className="fill" onClick={onClick} style={{ cursor: "crosshair" }} aria-label="Simulated 12-lead ECG" data-testid="ecg-canvas" />
        {inspect && st.inspectT !== null && (
          <div className="inspect" role="status" data-testid="inspect-box">
            <h4>
              {inspect.segment} · t = {(st.inspectT / 1000).toFixed(3)} s
            </h4>
            <div>{inspect.origin}</div>
            <div className="note">{inspect.caveat}</div>
            <div className="mono note">
              ventricles: front {inspect.ventricles.front.toFixed(0)}% · plateau {inspect.ventricles.plateau.toFixed(0)}% · ph3 {inspect.ventricles.phase3.toFixed(0)}% · rest {inspect.ventricles.rest.toFixed(0)}%
            </div>
            <button className="linkbtn" onClick={() => st.set({ inspectT: null })} style={{ justifySelf: "start" }}>
              Close
            </button>
          </div>
        )}
      </div>
      <div className="ecg-lower">
        <div>
          <MeasurementsTable />
        </div>
        <div>
          <EventLog />
        </div>
      </div>
    </div>
  );
}
