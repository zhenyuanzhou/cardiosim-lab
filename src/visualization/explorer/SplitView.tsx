/** Mode 3 — synchronised educational split view. */
import type { ReactElement } from "react";
import { useRef } from "react";
import { useStore } from "../../state/store";
import { HeartLegend, HeartView } from "../heart/HeartView";
import type { HeartScene } from "../heart/HeartScene";
import { TorsoView, LeadPicker } from "./ExplorerView";
import { FrontalPlane } from "./VectorDiagrams";
import { LeadStrips } from "./LeadStrips";
import { LeadInfoCard } from "./LeadInfoCard";
import { APPanel } from "../action-potentials/APPanel";
import { Panel } from "../../components/layout/Panel";
import { Split } from "../../components/layout/Split";
import { EctopyMenu, ExperimentsMenu } from "./ExperimentsMenu";

export function SplitView() {
  const max = useStore((s) => s.maximized);
  const scene = useRef<HeartScene | null>(null);
  const heart = (
    <Panel
      id="s-heart"
      title="Heart & activation"
      tools={
        <div className="seg">
          {(["anterior", "left", "superior"] as const).map((v) => (
            <button key={v} onClick={() => scene.current?.setView(v)}>
              {v === "anterior" ? "Front" : v === "left" ? "Left" : "Top"}
            </button>
          ))}
        </div>
      }
    >
      <div className="heart-stage">
        <HeartView onScene={(s) => (scene.current = s)} showVectors />
        <HeartLegend />
      </div>
    </Panel>
  );
  const torso = (
    <Panel id="s-torso" title="Torso & selected lead">
      <TorsoView compact />
    </Panel>
  );
  const frontal = (
    <Panel id="s-frontal" title="Heart vector (frontal)">
      <FrontalPlane compact />
    </Panel>
  );
  const strips = (
    <Panel id="s-strips" title="ECG">
      <LeadStrips />
    </Panel>
  );
  const aps = (
    <Panel id="s-ap" title="Action potentials">
      <APPanel probeIds={["san", "avn", "lvendo", "lvepi"]} />
    </Panel>
  );
  const info = (
    <Panel id="s-info" title="Current electrical event">
      <LeadInfoCard />
    </Panel>
  );
  const byId: Record<string, ReactElement> = { "s-heart": heart, "s-torso": torso, "s-frontal": frontal, "s-strips": strips, "s-ap": aps, "s-info": info };
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
          <Split id="split-cols" direction="row" initial={[0.34, 0.28, 0.38]} minPx={260}>
            {heart}
            <Split id="split-mid" direction="column" initial={[0.58, 0.42]} minPx={160}>
              {torso}
              {frontal}
            </Split>
            <Split id="split-right" direction="column" initial={[0.34, 0.33, 0.33]} minPx={130}>
              {strips}
              {aps}
              {info}
            </Split>
          </Split>
        </div>
      )}
    </main>
  );
}
