/**
 * Resizable split container (rows or columns) with draggable dividers.
 * Sizes are fractions; they are remembered per `id` in localStorage (best effort).
 */
import { Children, useEffect, useRef, useState, type ReactNode } from "react";

const load = (id: string, n: number, def: number[]): number[] => {
  try {
    const raw = localStorage.getItem(`split:${id}`);
    if (raw) {
      const v = JSON.parse(raw) as number[];
      if (Array.isArray(v) && v.length === n && v.every((x) => x > 0.04)) return v;
    }
  } catch {
    /* storage unavailable */
  }
  return def;
};

export function Split({
  id,
  direction,
  initial,
  children,
  minPx = 160,
  className = "",
}: {
  id: string;
  direction: "row" | "column";
  initial: number[];
  children: ReactNode;
  minPx?: number;
  className?: string;
}) {
  const kids = Children.toArray(children).filter(Boolean);
  const [sizes, setSizes] = useState<number[]>(() => load(id, kids.length, initial));
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; start: number; sizes: number[]; total: number } | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(`split:${id}`, JSON.stringify(sizes));
    } catch {
      /* ignore */
    }
  }, [id, sizes]);
  const onDown = (i: number) => (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { i, start: direction === "row" ? e.clientX : e.clientY, sizes: [...sizes], total: direction === "row" ? r.width : r.height };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const delta = ((direction === "row" ? e.clientX : e.clientY) - d.start) / d.total;
    const sum = d.sizes[d.i] + d.sizes[d.i + 1];
    const min = minPx / d.total;
    const a = Math.max(min, Math.min(sum - min, d.sizes[d.i] + delta));
    const next = [...d.sizes];
    next[d.i] = a;
    next[d.i + 1] = sum - a;
    setSizes(next);
  };
  const onUp = () => {
    drag.current = null;
  };
  const reset = () => setSizes(initial);
  return (
    <div ref={box} className={`split split-${direction} ${className}`} onPointerMove={onMove} onPointerUp={onUp}>
      {kids.map((k, i) => (
        <div key={i} className="split-cell" style={{ flex: `${sizes[i] ?? 1} 1 0` }}>
          {k}
          {i < kids.length - 1 && (
            <div
              className={`split-handle split-handle-${direction}`}
              onPointerDown={onDown(i)}
              onDoubleClick={reset}
              role="separator"
              aria-orientation={direction === "row" ? "vertical" : "horizontal"}
              title="Drag to resize · double-click to reset"
            />
          )}
        </div>
      ))}
    </div>
  );
}
