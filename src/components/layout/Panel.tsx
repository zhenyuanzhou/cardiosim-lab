import type { ReactNode } from "react";
import { useStore } from "../../state/store";

/** Titled panel with an optional maximise button. */
export function Panel({
  id,
  letter,
  title,
  fid,
  tools,
  children,
  className = "",
  label,
}: {
  id: string;
  letter?: string;
  title: string;
  fid?: string;
  tools?: ReactNode;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const maximized = useStore((s) => s.maximized);
  const set = useStore((s) => s.set);
  const isMax = maximized === id;
  return (
    <section className={`panel ${className} ${isMax ? "is-max" : ""}`} aria-label={label ?? title} data-panel={id}>
      <header>
        <h2>
          {letter && <b>{letter}</b>}
          {title}
        </h2>
        {fid && <span className="fid">{fid}</span>}
        <span className="spacer" />
        {tools}
        <button className="btn icon" onClick={() => set({ maximized: isMax ? null : id })} title={isMax ? "Restore layout (Esc)" : "Maximise panel"} aria-label={isMax ? "Restore panel" : "Maximise panel"}>
          {isMax ? "⤡" : "⤢"}
        </button>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
