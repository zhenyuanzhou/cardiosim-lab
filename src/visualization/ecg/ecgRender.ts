/**
 * ECG layout and rendering shared by the live canvas and the SVG/PNG exporters.
 * Paper conventions: 1 mm minor grid, 5 mm major grid; paper speed 25 or 50 mm/s;
 * gain 5, 10 or 20 mm/mV; 1 mV calibration pulse at the start of each row.
 */
import { ALL_LEAD_NAMES, N_CHANNELS, channelOf } from "../../simulation/ecg-forward/leadField";
import type { SimData } from "../../simulation/worker/client";
import type { BeatMeasurement } from "../../simulation/ecg-forward/measurements";

export interface Strip {
  lead: number;
  label: string;
  x: number; // left px
  w: number;
  top: number;
  h: number;
  base: number; // baseline y px
  t0: number; // time at x
  t1: number;
}

export interface EcgLayout {
  pxPerMm: number;
  plotX: number;
  plotY: number;
  plotW: number;
  plotH: number;
  strips: Strip[];
  pageStart: number;
  pageDur: number;
}

export interface EcgViewOpts {
  mode: "12lead" | "leads";
  /** Chest leads shown in the 12-lead layout: standard V1–V6, right-sided (V3R–V6R) or posterior (V7–V9). */
  chestSet?: ChestSet;
  paperSpeed: 25 | 50;
  gain: 5 | 10 | 20;
  leads: string[];
  zoom: number;
  width: number;
  height: number;
}

export type ChestSet = "standard" | "right" | "posterior";
/** Chest columns of the 3 × 4 layout for each chest-lead set (V1 and V2 are kept: V1 = V2R, V2 = V1R). */
export const CHEST_SETS: Record<ChestSet, [string[], string[]]> = {
  standard: [["V1", "V2", "V3"], ["V4", "V5", "V6"]],
  right: [["V1", "V2", "V3R"], ["V4R", "V5R", "V6R"]],
  posterior: [["V1", "V2", "V3"], ["V7", "V8", "V9"]],
};
const colsFor = (set: ChestSet = "standard"): string[][] => [["I", "II", "III"], ["aVR", "aVL", "aVF"], ...CHEST_SETS[set]];
const idx = (name: string) => channelOf(name);
export { ALL_LEAD_NAMES };

export function layoutEcg(o: EcgViewOpts, t: number): EcgLayout {
  const padL = 6;
  const padT = 4;
  const availW = o.width - padL - 6;
  const availH = o.height - padT - 18;
  if (o.mode === "12lead" && availW < 700) {
    // narrow screens: 6 × 2 format (limb leads left = first half page, chest leads right = second half)
    const pageDur = o.paperSpeed === 25 ? 10000 : 5000;
    const half = pageDur / 2;
    const mmW = (half / 1000) * o.paperSpeed * 2; // two columns
    const rowMm = 25;
    const pxPerMm = Math.max(1, Math.min(availW / mmW, availH / (rowMm * 6)));
    const plotW = mmW * pxPerMm;
    const rowH = rowMm * pxPerMm;
    const pageStart = Math.floor(t / pageDur) * pageDur;
    const strips: Strip[] = [];
    const LEFT = ["I", "II", "III", "aVR", "aVL", "aVF"];
    const RIGHT = [...CHEST_SETS[o.chestSet ?? "standard"][0], ...CHEST_SETS[o.chestSet ?? "standard"][1]];
    for (let c = 0; c < 2; c++)
      (c === 0 ? LEFT : RIGHT).forEach((name, r) =>
        strips.push({
          lead: idx(name),
          label: name,
          x: padL + (c * plotW) / 2,
          w: plotW / 2,
          top: padT + r * rowH,
          h: rowH,
          base: padT + r * rowH + rowH * 0.55,
          t0: pageStart + c * half,
          t1: pageStart + (c + 1) * half,
        }),
      );
    return { pxPerMm, plotX: padL, plotY: padT, plotW, plotH: rowH * 6, strips, pageStart, pageDur };
  }
  if (o.mode === "12lead") {
    const pageDur = o.paperSpeed === 25 ? 10000 : 5000;
    const mmW = (pageDur / 1000) * o.paperSpeed; // 250 mm
    const rowMm = 40;
    const pxPerMm = Math.max(1.2, Math.min(availW / mmW, availH / (rowMm * 4)));
    const plotW = mmW * pxPerMm;
    const plotH = rowMm * 4 * pxPerMm;
    const pageStart = Math.floor(t / pageDur) * pageDur;
    const colDur = pageDur / 4;
    const strips: Strip[] = [];
    const rowH = plotH / 4;
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 3; r++) {
        const name = colsFor(o.chestSet)[c][r];
        strips.push({
          lead: idx(name),
          label: name,
          x: padL + (c * plotW) / 4,
          w: plotW / 4,
          top: padT + r * rowH,
          h: rowH,
          base: padT + r * rowH + rowH * 0.55,
          t0: pageStart + c * colDur,
          t1: pageStart + (c + 1) * colDur,
        });
      }
    strips.push({ lead: 1, label: "II", x: padL, w: plotW, top: padT + 3 * rowH, h: rowH, base: padT + 3 * rowH + rowH * 0.55, t0: pageStart, t1: pageStart + pageDur });
    return { pxPerMm, plotX: padL, plotY: padT, plotW, plotH, strips, pageStart, pageDur };
  }
  // stacked selected leads, scrolling window ending at t
  const leads = o.leads.length ? o.leads : ["II"];
  const pxPerMm = Math.max(1.5, availW / 250) * o.zoom;
  const durMs = (availW / pxPerMm / o.paperSpeed) * 1000;
  const rowH = availH / leads.length;
  // monitor-style page sweep: the page stays fixed while the cursor moves (no scrolling jitter)
  const pageStart = Math.floor(t / durMs) * durMs;
  const t1 = pageStart + durMs;
  const strips = leads.map((name, k) => ({
    lead: idx(name),
    label: name,
    x: padL,
    w: availW,
    top: padT + k * rowH,
    h: rowH,
    base: padT + k * rowH + rowH * 0.55,
    t0: t1 - durMs,
    t1,
  }));
  return { pxPerMm, plotX: padL, plotY: padT, plotW: availW, plotH: availH, strips, pageStart, pageDur: durMs };
}

export interface Painter {
  rect(x: number, y: number, w: number, h: number, fill: string): void;
  line(pts: number[], stroke: string, width: number, dash?: number[]): void;
  text(x: number, y: number, s: string, fill: string, font: string): void;
  clip(x: number, y: number, w: number, h: number, fn: () => void): void;
}

export interface EcgColors {
  paper: string;
  minor: string;
  major: string;
  trace: string;
  traceB: string;
  label: string;
  cursor: string;
  fiducial: string;
}

export function drawEcg(
  p: Painter,
  L: EcgLayout,
  o: EcgViewOpts,
  data: SimData,
  t: number,
  col: EcgColors,
  extra?: { beats?: BeatMeasurement[]; overlay?: { ecg: Float32Array; dt: number } | null; inspectT?: number | null; calipers?: number[] },
): void {
  const mm = L.pxPerMm;
  p.rect(L.plotX, L.plotY, L.plotW, L.plotH, col.paper);
  // grid
  for (let k = 0; k * mm <= L.plotW + 0.01; k++) {
    const x = L.plotX + k * mm;
    p.line([x, L.plotY, x, L.plotY + L.plotH], k % 5 === 0 ? col.major : col.minor, k % 5 === 0 ? 0.8 : 0.5);
  }
  for (let k = 0; k * mm <= L.plotH + 0.01; k++) {
    const y = L.plotY + k * mm;
    p.line([L.plotX, y, L.plotX + L.plotW, y], k % 5 === 0 ? col.major : col.minor, k % 5 === 0 ? 0.8 : 0.5);
  }
  const vScale = o.gain * mm; // px per mV
  const tScale = (o.paperSpeed * mm) / 1000; // px per ms
  for (const s of L.strips) {
    const X = (tt: number) => s.x + (tt - s.t0) * tScale;
    p.clip(s.x, s.top, s.w, s.h, () => {
      // calibration pulse (only at the left edge of the page)
      if (s.x === L.plotX) {
        const cx = s.x + 2 * mm;
        p.line([cx, s.base, cx + mm, s.base, cx + mm, s.base - vScale, cx + 6 * mm, s.base - vScale, cx + 6 * mm, s.base, cx + 7 * mm, s.base], col.trace, 1.1);
      }
      // overlay (A/B comparison) first so the live trace is on top
      if (extra?.overlay) {
        const ov = extra.overlay;
        const pts: number[] = [];
        const n = ov.ecg.length / N_CHANNELS;
        for (let tt = s.t0; tt <= s.t1; tt += ov.dt) {
          const i = Math.round(tt / ov.dt);
          if (i < 0 || i >= n) continue;
          pts.push(X(tt), s.base - ov.ecg[i * N_CHANNELS + s.lead] * vScale);
        }
        if (pts.length > 2) p.line(pts, col.traceB, 1.1);
      }
      const until = Math.min(s.t1, t);
      const pts: number[] = [];
      const dt = data.dt;
      for (let tt = Math.max(s.t0, data.tStart); tt <= until; tt += dt) {
        const v = data.at(tt, s.lead);
        if (Number.isNaN(v)) continue;
        pts.push(X(tt), s.base - v * vScale);
      }
      if (pts.length > 2) p.line(pts, col.trace, 1.25);
      // previous page shown faintly ahead of the sweep (12-lead mode)
      if (o.mode === "12lead" && t < s.t1) {
        const gapEnd = Math.max(s.t0, t + 300);
        const prev: number[] = [];
        for (let tt = gapEnd; tt <= s.t1; tt += dt) {
          const v = data.at(tt - L.pageDur, s.lead);
          if (Number.isNaN(v)) continue;
          prev.push(X(tt), s.base - v * vScale);
        }
        if (prev.length > 2) p.line(prev, col.minor, 1);
      }
      // fiducials
      if (extra?.beats && (o.mode === "leads" || s.label === "II")) {
        for (const b of extra.beats) {
          for (const [tt, kind] of [
            [b.pOn, "P"],
            [b.qrsOn, "Q"],
            [b.qrsOff, "J"],
            [b.tEnd, "Te"],
          ] as [number | null, string][]) {
            if (tt === null || tt < s.t0 || tt > Math.min(s.t1, t)) continue;
            const x = X(tt);
            p.line([x, s.top + s.h - 10, x, s.top + s.h - 2], col.fiducial, 1);
            if (mm >= 2.6) p.text(x + 1, s.top + s.h - 11, kind, col.fiducial, "9px IBM Plex Mono, monospace");
          }
        }
      }
      if (extra?.inspectT != null && extra.inspectT >= s.t0 && extra.inspectT <= s.t1) {
        const x = X(extra.inspectT);
        p.line([x, s.top, x, s.top + s.h], col.cursor, 1, [4, 3]);
      }
      if (extra?.calipers && o.mode === "leads")
        for (const c of extra.calipers) if (c >= s.t0 && c <= s.t1) p.line([X(c), s.top, X(c), s.top + s.h], col.cursor, 1.2);
    });
    const fs = Math.round(Math.max(13, Math.min(18, s.h * 0.16)));
    const lx = s.x + 5 + (s.x <= 7 ? 7 * L.pxPerMm : 0); // first column: keep clear of the 1 mV calibration pulse
    p.text(lx, s.top + fs + 3, s.label, col.label, `700 ${fs}px IBM Plex Sans, system-ui, sans-serif`);
    // sweep cursor
    if (t >= s.t0 && t <= s.t1) p.line([X(t), s.top, X(t), s.top + s.h], col.cursor, 1.4);
  }
  // column separators in 12-lead mode
  if (o.mode === "12lead") {
    const nCol = L.strips.length === 12 ? 2 : 4;
    for (let c = 1; c < nCol; c++) {
      const x = L.plotX + (c * L.plotW) / nCol;
      p.line([x, L.plotY, x, L.plotY + (nCol === 2 ? L.plotH : (L.plotH * 3) / 4)], col.label, 1);
    }
  }
  const info = `${o.paperSpeed} mm/s · ${o.gain} mm/mV · ${(1000 / data.dt).toFixed(0)} Hz · page ${(L.pageStart / 1000).toFixed(1)}–${((L.pageStart + L.pageDur) / 1000).toFixed(1)} s`;
  p.text(L.plotX, L.plotY + L.plotH + 13, info, col.label, "10.5px IBM Plex Mono, monospace");
}

export class CanvasPainter implements Painter {
  constructor(private ctx: CanvasRenderingContext2D) {}
  rect(x: number, y: number, w: number, h: number, fill: string) {
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(x, y, w, h);
  }
  line(pts: number[], stroke: string, width: number, dash?: number[]) {
    const c = this.ctx;
    c.strokeStyle = stroke;
    c.lineWidth = width;
    c.setLineDash(dash ?? []);
    c.beginPath();
    c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.stroke();
    c.setLineDash([]);
  }
  text(x: number, y: number, s: string, fill: string, font: string) {
    this.ctx.fillStyle = fill;
    this.ctx.font = font;
    this.ctx.fillText(s, x, y);
  }
  clip(x: number, y: number, w: number, h: number, fn: () => void) {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(x, y, w, h);
    this.ctx.clip();
    fn();
    this.ctx.restore();
  }
}

export class SvgPainter implements Painter {
  parts: string[] = [];
  private clipId = 0;
  private stack: string[] = [];
  private esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  private emit(s: string) {
    this.parts.push(s);
  }
  rect(x: number, y: number, w: number, h: number, fill: string) {
    this.emit(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="${fill}"/>`);
  }
  line(pts: number[], stroke: string, width: number, dash?: number[]) {
    const d = [];
    for (let i = 0; i < pts.length; i += 2) d.push(`${pts[i].toFixed(2)},${pts[i + 1].toFixed(2)}`);
    this.emit(`<polyline fill="none" stroke="${stroke}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash.join(" ")}"` : ""} points="${d.join(" ")}"/>`);
  }
  text(x: number, y: number, s: string, fill: string, font: string) {
    const size = /(\d+(\.\d+)?)px/.exec(font)?.[1] ?? "11";
    const weight = /^(\d{3})/.exec(font)?.[1] ?? "400";
    this.emit(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${fill}" font-family="IBM Plex Sans, Arial, sans-serif" font-size="${size}" font-weight="${weight}">${this.esc(s)}</text>`);
  }
  clip(x: number, y: number, w: number, h: number, fn: () => void) {
    const id = `c${++this.clipId}`;
    this.emit(`<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath><g clip-path="url(#${id})">`);
    this.stack.push(id);
    fn();
    this.stack.pop();
    this.emit(`</g>`);
  }
  toString(w: number, h: number, bg: string) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${bg}"/>${this.parts.join("")}</svg>`;
  }
}

/** CSV of all 12 leads over [t0, t1] (ms, mV). */
export function ecgCsv(data: SimData, t0: number, t1: number): string {
  const rows = [["time_ms", ...ALL_LEAD_NAMES].join(",")];
  for (let tt = Math.max(t0, data.tStart); tt <= Math.min(t1, data.tEnd); tt += data.dt) {
    const i = Math.round(tt / data.dt);
    const vals = ALL_LEAD_NAMES.map((n) => data.sample(i, channelOf(n)).toFixed(5));
    rows.push([(i * data.dt).toFixed(1), ...vals].join(","));
  }
  return rows.join("\n");
}
