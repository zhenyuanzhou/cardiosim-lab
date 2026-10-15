/**
 * Single animation loop: advances the display clock (display time ≠ simulation time; the
 * display may run slower or faster than real time but never past simulated data) and
 * calls every registered renderer with the same timestamp, so all views stay in step.
 */
import { clock, sim, useStore } from "../state/store";

type Renderer = (t: number) => void;
const renderers = new Set<Renderer>();
let started = false;
let lastSync = 0;

export function registerRenderer(fn: Renderer): () => void {
  renderers.add(fn);
  start();
  return () => renderers.delete(fn);
}

function frame(now: number): void {
  const st = useStore.getState();
  const data = sim.data;
  const dtWall = clock.lastWall ? Math.min(100, now - clock.lastWall) : 0;
  clock.lastWall = now;
  if (data && st.playing && st.ready) {
    const limit = data.tEnd;
    if (clock.t < limit) clock.t = Math.min(limit, clock.t + dtWall * st.speed);
  }
  if (data) {
    sim.ensureAhead(clock.t);
    data.trim(clock.t);
  }
  for (const r of renderers) {
    try {
      r(clock.t);
    } catch (e) {
      console.error(e);
    }
  }
  if (now - lastSync > 100) {
    lastSync = now;
    if (Math.abs(st.shownTime - clock.t) > 0.5) st.set({ shownTime: clock.t });
  }
  requestAnimationFrame(frame);
}

function start(): void {
  if (started) return;
  started = true;
  requestAnimationFrame(frame);
}

/** Move the display clock (pauses playback). */
export function seek(t: number, pause = true): void {
  const data = sim.data;
  const lo = data ? data.tStart : 0;
  const hi = data ? data.tEnd : 0;
  clock.t = Math.max(lo, Math.min(hi, t));
  const st = useStore.getState();
  st.set({ shownTime: clock.t, ...(pause ? { playing: false } : {}) });
}

/** Resolved theme colours (CSS custom properties), refreshed when the theme changes. */
let tokenCache: Record<string, string> | null = null;
export function tokens(): Record<string, string> {
  if (tokenCache) return tokenCache;
  const cs = getComputedStyle(document.documentElement);
  const names = ["bg", "panel", "panel-2", "line", "fg", "fg-dim", "fg-faint", "accent", "info", "ok", "warn", "bad", "paper", "grid-minor", "grid-major", "trace", "trace-b", "cursor"];
  tokenCache = Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(`--${n}`).trim()]));
  return tokenCache;
}
export function invalidateTokens(): void {
  tokenCache = null;
}
if (typeof window !== "undefined") {
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", invalidateTokens);
  new MutationObserver(invalidateTokens).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

/** Keeps a canvas' backing store matched to its CSS size × devicePixelRatio. */
export function fitCanvas(c: HTMLCanvasElement): { w: number; h: number; dpr: number; resized: boolean } {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(c.clientWidth));
  const h = Math.max(1, Math.round(c.clientHeight));
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  let resized = false;
  if (c.width !== bw || c.height !== bh) {
    c.width = bw;
    c.height = bh;
    resized = true;
  }
  return { w, h, dpr, resized };
}
