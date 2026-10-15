/**
 * Selected-lead traces (1–3) with the time cursor. For each lead the forward-computed
 * signal is drawn solid; the dipole-projection estimate L·P(t) is drawn dashed. For limb
 * leads they coincide by construction; for chest leads the gap is the non-dipolar content.
 */
import { useEffect, useRef } from "react";
import { sim, useStore } from "../../state/store";
import { fitCanvas, registerRenderer, seek, tokens } from "../frameLoop";
import { LEAD_COLORS, heartVector, isLimb, leadIndex, leadVector } from "./leadMath";

const WINDOW = 2600;

export function LeadStrips({ leads: override, height }: { leads?: string[]; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let last = "";
    const scaleMemo = new Map<string, number>();
    let lastT = 0;
    return registerRenderer((t) => {
      const data = sim.data;
      if (!data) return;
      if (t < lastT - 500) scaleMemo.clear(); // restart or jump back: rescale
      lastT = t;
      const st = useStore.getState();
      const leads = override ?? st.explorerLeads;
      const { w, h, dpr, resized } = fitCanvas(c);
      const key = `${t.toFixed(1)}|${data.version}|${leads.join()}|${st.theme}|${resized}|${st.present}|${st.inspectT}`;
      if (key === last) return;
      last = key;
      const tk = tokens();
      const fs = st.present ? 1.3 : 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const x0 = 58 * fs;
      const pw = w - x0 - 14;
      // Monitor-style sweep: the page (and its grid) stays fixed while the cursor moves; the
      // previous sweep remains visible ahead of the cursor after a short erase gap.
      const t0 = Math.floor(t / WINDOW) * WINDOW;
      const t1 = t0 + WINDOW;
      const GAP = 70;
      const X = (tt: number) => x0 + ((tt - t0) / WINDOW) * pw;
      const rowH = h / Math.max(1, leads.length);
      /** Current sweep [t0, t] plus the previous sweep ahead of the cursor (after the erase gap). */
      const sweep = (f: (tt: number) => number, base: number, vS: number) => {
        const seg = (a: number, b: number, shift: number) => {
          let first = true;
          for (let tt = Math.max(a, data.tStart + shift); tt <= b; tt += data.dt) {
            const v = f(tt - shift);
            if (Number.isNaN(v)) continue;
            const y = base - v * vS;
            if (first) ctx.moveTo(X(tt), y);
            else ctx.lineTo(X(tt), y);
            first = false;
          }
        };
        seg(t0, t, 0);
        if (t + GAP < t1) seg(t + GAP, t1, WINDOW);
      };
      // paper background + grid (40 ms / 0.1 mV-style, scaled per row)
      ctx.fillStyle = tk.paper;
      ctx.fillRect(x0, 0, pw, h);
      leads.forEach((lead, r) => {
        const li = leadIndex(lead);
        if (li < 0) return;
        const top = r * rowH;
        // amplitude scale: from all retained data, only ever increased (in 0.25 mV steps) so the
        // vertical scale does not jump from frame to frame
        let mx = scaleMemo.get(lead) ?? 0.6;
        for (let tt = data.tStart; tt <= data.tEnd; tt += data.dt * 3) mx = Math.max(mx, Math.ceil(Math.abs(data.at(tt, li)) * 4) / 4);
        scaleMemo.set(lead, mx);
        const vS = (rowH * 0.42) / mx;
        const base = top + rowH * 0.55;
        ctx.strokeStyle = tk["grid-minor"];
        ctx.lineWidth = 1;
        for (let g = Math.ceil(t0 / 40) * 40; g <= t1; g += 40) {
          ctx.globalAlpha = g % 200 === 0 ? 1 : 0.45;
          ctx.beginPath();
          ctx.moveTo(X(g), top);
          ctx.lineTo(X(g), top + rowH);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = tk["grid-major"];
        ctx.beginPath();
        ctx.moveTo(x0, base);
        ctx.lineTo(x0 + pw, base);
        ctx.stroke();
        // 1 mV scale bar
        ctx.strokeStyle = tk["fg-dim"];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0 - 8, base);
        ctx.lineTo(x0 - 8, base - vS);
        ctx.stroke();
        ctx.fillStyle = tk["fg-faint"];
        ctx.font = `${Math.round(9 * fs)}px IBM Plex Mono, monospace`;
        ctx.fillText("1 mV", 4, base - vS / 2);
        // estimate (dashed)
        const fit = leadVector(lead, data);
        if (!isLimb(lead)) {
          ctx.strokeStyle = tk["fg-dim"];
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          sweep((tt) => {
            const P = heartVector(data, tt);
            return P[0] * fit.vec[0] + P[1] * fit.vec[1] + P[2] * fit.vec[2];
          }, base, vS);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // actual signal
        ctx.strokeStyle = LEAD_COLORS[lead] ?? tk.trace;
        ctx.lineWidth = 2;
        ctx.beginPath();
        sweep((tt) => data.at(tt, li), base, vS);
        ctx.stroke();
        // current point
        const vNow = data.at(t, li);
        ctx.fillStyle = LEAD_COLORS[lead] ?? tk.trace;
        ctx.beginPath();
        ctx.arc(X(t), base - vNow * vS, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = tk.fg;
        ctx.font = `700 ${Math.round(15 * fs)}px IBM Plex Sans, system-ui, sans-serif`;
        ctx.fillText(lead, x0 + 6, top + 18 * fs);
        ctx.font = `${Math.round(11 * fs)}px IBM Plex Mono, monospace`;
        ctx.fillStyle = tk["fg-dim"];
        ctx.fillText(
          isLimb(lead) ? `${vNow >= 0 ? "+" : ""}${vNow.toFixed(2)} mV · = L·P exactly` : `${vNow >= 0 ? "+" : ""}${vNow.toFixed(2)} mV · dashed: L̂·P (R² ${(fit.r2 * 100).toFixed(0)} %)`,
          x0 + 46 * fs,
          top + 17 * fs,
        );
        if (r > 0) {
          ctx.strokeStyle = tk.line;
          ctx.beginPath();
          ctx.moveTo(0, top);
          ctx.lineTo(w, top);
          ctx.stroke();
        }
      });
      if (st.inspectT !== null && st.inspectT >= t0 && st.inspectT <= t1) {
        ctx.strokeStyle = tk.cursor;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(X(st.inspectT), 0);
        ctx.lineTo(X(st.inspectT), h);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // prominent time cursor
      ctx.strokeStyle = tk.cursor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(X(t), 0);
      ctx.lineTo(X(t), h);
      ctx.stroke();
      ctx.fillStyle = tk.cursor;
      ctx.font = `600 ${Math.round(10 * fs)}px IBM Plex Mono, monospace`;
      ctx.fillText(`${(t / 1000).toFixed(3)} s`, X(t) + 4, h - 5);
      (c as HTMLCanvasElement & { _map?: unknown })._map = { x0, pw, t0, t };
    });
  }, [override]);
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = (e.currentTarget as HTMLCanvasElement & { _map?: { x0: number; pw: number; t0: number; t: number } })._map;
    if (!m) return;
    const r = e.currentTarget.getBoundingClientRect();
    let tt = m.t0 + ((e.clientX - r.left - m.x0) / m.pw) * WINDOW;
    if (tt > m.t) tt -= WINDOW; // ahead of the cursor = previous sweep
    if (sim.data && tt <= sim.data.tEnd && tt >= sim.data.tStart) {
      useStore.getState().set({ inspectT: tt });
      seek(tt);
    }
  };
  return <canvas ref={ref} className="fill" onClick={onClick} style={{ cursor: "crosshair", height }} aria-label="Selected ECG leads with dipole-projection estimate" data-testid="lead-strips" />;
}
