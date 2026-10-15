/**
 * Panel A — cardiac anatomy and activation (3-D voxel point cloud, Canvas 2D with z-buffer).
 * Drag: rotate · Shift/right-drag: pan · Wheel: zoom · Click: select a cell for Panel B.
 */
import { useEffect, useRef } from "react";
import { clock, sim, useStore, type HeartColor } from "../../state/store";
import { fitCanvas, registerRenderer, tokens } from "../frameLoop";
import { CT, RG, REGION_NAMES } from "../../simulation/core/model";
import { normA } from "../cellState";
import type { ModelMeta } from "../../simulation/worker/protocol";

type RGB = [number, number, number];
const lerpC = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function ramp(stops: [number, RGB][], x: number): RGB {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++)
    if (x <= stops[i][0]) return lerpC(stops[i - 1][1], stops[i][1], (x - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  return stops[stops.length - 1][1];
}
export const VM_STOPS: [number, RGB][] = [
  [0, [44, 62, 80]],
  [0.12, [54, 92, 160]],
  [0.45, [196, 72, 38]],
  [0.75, [240, 160, 50]],
  [1, [255, 240, 196]],
];
// activation isochrones: early (bright) → late (deep violet)
export const AT_STOPS: [number, RGB][] = [
  [0, [253, 231, 37]],
  [0.33, [94, 201, 98]],
  [0.66, [33, 145, 140]],
  [1, [68, 1, 84]],
];
const STATE = { rest: [70, 84, 92] as RGB, front: [255, 255, 255] as RGB, refractory: [224, 90, 43] as RGB, relative: [139, 92, 246] as RGB };

export const legendGradient = (mode: HeartColor) =>
  mode === "vm"
    ? `linear-gradient(90deg, ${VM_STOPS.map(([x, c]) => `rgb(${c.join(",")}) ${x * 100}%`).join(",")})`
    : mode === "activation"
      ? `linear-gradient(90deg, ${AT_STOPS.map(([x, c]) => `rgb(${c.join(",")}) ${x * 100}%`).join(",")})`
      : `linear-gradient(90deg, rgb(${STATE.front}) 0 20%, rgb(${STATE.refractory}) 20% 55%, rgb(${STATE.relative}) 55% 80%, rgb(${STATE.rest}) 80%)`;

interface View {
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
}

export function HeartView() {
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 });
  const proj = useRef<{ sx: Float32Array; sy: Float32Array; dz: Float32Array; key: string } | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; pan: boolean } | null>(null);
  const lastKey = useRef("");

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let img: ImageData | null = null;
    let zbuf: Float32Array | null = null;
    const labelPos = new Map<string, [number, number, number]>();

    const project = (meta: ModelMeta, w: number, h: number) => {
      const v = view.current;
      const key = `${w}x${h}:${v.yaw.toFixed(4)}:${v.pitch.toFixed(4)}:${v.zoom.toFixed(4)}:${v.panX}:${v.panY}`;
      if (proj.current?.key === key) return proj.current;
      const n = meta.n;
      const sx = new Float32Array(n);
      const sy = new Float32Array(n);
      const dz = new Float32Array(n);
      const cy = Math.cos(v.yaw);
      const syw = Math.sin(v.yaw);
      const cp = Math.cos(v.pitch);
      const sp = Math.sin(v.pitch);
      const s = (Math.min(w, h) / 118) * v.zoom; // px per mm
      const cx0 = w / 2 + v.panX;
      const cy0 = h / 2 + v.panY + 8 * s;
      const P = meta.pos;
      for (let i = 0; i < n; i++) {
        const x = P[3 * i] + 12; // centre the whole heart (atria included) in view
        const y = P[3 * i + 1] + 8;
        const z = P[3 * i + 2];
        const x1 = x * cy + z * syw;
        const z1 = -x * syw + z * cy;
        const y2 = y * cp - z1 * sp;
        const z2 = y * sp + z1 * cp;
        sx[i] = cx0 + x1 * s;
        sy[i] = cy0 + y2 * s;
        dz[i] = z2;
      }
      proj.current = { sx, sy, dz, key };
      return proj.current;
    };

    const render = (t: number) => {
      const meta = sim.meta;
      const data = sim.data;
      if (!meta || !data) return;
      const st = useStore.getState();
      const { w, h, dpr, resized } = fitCanvas(c);
      const key = `${t.toFixed(1)}|${data.version}|${proj.current?.key}|${st.heartColor}|${JSON.stringify(st.layers)}|${st.probes.join()}|${st.customNode}|${resized}|${st.theme}`;
      const pj = project(meta, w, h);
      if (key === lastKey.current && pj.key === proj.current?.key) return;
      lastKey.current = `${t.toFixed(1)}|${data.version}|${pj.key}|${st.heartColor}|${JSON.stringify(st.layers)}|${st.probes.join()}|${st.customNode}|false|${st.theme}`;
      const W = c.width;
      const H = c.height;
      if (!img || img.width !== W || img.height !== H) {
        img = ctx.createImageData(W, H);
        zbuf = new Float32Array(W * H);
      }
      const buf = new Uint32Array(img.data.buffer);
      buf.fill(0);
      zbuf!.fill(-1e9);
      const tk = tokens();
      const lightTheme = st.theme === "light";
      const s = (Math.min(w, h) / 118) * view.current.zoom;
      const rad = Math.max(1, Math.round(1.25 * s * dpr));
      const L = st.layers;
      const mode = st.heartColor;
      // current wave (for isochrone mode)
      let wave = null as null | { id: number; tA: number; tV: number };
      if (mode === "activation") {
        const ws = data.wavesSorted();
        for (const wv of ws) if (wv.t0 <= t) wave = { id: wv.id, tA: Number.isFinite(wv.tFirstAtrial) ? wv.tFirstAtrial : wv.t0, tV: Number.isFinite(wv.tFirstVent) ? wv.tFirstVent : wv.t0 };
      }
      let dmin = Infinity;
      let dmax = -Infinity;
      for (let i = 0; i < meta.n; i++) {
        dmin = Math.min(dmin, pj.dz[i]);
        dmax = Math.max(dmax, pj.dz[i]);
      }
      const dmid = (dmin + dmax) / 2;
      for (let i = 0; i < meta.n; i++) {
        const ct = meta.cellType[i];
        if (ct === CT.ATRIAL ? !L.atria : ct === CT.VENTRICULAR ? !L.ventricles : true) continue;
        const d = pj.dz[i];
        if (L.cutaway && d > dmid + 4) continue;
        const r = data.lastActIndex(i, t);
        let col: RGB;
        if (mode === "vm") {
          col = ramp(VM_STOPS, normA(meta, data, i, r, t));
        } else if (mode === "state") {
          if (r < 0) col = STATE.rest;
          else {
            const tau = t - data.recT[r];
            const apd = data.recApd[r];
            const erp = apd * (ct === CT.ATRIAL ? st.params.atria.erpRatio : st.params.ventricles.erpRatio);
            col = tau < 5 ? STATE.front : tau < erp ? STATE.refractory : tau < apd + 30 ? STATE.relative : STATE.rest;
          }
        } else {
          if (wave && r >= 0 && data.recWave[r] === wave.id) {
            const at = data.recT[r] - (ct === CT.ATRIAL ? wave.tA : wave.tV);
            const span = ct === CT.ATRIAL ? 110 : 100;
            col = ramp(AT_STOPS, Math.min(1, at / span));
            const band = at % 10;
            if (band < 1.2) col = lerpC(col, [0, 0, 0], 0.35);
          } else col = lightTheme ? [190, 198, 202] : [40, 48, 54];
        }
        // depth shading
        const shade = 0.55 + 0.45 * ((d - dmin) / Math.max(1, dmax - dmin));
        const rr = Math.min(255, col[0] * shade) | 0;
        const gg = Math.min(255, col[1] * shade) | 0;
        const bb = Math.min(255, col[2] * shade) | 0;
        const packed = (255 << 24) | (bb << 16) | (gg << 8) | rr;
        const px = Math.round(pj.sx[i] * dpr);
        const py = Math.round(pj.sy[i] * dpr);
        for (let yy = py - rad; yy <= py + rad; yy++) {
          if (yy < 0 || yy >= H) continue;
          const row = yy * W;
          for (let xx = px - rad; xx <= px + rad; xx++) {
            if (xx < 0 || xx >= W) continue;
            const k = row + xx;
            if (d > zbuf![k]) {
              zbuf![k] = d;
              buf[k] = packed;
            }
          }
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.putImageData(img, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // conduction system overlay
      if (L.conduction) {
        ctx.lineCap = "round";
        for (const path of meta.conductionPaths) {
          const isNet = path.region === RG.PURK_LV || path.region === RG.PURK_RV;
          for (let k = 1; k < path.nodes.length; k++) {
            const a = path.nodes[k - 1];
            const b = path.nodes[k];
            const r = data.lastActIndex(b, t);
            const tau = r >= 0 ? t - data.recT[r] : 1e9;
            const live = tau < 12;
            const dep = r >= 0 && tau < data.recApd[r];
            ctx.strokeStyle = live ? "#ffffff" : dep ? tk.accent : lightTheme ? "rgba(40,90,80,0.55)" : "rgba(150,220,200,0.45)";
            ctx.lineWidth = isNet ? (live ? 1.6 : 0.8) : live ? 3 : 2;
            ctx.beginPath();
            ctx.moveTo(pj.sx[a], pj.sy[a]);
            ctx.lineTo(pj.sx[b], pj.sy[b]);
            ctx.stroke();
          }
        }
        // SA and AV nodes
        for (const [node, name] of [
          [meta.san, "SA"],
          [meta.avn, "AV"],
        ] as [number, string][]) {
          const r = data.lastActIndex(node, t);
          const tau = r >= 0 ? t - data.recT[r] : 1e9;
          ctx.fillStyle = tau < 15 ? "#ffffff" : tau < 150 ? tk.accent : tk["fg-dim"];
          ctx.beginPath();
          ctx.arc(pj.sx[node], pj.sy[node], 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = tk.fg;
          ctx.font = "600 11px IBM Plex Sans, system-ui, sans-serif";
          ctx.fillText(name, pj.sx[node] + 7, pj.sy[node] - 6);
        }
      }
      // chamber labels
      if (L.labels) {
        if (labelPos.size === 0) {
          const acc = new Map<string, [number, number, number, number]>();
          const lab = (rg: number) =>
            rg === RG.RA || rg === RG.CRISTA ? "RA" : rg === RG.LA ? "LA" : rg === RG.RV ? "RV" : rg === RG.LV ? "LV" : null;
          for (let i = 0; i < meta.n; i++) {
            const k = lab(meta.region[i]);
            if (!k) continue;
            const a = acc.get(k) ?? [0, 0, 0, 0];
            a[0] += meta.pos[3 * i];
            a[1] += meta.pos[3 * i + 1];
            a[2] += meta.pos[3 * i + 2];
            a[3]++;
            acc.set(k, a);
          }
          for (const [k, a] of acc) labelPos.set(k, [a[0] / a[3], a[1] / a[3], a[2] / a[3]]);
        }
        const v = view.current;
        const s2 = (Math.min(w, h) / 118) * v.zoom;
        ctx.font = "600 12px Barlow Semi Condensed, Arial Narrow, sans-serif";
        for (const [k, p] of labelPos) {
          const x = p[0] + 12;
          const y = p[1] + 8;
          const z = p[2];
          const x1 = x * Math.cos(v.yaw) + z * Math.sin(v.yaw);
          const z1 = -x * Math.sin(v.yaw) + z * Math.cos(v.yaw);
          const y2 = y * Math.cos(v.pitch) - z1 * Math.sin(v.pitch);
          const X = w / 2 + v.panX + x1 * s2;
          const Y = h / 2 + v.panY + 8 * s2 + y2 * s2;
          ctx.fillStyle = lightTheme ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.55)";
          ctx.fillRect(X - 11, Y - 9, 22, 15);
          ctx.fillStyle = tk.fg;
          ctx.fillText(k, X - 7, Y + 3);
        }
      }
      // probes
      const probeNodes = meta.probes.filter((p) => st.probes.includes(p.id)).map((p) => [p.node, p.label] as [number, string]);
      if (st.customNode !== null) probeNodes.push([st.customNode, "Selected cell"]);
      for (const [node, label] of probeNodes) {
        const x = pj.sx[node];
        const y = pj.sy[node];
        ctx.strokeStyle = node === st.customNode ? tk.accent : tk.info;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.stroke();
        if (node === st.customNode) {
          ctx.fillStyle = tk.accent;
          ctx.font = "500 11px IBM Plex Sans, system-ui, sans-serif";
          ctx.fillText(`${label}: ${REGION_NAMES[meta.region[node]]}`, x + 9, y + 4);
        }
      }
    };
    const unreg = registerRenderer(render);

    // ---- interaction ---------------------------------------------------------------
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, moved: false, pan: e.shiftKey || e.button === 2 };
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (!d.moved) return;
      d.x = e.clientX;
      d.y = e.clientY;
      const v = view.current;
      if (d.pan) {
        v.panX += dx;
        v.panY += dy;
      } else {
        v.yaw += dx * 0.01;
        v.pitch = Math.max(-1.5, Math.min(1.5, v.pitch + dy * 0.01));
      }
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d || d.moved || !proj.current || !sim.meta) return;
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const meta = sim.meta;
      const st = useStore.getState();
      let best = -1;
      let bestScore = Infinity;
      for (let i = 0; i < meta.n; i++) {
        const ct = meta.cellType[i];
        if (ct === CT.ATRIAL && !st.layers.atria) continue;
        if (ct === CT.VENTRICULAR && !st.layers.ventricles) continue;
        const dd = Math.hypot(proj.current.sx[i] - x, proj.current.sy[i] - y);
        if (dd > 10) continue;
        const score = dd - proj.current.dz[i] * 0.2; // prefer the front-most cell
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best >= 0) st.set({ customNode: best });
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = view.current;
      v.zoom = Math.max(0.4, Math.min(5, v.zoom * Math.exp(-e.deltaY * 0.0015)));
    };
    const ctxmenu = (e: MouseEvent) => e.preventDefault();
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("wheel", wheel, { passive: false });
    c.addEventListener("contextmenu", ctxmenu);
    return () => {
      unreg();
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("wheel", wheel);
      c.removeEventListener("contextmenu", ctxmenu);
    };
  }, []);

  const setView = (yaw: number, pitch: number) => {
    view.current = { yaw, pitch, zoom: 1, panX: 0, panY: 0 };
    void clock;
  };

  return (
    <>
      <canvas ref={ref} className="fill" aria-label="3-D cardiac activation view" data-testid="heart-canvas" />
      <div className="heart-hint">
        drag rotate · shift-drag pan · wheel zoom · click a cell
        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", marginTop: 4, pointerEvents: "auto" }}>
          <button className="btn icon" onClick={() => setView(0, 0)} title="Anterior (frontal) view">AP</button>
          <button className="btn icon" onClick={() => setView(-Math.PI / 2, 0)} title="Left lateral view">LL</button>
          <button className="btn icon" onClick={() => setView(0, Math.PI / 2)} title="Inferior view (from below)">INF</button>
        </div>
      </div>
    </>
  );
}
