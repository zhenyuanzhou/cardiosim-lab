/**
 * Panel A — anatomical heart with selectable layers (React wrapper around HeartScene).
 */
import { useEffect, useRef } from "react";
import { sim, useStore } from "../../state/store";
import { registerRenderer } from "../frameLoop";
import { HeartScene, LAYER_COLORS, type SceneSource, type ViewPreset } from "./HeartScene";

export interface HeartViewHandle {
  scene: HeartScene | null;
}

/**
 * @param source optional data source (A/B view); defaults to the live simulation
 * @param preset initial camera preset
 */
export function HeartView({
  source,
  preset = "anterior",
  onScene,
  showVectors,
}: {
  source?: () => SceneSource | null;
  preset?: ViewPreset;
  onScene?: (s: HeartScene | null) => void;
  showVectors?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current!;
    const scene = new HeartScene(el);
    let modelSet = false;
    const tryModel = () => {
      if (!modelSet && sim.meta) {
        scene.setModel(sim.meta, sim.surfaces);
        scene.setView(preset);
        modelSet = true;
      } else if (modelSet && sim.surfaces) scene.setSurfaces(sim.surfaces);
    };
    tryModel();
    const off = sim.on((e) => {
      if (e.type === "ready" || e.type === "surfaces") tryModel();
    });
    scene.onSelect = (sel) => useStore.getState().set({ customNode: sel.node, customLabel: sel.label });
    onScene?.(scene);
    const live = (): SceneSource | null => (sim.meta && sim.data ? { meta: sim.meta, data: sim.data, params: useStore.getState().params } : null);
    const unreg = registerRenderer((t) => {
      if (!modelSet) tryModel();
      const st = useStore.getState();
      scene.layers = showVectors !== undefined ? { ...st.heartLayers, vectors: showVectors || st.heartLayers.vectors } : st.heartLayers;
      scene.opacity = st.heartOpacity;
      scene.activationDisplay = st.activationDisplay;
      scene.highlight = st.highlight;
      scene.update(t, (source ?? live)());
    });
    return () => {
      unreg();
      off();
      onScene?.(null);
      scene.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={host} className="scene-host" data-testid="heart-canvas" aria-label="3-D anatomical heart with activation overlay" />;
}

const rgb = (c: number[]) => `rgb(${c.map((x) => Math.round(x * 255)).join(",")})`;

/** Compact legend describing the colours of the active layers. */
export function HeartLegend() {
  const L = useStore((s) => s.heartLayers);
  const mode = useStore((s) => s.activationDisplay);
  const C = LAYER_COLORS;
  const items: [string, string][] = [];
  if (L.activation && mode === "isochrones") items.push(["linear-gradient(90deg,#fde725,#5ec962,#21918c,#440154)", "activation time: early → late (10 ms bands)"]);
  else {
    if (L.refractory) {
      items.push([rgb(C.absRef), "absolutely refractory (< ERP)"], [rgb(C.relRef), "relatively refractory"]);
    } else {
      if (L.activation) items.push([rgb(C.front), "wavefront"], [rgb(C.depol), "depolarised"]);
      if (L.repolarization) items.push([rgb(C.repol), "repolarising (phase 3)"]);
    }
  }
  if (L.pathways) items.push([rgb(C.pathLive), "impulse in conduction system"]);
  if (L.vectors) items.push(["#35d0ff", "heart vector (dipole)"]);
  return (
    <div className="heart-legend">
      {items.map(([c, l]) => (
        <span key={l}>
          <i style={{ background: c }} />
          {l}
        </span>
      ))}
    </div>
  );
}
