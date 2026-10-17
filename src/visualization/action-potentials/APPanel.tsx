/**
 * Panel B — synchronised cellular action potentials with a time-aligned lead II strip.
 * Every trace is evaluated from the same activation records and waveform functions that
 * generated the ECG, on the same display clock (cursor at the right edge = "now").
 */
import { useEffect, useRef } from "react";
import { sim, useStore } from "../../state/store";
import { fitCanvas, registerRenderer, tokens } from "../frameLoop";
import { CT } from "../../simulation/core/model";
import { NODAL, nodalV, repolMidpoint, ventricularNotchScale, workingA } from "../../simulation/cellular/actionPotential";
import { apModsFor, vmOf } from "../apMods";
import { deriveAutonomic } from "../../simulation/core/derive";

/**
 * Panel B shows exactly the same page as the 12-lead panel, so the two agree.
 *
 * The 12-lead panel sweeps a fixed page (10 s at 25 mm/s, 5 s at 50 mm/s) with a moving cursor.
 * This panel previously swept a 2 s sub-page: both cursors marked the same instant in time, but
 * the panels covered different spans, so at (say) t = 4.2 s the ECG showed a nearly full page of
 * beats while this panel showed an almost empty 4–6 s window. Using the same page means a beat
 * sits at the same fraction of the width in both panels and the cursors move together.
 */
const apWindow = (paperSpeed: 25 | 50) => (paperSpeed === 25 ? 10000 : 5000);
const LABEL_W = 132;
const V_MIN = -95;
const V_MAX = 45;

export function APPanel({ probeIds }: { probeIds?: string[] } = {}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef("");
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const render = (t: number) => {
      const meta = sim.meta;
      const data = sim.data;
      if (!meta || !data) return;
      const st = useStore.getState();
      const { w, h, dpr, resized } = fitCanvas(c);
      const key = `${t.toFixed(1)}|${data.version}|${st.probes.join()}|${st.customNode}|${st.inspectT}|${st.theme}|${resized}|${w}x${h}`;
      if (key === last.current) return;
      last.current = key;
      const tk = tokens();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const ids = probeIds ?? st.probes;
      const lanes = meta.probes.filter((p) => ids.includes(p.id)).map((p) => ({ node: p.node, label: p.label }));
      if (st.customNode !== null) lanes.push({ node: st.customNode, label: st.customLabel.length > 18 ? "Selected cell" : st.customLabel });
      const WINDOW = apWindow(st.paperSpeed);
      const stripH = Math.max(56, Math.min(90, h * 0.2));
      const axisH = 16;
      const laneH = (h - stripH - axisH) / Math.max(1, lanes.length);
      const x0 = LABEL_W;
      const pw = w - x0 - 8;
      // scroll in whole-pixel steps so samples and grid lines do not shimmer between frames
      const msPerPx = WINDOW / Math.max(1, pw);
      // page sweep, aligned to the ECG panel's page (see the note on apWindow)
      const t0 = Math.floor(t / WINDOW) * WINDOW;
      const tEnd = Math.min(t, t0 + WINDOW); // traces are drawn up to the cursor only
      const X = (tt: number) => x0 + ((tt - t0) / WINDOW) * pw;
      // time grid: keep the lines at least ~8 px apart, whatever the page length
      const gridMs = [200, 500, 1000, 2000].find((g) => g / msPerPx >= 8) ?? 2000;
      ctx.strokeStyle = tk.line;
      ctx.lineWidth = 1;
      ctx.font = "10px IBM Plex Mono, monospace";
      ctx.fillStyle = tk["fg-faint"];
      for (let g = Math.ceil(t0 / gridMs) * gridMs; g <= t0 + WINDOW; g += gridMs) {
        const x = X(g);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h - axisH);
        ctx.stroke();
        if (Math.round(g) % 1000 === 0 && x + 26 <= w) ctx.fillText(`${(g / 1000).toFixed(0)} s`, x + 2, h - 4);
      }
      const d = deriveAutonomic(st.params);
      const mods = apModsFor(meta, st.params);
      lanes.forEach((lane, li) => {
        const y0 = li * laneH;
        const Y = (v: number) => y0 + 4 + ((V_MAX - v) / (V_MAX - V_MIN)) * (laneH - 8);
        const ct = meta.cellType[lane.node];
        // lane separator & label
        ctx.strokeStyle = tk.line;
        ctx.beginPath();
        ctx.moveTo(0, y0 + laneH);
        ctx.lineTo(w, y0 + laneH);
        ctx.stroke();
        ctx.fillStyle = tk.fg;
        ctx.font = "500 11.5px IBM Plex Sans, system-ui, sans-serif";
        ctx.fillText(lane.label, 8, y0 + 15);
        // 0 mV reference
        ctx.strokeStyle = tk["grid-minor"];
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x0, Y(0));
        ctx.lineTo(w - 8, Y(0));
        ctx.stroke();
        ctx.setLineDash([]);
        // activations relevant to the window
        const recs = data.activationsIn(lane.node, t0 - 1000, tEnd);
        const shape = mods.shapes[ct];
        const notch = ct === CT.VENTRICULAR ? ventricularNotchScale(meta.transmural[lane.node]) : 1;
        const nodal = ct === CT.SAN || ct === CT.AVN;
        const cycles = recs.map((r, k) => (k + 1 < recs.length ? data.recT[recs[k + 1]] - data.recT[r] : k > 0 ? data.recT[r] - data.recT[recs[k - 1]] : d.sinusCycle));
        const vAt = (tt: number) => {
          let k = -1;
          for (let q = 0; q < recs.length; q++) if (data.recT[recs[q]] <= tt) k = q;
          if (k < 0) return nodal ? (ct === CT.SAN ? NODAL.san.mdp : NODAL.avn.mdp) : vmOf(mods, ct, lane.node, 0);
          const r = recs[k];
          const tau = tt - data.recT[r];
          const apd = data.recApd[r];
          if (nodal) return nodalV(ct === CT.SAN ? "san" : "avn", tau, apd, cycles[k]);
          return vmOf(mods, ct, lane.node, workingA(shape, tau, apd, repolMidpoint(shape, apd), notch));
        };
        ctx.strokeStyle = tk.trace;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        const step = msPerPx;
        let first = true;
        for (let tt = t0; tt <= tEnd; tt += step) {
          const x = X(tt);
          const y = Y(vAt(tt));
          if (first) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          first = false;
        }
        ctx.stroke();
        // annotations for the most recent activation in the window
        const lastIdx = recs.length - 1;
        let ann = lastIdx;
        while (ann >= 0 && data.recT[recs[ann]] > tEnd) ann--;
        if (ann >= 0) {
          const r = recs[ann];
          const ta = data.recT[r];
          const apd = data.recApd[r];
          const erp = ct === CT.AVN ? d.avn.erp : ct === CT.SAN ? apd * 0.9 : apd * (ct === CT.ATRIAL ? st.params.atria.erpRatio : st.params.ventricles.erpRatio);
          ctx.font = "10.5px IBM Plex Mono, monospace";
          ctx.fillStyle = tk["fg-dim"];
          if (laneH >= 50) {
            ctx.fillText(`APD90 ${apd.toFixed(0)} ms`, 8, y0 + 29);
            ctx.fillText(`ERP ${erp.toFixed(0)} ms${ct === CT.AVN ? "*" : ""}`, 8, y0 + 42);
          } else {
            ctx.fillText(`${apd.toFixed(0)} / ${erp.toFixed(0)} ms${ct === CT.AVN ? "*" : ""}`, 8, y0 + 27);
          }
          if (ta >= t0) {
            // APD90 bar at the 90 %-repolarisation level and ERP tick
            const vRest = nodal ? (ct === CT.SAN ? NODAL.san.mdp : NODAL.avn.mdp) : shape.vRest;
            const vPk = nodal ? (ct === CT.SAN ? NODAL.san.peak : NODAL.avn.peak) : shape.vPeak;
            const y90 = Y(vRest + 0.1 * (vPk - vRest));
            ctx.strokeStyle = tk.info;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(X(ta), y90);
            ctx.lineTo(Math.min(X(tEnd), X(ta + apd)), y90);
            ctx.stroke();
            if (ta + erp <= tEnd) {
              ctx.strokeStyle = tk.bad;
              ctx.beginPath();
              ctx.moveTo(X(ta + erp), Y(V_MAX) + 2);
              ctx.lineTo(X(ta + erp), Y(V_MIN));
              ctx.stroke();
            }
            // phase labels
            ctx.fillStyle = tk.accent;
            ctx.font = "600 10px IBM Plex Sans, system-ui, sans-serif";
            const lab = (txt: string, tt: number, v: number) => {
              if (tt < t0 || tt > tEnd) return;
              ctx.fillText(txt, X(tt) + 2, Y(v) - 3);
            };
            if (!nodal) {
              lab("0", ta + 1, -30);
              if (shape.notch * notch > 0.15) lab("1", ta + 9, shape.vPeak - 6);
              lab("2", ta + 0.5 * apd, vAt(ta + 0.5 * apd) + 4);
              lab("3", ta + repolMidpoint(shape, apd), vAt(ta + repolMidpoint(shape, apd)) + 2);
              lab("4", ta + apd + 60, shape.vRest + 6);
            } else {
              lab("0", ta + 2, -20);
              lab("3", ta + apd * 0.8, vAt(ta + apd * 0.8) + 2);
              lab("4", ta + apd + 80, vAt(ta + apd + 80) + 8);
            }
          }
        }
      });
      // lead II strip
      const sy0 = h - stripH - axisH;
      ctx.fillStyle = tk.paper;
      ctx.fillRect(x0, sy0, pw, stripH);
      const mvPx = stripH / 3.2;
      const base = sy0 + stripH * 0.62;
      ctx.strokeStyle = tk["grid-minor"];
      for (let g = Math.ceil(t0 / 40) * 40; g <= t0 + WINDOW; g += 40) {
        ctx.beginPath();
        ctx.moveTo(X(g), sy0);
        ctx.lineTo(X(g), sy0 + stripH);
        ctx.stroke();
      }
      ctx.fillStyle = tk.fg;
      ctx.font = "500 11.5px IBM Plex Sans, system-ui, sans-serif";
      ctx.fillText("Lead II", 8, sy0 + 16);
      ctx.fillStyle = tk["fg-faint"];
      ctx.font = "10px IBM Plex Sans, system-ui, sans-serif";
      ctx.fillText("same page as ECG", 8, sy0 + 30, LABEL_W - 16);
      ctx.strokeStyle = tk.trace;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      let first = true;
      for (let tt = Math.ceil(Math.max(t0, data.tStart) / data.dt) * data.dt; tt <= tEnd; tt += data.dt) {
        const v = data.at(tt, 1);
        if (Number.isNaN(v)) continue;
        const x = X(tt);
        const y = base - v * mvPx;
        if (first) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        first = false;
      }
      ctx.stroke();
      // inspect marker & now-cursor
      if (st.inspectT !== null && st.inspectT >= t0 && st.inspectT <= t0 + WINDOW) {
        ctx.strokeStyle = tk.cursor;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(X(st.inspectT), 0);
        ctx.lineTo(X(st.inspectT), h - axisH);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = tk.cursor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(X(t), 0);
      ctx.lineTo(X(t), h - axisH);
      ctx.stroke();
    };
    return registerRenderer(render);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeIds?.join()]);
  return <canvas ref={ref} className="fill" aria-label="Action potentials and lead II on a common time axis" data-testid="ap-canvas" />;
}
