/**
 * Frontal-plane (hexaxial) and horizontal-plane diagrams of the heart vector, drawn from
 * the simulated dipole P(t) on the shared display clock.
 */
import { useEffect, useRef } from "react";
import { sim, useStore } from "../../state/store";
import { fitCanvas, registerRenderer, tokens } from "../frameLoop";
import { LEAD_COLORS, LIMB_LEAD_VECTORS, dot3, heartVector, isLimb, leadVector } from "./leadMath";
import { CHEST } from "../../simulation/ecg-forward/leadField";
import { CT } from "../../simulation/core/model";
import { PRECORDIAL_POS } from "./leadMath";
import type { SimData } from "../../simulation/worker/client";
import type { Vec3 } from "../../simulation/core/vec";
import type { WaveInfo } from "../../simulation/core/engine";

const PHASE_COLORS = { p: "#7aa2ff", qrs: "#ffa033", t: "#b47cff", other: "#8a9396" };

export function phaseOf(w: WaveInfo | null, tt: number): keyof typeof PHASE_COLORS {
  if (!w) return "other";
  if (Number.isFinite(w.tFirstAtrial) && tt >= w.tFirstAtrial && tt <= w.tLastAtrial + 15) return "p";
  if (Number.isFinite(w.tFirstVent) && tt >= w.tFirstVent && tt <= w.tLastVent + 8) return "qrs";
  if (Number.isFinite(w.tLastVent) && tt > w.tLastVent + 8 && tt <= w.tVentRepolEnd + 30) return "t";
  return "other";
}
export { PHASE_COLORS };

function currentWave(data: SimData, t: number): WaveInfo | null {
  let cur: WaveInfo | null = null;
  for (const w of data.wavesSorted()) if (w.t0 <= t) cur = w;
  return cur;
}

/** Robust vector scale: 98th percentile of |P| over the retained data (cached). */
let scaleCache = { version: -1, v: 1.5 };
export function vectorRange(data: SimData): number {
  if (scaleCache.version === data.version) return scaleCache.v;
  const ns = data.sampleEnd - data.sampleOffset;
  const mags: number[] = [];
  for (let k = Math.max(0, ns - 4000); k < ns; k += 3) {
    const o = k * 15;
    mags.push(Math.hypot(data.ecg[o + 12], data.ecg[o + 13], data.ecg[o + 14]));
  }
  mags.sort((a, b) => a - b);
  const v = Math.max(0.3, mags[Math.floor(mags.length * 0.98)] ?? 1.5);
  scaleCache = { version: data.version, v };
  return v;
}

function arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, width = 2.5) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const L = Math.hypot(x1 - x0, y1 - y0);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - Math.cos(a) * Math.min(8, L * 0.4), y1 - Math.sin(a) * Math.min(8, L * 0.4));
  ctx.stroke();
  if (L > 3) {
    const hl = Math.min(11, L * 0.5);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - hl * Math.cos(a - 0.4), y1 - hl * Math.sin(a - 0.4));
    ctx.lineTo(x1 - hl * Math.cos(a + 0.4), y1 - hl * Math.sin(a + 0.4));
    ctx.closePath();
    ctx.fill();
  }
}

export function FrontalPlane({ compact = false }: { compact?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let last = "";
    return registerRenderer((t) => {
      const data = sim.data;
      if (!data) return;
      const st = useStore.getState();
      const { w, h, dpr, resized } = fitCanvas(c);
      const key = `${t.toFixed(1)}|${data.version}|${st.explorerLeads.join()}|${st.theme}|${resized}|${st.present}`;
      if (key === last) return;
      last = key;
      const tk = tokens();
      const fs = st.present ? 1.25 : 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2 + (compact ? 10 : 24);
      const R = Math.min(w * 0.36, (h - 70) * 0.4);
      // reference circle
      ctx.strokeStyle = tk.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      // axes
      const sel = st.explorerLeads;
      for (const [lead, v] of Object.entries(LIMB_LEAD_VECTORS)) {
        const ang = Math.atan2(v[1], v[0]);
        const ux = Math.cos(ang);
        const uy = Math.sin(ang);
        const on = sel.includes(lead);
        ctx.strokeStyle = on ? LEAD_COLORS[lead] : tk["fg-faint"];
        ctx.lineWidth = on ? 3 : 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + ux * R, cy + uy * R);
        ctx.stroke();
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - ux * R, cy - uy * R);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = on ? LEAD_COLORS[lead] : tk["fg-dim"];
        ctx.font = `${on ? 700 : 500} ${Math.round(12 * fs)}px IBM Plex Sans, system-ui, sans-serif`;
        const deg = Math.round((ang * 180) / Math.PI);
        const lab = `${lead} ${deg > 0 ? "+" : ""}${deg}°`;
        const tw = ctx.measureText(lab).width;
        const lx = cx + ux * (R + 14) - tw / 2 + ux * tw * 0.35;
        ctx.fillText(lab, lx, cy + uy * (R + 14) + 4);
        // positive pole marker
        ctx.beginPath();
        ctx.arc(cx + ux * R, cy + uy * R, on ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      const range = vectorRange(data);
      const S = (R * 0.95) / range;
      const wv = currentWave(data, t);
      // loop of the current wave (frontal projection)
      if (wv) {
        const t0 = Math.max(wv.t0, t - 900);
        let prev: [number, number] | null = null;
        for (let tt = t0; tt <= t; tt += data.dt) {
          const x = cx + data.at(tt, 12) * S;
          const y = cy + data.at(tt, 13) * S;
          if (prev) {
            ctx.strokeStyle = PHASE_COLORS[phaseOf(wv, tt)];
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(x, y);
            ctx.stroke();
          }
          prev = [x, y];
        }
      }
      const P = heartVector(data, t);
      const tipX = cx + P[0] * S;
      const tipY = cy + P[1] * S;
      // projection on the primary limb lead
      const primary = sel[0];
      if (primary && isLimb(primary)) {
        const L = LIMB_LEAD_VECTORS[primary];
        const ln = Math.hypot(L[0], L[1]);
        const u: [number, number] = [L[0] / ln, L[1] / ln];
        const proj = P[0] * u[0] + P[1] * u[1];
        const fx = cx + u[0] * proj * S;
        const fy = cy + u[1] * proj * S;
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = tk["fg-dim"];
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(fx, fy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = proj >= 0 ? tk.ok : tk.bad;
        ctx.lineWidth = 6;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(fx, fy);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      arrow(ctx, cx, cy, tipX, tipY, "#35d0ff", 3);
      // measured mean QRS axis (signal-derived)
      const beats = data.measure().filter((b) => b.qrsOff <= t);
      const b = beats[beats.length - 1];
      if (b) {
        const a = (b.axisQRS * Math.PI) / 180;
        ctx.strokeStyle = tk.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (R - 9), cy + Math.sin(a) * (R - 9));
        ctx.lineTo(cx + Math.cos(a) * (R + 9), cy + Math.sin(a) * (R + 9));
        ctx.stroke();
      }
      ctx.fillStyle = tk["fg-dim"];
      ctx.font = `${Math.round(11 * fs)}px IBM Plex Sans, system-ui, sans-serif`;
      ctx.fillText("Frontal plane · hexaxial reference", 8, 15 * fs);
      if (!compact) {
        ctx.fillText(b ? `QRS axis from ECG: ${b.axisQRS.toFixed(0)}° (amber tick)` : "", 8, 15 * fs + 16 * fs);
        ctx.fillText("+90° (aVF) points to the feet · limb leads = exact dipole projections here", 8, 15 * fs + 32 * fs);
      }
    });
  }, [compact]);
  return <canvas ref={ref} className="fill" aria-label="Frontal-plane hexaxial diagram with the heart vector" data-testid="hexaxial" />;
}

/** Convex hull (monotone chain). */
function hull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

let hullCache: { v: [number, number][]; a: [number, number][] } | null = null;

export function HorizontalPlane() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let last = "";
    return registerRenderer((t) => {
      const data = sim.data;
      const meta = sim.meta;
      if (!data || !meta) return;
      const st = useStore.getState();
      const { w, h, dpr, resized } = fitCanvas(c);
      const key = `${t.toFixed(1)}|${data.version}|${st.explorerLeads.join()}|${st.theme}|${resized}|${st.present}`;
      if (key === last) return;
      last = key;
      const tk = tokens();
      const fs = st.present ? 1.25 : 1;
      if (!hullCache) {
        const v: [number, number][] = [];
        const a: [number, number][] = [];
        for (let i = 0; i < meta.n; i += 2) {
          if (meta.cellType[i] === CT.VENTRICULAR) v.push([meta.pos[3 * i], meta.pos[3 * i + 2]]);
          else if (meta.cellType[i] === CT.ATRIAL) a.push([meta.pos[3 * i], meta.pos[3 * i + 2]]);
        }
        hullCache = { v: hull(v), a: hull(a) };
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const C = CHEST;
      const sc = Math.min((w - 40) / (2 * C.halfWidth + 30), (h - 50) / (2 * C.halfDepth + 30));
      const ox = w / 2 - C.midlineX * sc;
      const oy = h / 2 + 6 - C.centerZ * -sc;
      const X = (x: number) => ox + x * sc;
      const Y = (z: number) => oy - z * sc; // anterior up
      // chest outline
      ctx.strokeStyle = tk["fg-faint"];
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(X(C.midlineX), Y(C.centerZ), C.halfWidth * sc, C.halfDepth * sc, 0, 0, Math.PI * 2);
      ctx.stroke();
      const poly = (pts: [number, number][], fill: string) => {
        ctx.beginPath();
        pts.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Y(z)) : ctx.moveTo(X(x), Y(z))));
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      };
      poly(hullCache.a, "rgba(120,130,180,0.25)");
      poly(hullCache.v, "rgba(190,120,100,0.35)");
      // electrodes
      const sel = st.explorerLeads;
      for (const [name, p] of Object.entries(PRECORDIAL_POS)) {
        const on = sel.includes(name);
        ctx.fillStyle = on ? LEAD_COLORS[name] : tk["fg-dim"];
        ctx.beginPath();
        ctx.arc(X(p[0]), Y(p[2]), on ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `${on ? 700 : 500} ${Math.round(12 * fs)}px IBM Plex Sans, system-ui, sans-serif`;
        const dx = p[0] - C.midlineX;
        ctx.fillText(name, X(p[0]) + (dx < 0 ? -22 : dx > 120 ? 8 : -6), Y(p[2]) + (dx > 120 ? 4 : -9));
      }
      const range = vectorRange(data);
      const S = (Math.min(C.halfDepth, 90) * sc * 0.95) / range;
      const cx = X(0);
      const cy = Y(0);
      const wv = currentWave(data, t);
      if (wv) {
        let prev: [number, number] | null = null;
        for (let tt = Math.max(wv.t0, t - 900); tt <= t; tt += data.dt) {
          const x = cx + data.at(tt, 12) * S;
          const y = cy - data.at(tt, 14) * S;
          if (prev) {
            ctx.strokeStyle = PHASE_COLORS[phaseOf(wv, tt)];
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(x, y);
            ctx.stroke();
          }
          prev = [x, y];
        }
      }
      const P = heartVector(data, t);
      const primary = sel[0];
      if (primary && !isLimb(primary)) {
        const e = PRECORDIAL_POS[primary];
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = tk["fg-faint"];
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(X(e[0]), Y(e[2]));
        ctx.stroke();
        const fit = leadVector(primary, data);
        const lx = fit.vec[0];
        const lz = fit.vec[2];
        const ln = Math.hypot(lx, lz) || 1;
        const u: [number, number] = [lx / ln, lz / ln];
        ctx.setLineDash([7, 4]);
        ctx.strokeStyle = LEAD_COLORS[primary];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - u[0] * 70 * sc, cy + u[1] * 70 * sc);
        ctx.lineTo(cx + u[0] * 120 * sc, cy - u[1] * 120 * sc);
        ctx.stroke();
        ctx.setLineDash([]);
        const proj = P[0] * u[0] + P[2] * u[1];
        ctx.strokeStyle = proj >= 0 ? tk.ok : tk.bad;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + u[0] * proj * S, cy - u[1] * proj * S);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = tk["fg-dim"];
        ctx.font = `${Math.round(11 * fs)}px IBM Plex Sans, system-ui, sans-serif`;
        ctx.fillText(`${primary}: effective lead vector (dashed, least-squares fit) explains ${(fit.r2 * 100).toFixed(0)} % of the signal`, 8, h - 7);
      } else {
        ctx.fillStyle = tk["fg-dim"];
        ctx.font = `${Math.round(11 * fs)}px IBM Plex Sans, system-ui, sans-serif`;
        ctx.fillText("Select a chest lead to see its effective lead vector", 8, h - 7);
      }
      arrow(ctx, cx, cy, cx + P[0] * S, cy - P[2] * S, "#35d0ff", 3);
      ctx.fillStyle = tk["fg-dim"];
      ctx.font = `${Math.round(11 * fs)}px IBM Plex Sans, system-ui, sans-serif`;
      ctx.fillText("Horizontal plane (viewed from below): anterior ↑, patient's left →", 8, 15 * fs);
    });
  }, []);
  return <canvas ref={ref} className="fill" aria-label="Horizontal-plane diagram with chest electrodes" data-testid="horizontal-plane" />;
}

/** Dot product helper exported for the info card. */
export const projectOn = (P: Vec3, L: Vec3) => dot3(P, L);
