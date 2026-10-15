/** Mode 2 — ECG Vector & Lead Explorer. */
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { sim, useStore, type TorsoLayers } from "../../state/store";
import { registerRenderer } from "../frameLoop";
import { TorsoScene } from "./TorsoScene";
import { FrontalPlane, HorizontalPlane } from "./VectorDiagrams";
import { LeadStrips } from "./LeadStrips";
import { LeadInfoCard } from "./LeadInfoCard";
import { EctopyMenu, ExperimentsMenu } from "./ExperimentsMenu";
import { Panel } from "../../components/layout/Panel";
import { Split } from "../../components/layout/Split";
import { LEAD_NAMES } from "../../simulation/ecg-forward/leadField";
import { LEAD_COLORS } from "./leadMath";

export function TorsoView({ compact = false }: { compact?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TorsoScene | null>(null);
  useEffect(() => {
    const scene = new TorsoScene(host.current!);
    sceneRef.current = scene;
    let modelSet = false;
    const tryModel = () => {
      if (!modelSet && sim.meta) {
        scene.setModel(sim.meta, sim.surfaces);
        scene.frameTorso("anterior");
        modelSet = true;
      } else if (modelSet && sim.surfaces) scene.setSurfaces(sim.surfaces);
    };
    tryModel();
    const off = sim.on((e) => {
      if (e.type === "ready" || e.type === "surfaces") tryModel();
    });
    scene.onSelect = (sel) => useStore.getState().set({ customNode: sel.node, customLabel: sel.label });
    const unreg = registerRenderer((t) => {
      if (!modelSet) tryModel();
      const st = useStore.getState();
      scene.layers = { ...st.heartLayers, vectors: true, labels: false };
      scene.opacity = Math.min(st.heartOpacity, 0.75);
      scene.activationDisplay = st.activationDisplay;
      scene.torsoLayers = st.torsoLayers;
      scene.leads = st.explorerLeads;
      scene.highlight = st.highlight;
      scene.update(t, sim.meta && sim.data ? { meta: sim.meta, data: sim.data, params: st.params } : null);
    });
    return () => {
      unreg();
      off();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);
  return (
    <div className="scene-wrap">
      <div ref={host} className="scene-host" data-testid="torso-canvas" aria-label="Torso with electrodes, lead geometry and heart vector" />
      <div className="scene-views">
        {(["anterior", "left", "superior", "oblique"] as const).map((v) => (
          <button key={v} className="btn icon" onClick={() => sceneRef.current?.frameTorso(v)}>
            {v === "anterior" ? "Front" : v === "left" ? "Left" : v === "superior" ? "Top" : "3/4"}
          </button>
        ))}
      </div>
      {!compact && (
        <div className="heart-hint">
          drag rotate · wheel zoom · coloured axis = selected lead (solid = positive half) · green/red bar = projection of the heart vector
        </div>
      )}
    </div>
  );
}

const PRESETS: [string, string[]][] = [
  ["I vs aVF", ["I", "aVF"]],
  ["II vs aVR", ["II", "aVR"]],
  ["V1 vs V6", ["V1", "V6"]],
  ["II, V1, V5", ["II", "V1", "V5"]],
];

export function LeadPicker() {
  const leads = useStore((s) => s.explorerLeads);
  const set = useStore((s) => s.set);
  const toggle = (l: string) => {
    if (leads.includes(l)) set({ explorerLeads: leads.length > 1 ? leads.filter((x) => x !== l) : leads });
    else set({ explorerLeads: [...leads, l].slice(-3) });
  };
  return (
    <div className="lead-picker" role="group" aria-label="Select up to three leads (first = primary)">
      {LEAD_NAMES.map((l) => (
        <button
          key={l}
          className={`chip ${leads.includes(l) ? "on" : ""} ${leads[0] === l ? "primary" : ""}`}
          style={leads.includes(l) ? { borderColor: LEAD_COLORS[l], color: LEAD_COLORS[l] } : undefined}
          onClick={() => toggle(l)}
          onDoubleClick={() => set({ explorerLeads: [l] })}
          title={leads[0] === l ? "Primary lead (projection shown)" : "Click to add/remove · double-click to show only this lead"}
          data-lead={l}
        >
          {l}
        </button>
      ))}
      <span className="sep" />
      {PRESETS.map(([n, ls]) => (
        <button key={n} className="chip" onClick={() => set({ explorerLeads: ls })}>
          {n}
        </button>
      ))}
    </div>
  );
}

export function TorsoLayerChips() {
  const L = useStore((s) => s.torsoLayers);
  const set = useStore((s) => s.set);
  const items: [keyof TorsoLayers, string][] = [
    ["torso", "Torso"],
    ["electrodes", "Electrodes"],
    ["leadAxes", "Lead axes"],
    ["projection", "Projection"],
    ["heart", "Heart"],
    ["sensitivity", "Lead-field proximity"],
  ];
  return (
    <div className="chips">
      {items.map(([k, l]) => (
        <button key={k} className={`chip ${L[k] ? "on" : ""}`} aria-pressed={L[k]} onClick={() => set({ torsoLayers: { ...L, [k]: !L[k] } })} title={k === "sensitivity" ? "Colours the heart by 1/R² distance to the selected chest electrode (infinite-medium lead-field magnitude)" : undefined}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function ExplorerView() {
  const max = useStore((s) => s.maximized);
  const torso = (
    <Panel id="torso" title="Torso, electrodes & lead geometry" fid="heart, sources and lead axes in body coordinates" tools={<TorsoLayerChips />}>
      <TorsoView />
    </Panel>
  );
  const frontal = (
    <Panel id="frontal" title="Frontal plane">
      <FrontalPlane />
    </Panel>
  );
  const horizontal = (
    <Panel id="horizontal" title="Horizontal plane">
      <HorizontalPlane />
    </Panel>
  );
  const strips = (
    <Panel id="strips" title="Selected leads" fid="solid: forward-computed ECG · dashed: dipole estimate L̂·P">
      <LeadStrips />
    </Panel>
  );
  const info = (
    <Panel id="leadinfo" title="What this lead sees now">
      <LeadInfoCard />
    </Panel>
  );
  const byId: Record<string, ReactElement> = { torso, frontal, horizontal, strips, leadinfo: info };
  return (
    <main className="explorer">
      <div className="explorer-bar">
        <LeadPicker />
        <span className="spacer" />
        <EctopyMenu />
        <ExperimentsMenu />
      </div>
      {max && byId[max] ? (
        <div className="grid-max">{byId[max]}</div>
      ) : (
        <div className="explorer-body">
          <Split id="exp-cols" direction="row" initial={[0.47, 0.53]} minPx={300}>
            {torso}
            <Split id="exp-right" direction="column" initial={[0.42, 0.33, 0.25]} minPx={150}>
              <Split id="exp-planes" direction="row" initial={[0.5, 0.5]} minPx={220}>
                {frontal}
                {horizontal}
              </Split>
              {strips}
              {info}
            </Split>
          </Split>
        </div>
      )}
    </main>
  );
}
