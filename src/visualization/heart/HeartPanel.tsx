import { useRef } from "react";
import { useStore } from "../../state/store";
import { HeartLegend, HeartView } from "./HeartView";
import type { HeartLayers, HeartScene, ViewPreset } from "./HeartScene";

const LAYER_BUTTONS: [keyof HeartLayers, string, string][] = [
  ["anatomy", "Anatomy", "Chamber colouring"],
  ["pathways", "Conduction", "Major conduction pathways (SA, AV, His, bundles, fascicles, main Purkinje branches)"],
  ["activation", "Activation", "Depolarisation wavefront and depolarised tissue"],
  ["repolarization", "Repolarisation", "Tissue in phase 3"],
  ["refractory", "Refractory", "Absolutely / relatively refractory tissue (replaces activation colours)"],
  ["vectors", "Vector", "Instantaneous heart (dipole) vector and its loop"],
  ["labels", "Labels", "Structure labels"],
  ["atria", "Atria", "Show atria"],
  ["ventricles", "Ventricles", "Show ventricles"],
  ["mesh", "Tissue mesh", "Advanced: simulation cells and the full Purkinje network"],
];

export function HeartToolbar({ scene }: { scene: React.MutableRefObject<HeartScene | null> }) {
  const L = useStore((s) => s.heartLayers);
  const opacity = useStore((s) => s.heartOpacity);
  const disp = useStore((s) => s.activationDisplay);
  const set = useStore((s) => s.set);
  const views: [ViewPreset, string][] = [
    ["anterior", "Anterior"],
    ["posterior", "Posterior"],
    ["left", "Left lat."],
    ["superior", "Superior"],
  ];
  return (
    <div className="heart-tools">
      <div className="chips" role="group" aria-label="Visualisation layers">
        {LAYER_BUTTONS.map(([k, label, title]) => (
          <button key={k} className={`chip ${L[k] ? "on" : ""}`} aria-pressed={L[k]} title={title} onClick={() => set({ heartLayers: { ...L, [k]: !L[k] } })} data-layer={k}>
            {label}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="View preset">
          {views.map(([v, l]) => (
            <button key={v} onClick={() => scene.current?.setView(v)}>
              {l}
            </button>
          ))}
        </div>
        <select value={disp} onChange={(e) => set({ activationDisplay: e.target.value as "live" | "isochrones" })} aria-label="Activation display" id="act-display">
          <option value="live">Live wavefront</option>
          <option value="isochrones">Isochrone map (current beat)</option>
        </select>
        <label htmlFor="heart-opacity" title="Tissue opacity (lower values reveal the conduction system)">
          Tissue
          <input id="heart-opacity" type="range" min={0.15} max={1} step={0.01} value={opacity} onChange={(e) => set({ heartOpacity: +e.target.value })} style={{ width: 80 }} />
        </label>
      </div>
    </div>
  );
}

export function HeartPanelBody() {
  const sceneRef = useRef<HeartScene | null>(null);
  const sel = useStore((s) => s.customLabel);
  const node = useStore((s) => s.customNode);
  return (
    <div className="heart-panel">
      <HeartToolbar scene={sceneRef} />
      <div className="heart-stage">
        <HeartView onScene={(s) => (sceneRef.current = s)} />
        <HeartLegend />
        {node !== null && (
          <div className="heart-selection" role="status">
            Selected: <b>{sel}</b> · its action potential is shown in Panel B
          </div>
        )}
        <EventNote />
        <div className="heart-hint">drag rotate · right-drag pan · wheel zoom · click a structure</div>
      </div>
    </div>
  );
}

/** Explanation of the clicked timeline event (structure highlighted in the 3-D view). */
export function EventNote() {
  const hl = useStore((s) => s.highlight);
  const set = useStore((s) => s.set);
  if (!hl) return null;
  return (
    <div className="event-note" role="status" data-testid="event-note">
      <button className="linkbtn" style={{ float: "right" }} onClick={() => set({ highlight: null })} aria-label="Clear highlight">
        ✕
      </button>
      {hl.label}
    </div>
  );
}
