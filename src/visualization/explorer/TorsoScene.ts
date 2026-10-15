/**
 * Torso scene: the simulated heart inside a translucent torso with the standard 12-lead
 * electrodes, lead geometry and the projection of the heart vector on the selected lead.
 */
import * as THREE from "three";
import { HeartScene, type SceneSource } from "../heart/HeartScene";
import { CHEST } from "../../simulation/ecg-forward/leadField";
import { LEAD_COLORS, PRECORDIAL_POS, isLimb, leadVector } from "./leadMath";
import type { TorsoLayers } from "../../state/store";

/** Displayed electrode sites (mm, model frame). Limb electrodes at wrists / lower legs. */
export const LIMB_SITES: Record<string, [number, number, number]> = {
  RA: [CHEST.midlineX - 228, 250, -30],
  LA: [CHEST.midlineX + 228, 250, -30],
  LL: [CHEST.midlineX + 80, 640, -20],
  RL: [CHEST.midlineX - 80, 640, -20],
};
// AHA colour code for limb electrodes; precordial V1–V6 AHA colours
const ELECTRODE_COLORS: Record<string, number> = {
  RA: 0xf2f2f2,
  LA: 0x222222,
  LL: 0xd93a3a,
  RL: 0x2fa84f,
  V1: 0xd93a3a,
  V2: 0xe8c22e,
  V3: 0x2fa84f,
  V4: 0x3a6fd9,
  V5: 0xe0832c,
  V6: 0x8e4fd9,
};

function ringGeometry(levels: { y: number; hw: number; hd: number; cx?: number; cz?: number }[], seg = 48): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  levels.forEach((L, r) => {
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      pos.push((L.cx ?? CHEST.midlineX) + Math.cos(a) * L.hw, L.y, (L.cz ?? CHEST.centerZ) + Math.sin(a) * L.hd);
    }
    if (r > 0)
      for (let s = 0; s < seg; s++) {
        const a0 = (r - 1) * (seg + 1) + s;
        const b0 = r * (seg + 1) + s;
        idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
      }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function limb(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number): THREE.BufferGeometry {
  const len = from.distanceTo(to);
  const g = new THREE.CylinderGeometry(r1, r0, len, 24, 1, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  g.applyQuaternion(q);
  g.translate(from.x, from.y, from.z);
  return g;
}

export class TorsoScene extends HeartScene {
  protected fitOnResize = false;
  private body = new THREE.Group();
  private electrodes = new THREE.Group();
  private overlay = new THREE.Group();
  private electrodeLabels: { el: HTMLDivElement; pos: THREE.Vector3; name: string }[] = [];
  private torsoLabelLayer: HTMLDivElement;
  torsoLayers: TorsoLayers = { torso: true, electrodes: true, leadAxes: true, projection: true, heart: true, sensitivity: false };
  leads: string[] = ["II"];
  private overlayKey = "";

  constructor(container: HTMLElement) {
    super(container);
    this.torsoLabelLayer = document.createElement("div");
    this.torsoLabelLayer.className = "scene-labels";
    container.appendChild(this.torsoLabelLayer);
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9b8aa, transparent: true, opacity: 0.13, roughness: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const M = CHEST.midlineX;
    const trunk = ringGeometry([
      { y: -262, hw: 70, hd: 50 },
      { y: -250, hw: 125, hd: 78 },
      { y: -222, hw: 178, hd: 96 },
      { y: -160, hw: 168, hd: 106 },
      { y: 0, hw: CHEST.halfWidth, hd: CHEST.halfDepth },
      { y: 110, hw: 150, hd: 100 },
      { y: 215, hw: 136, hd: 92 },
      { y: 330, hw: 160, hd: 100 },
      { y: 360, hw: 150, hd: 92 },
    ]);
    const neck = ringGeometry(
      [
        { y: -340, hw: 50, hd: 50, cz: -50 },
        { y: -255, hw: 58, hd: 55, cz: -48 },
      ],
      32,
    );
    const head = new THREE.SphereGeometry(92, 32, 24);
    head.scale(0.85, 1.12, 1);
    head.translate(M, -432, -40);
    const parts = [trunk, neck, head];
    // arms (shoulder → wrist) and legs (hip → lower leg)
    for (const s of [-1, 1]) {
      parts.push(limb(new THREE.Vector3(M + s * 178, -215, -40), new THREE.Vector3(M + s * 228, 260, -30), 48, 30));
      parts.push(limb(new THREE.Vector3(M + s * 80, 345, -30), new THREE.Vector3(M + s * 80, 660, -20), 70, 48));
    }
    for (const g of parts) {
      const m = new THREE.Mesh(g, skin);
      m.renderOrder = 1;
      this.body.add(m);
    }
    // outline rings at the electrode levels to help depth perception
    const ringMat = new THREE.LineBasicMaterial({ color: 0x9aa5a3, transparent: true, opacity: 0.35 });
    for (const y of [CHEST.ics4Y, CHEST.ics5Y]) {
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= 96; s++) {
        const a = (s / 96) * Math.PI * 2;
        pts.push(new THREE.Vector3(M + Math.cos(a) * CHEST.halfWidth, y, CHEST.centerZ + Math.sin(a) * CHEST.halfDepth));
      }
      this.body.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
    }
    this.world.add(this.body);
    // electrodes
    const sites: Record<string, [number, number, number]> = { ...LIMB_SITES, ...PRECORDIAL_POS };
    for (const [name, p] of Object.entries(sites)) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(name.startsWith("V") ? 7 : 11, 20, 14), new THREE.MeshStandardMaterial({ color: ELECTRODE_COLORS[name], roughness: 0.4, metalness: 0.2 }));
      m.position.set(...p);
      m.userData.electrode = name;
      this.electrodes.add(m);
      const el = document.createElement("div");
      el.className = "scene-label electrode";
      el.textContent = name;
      this.torsoLabelLayer.appendChild(el);
      this.electrodeLabels.push({ el, pos: new THREE.Vector3(...p), name });
    }
    this.world.add(this.electrodes);
    this.world.add(this.overlay);
    this.vectorScale = 60;
  }

  /** Whole-torso framing (overrides the heart-only presets). */
  frameTorso(preset: "anterior" | "left" | "superior" | "oblique" = "anterior"): void {
    const T = [CHEST.midlineX + 25, preset === "anterior" ? 160 : 30, -20] as const;
    this.controls.target.copy(this.toWorld(T[0], T[1], T[2]));
    const d = preset === "anterior" ? 1750 : 1350;
    const at = (dx: number, dy: number, dz: number) => this.camera.position.copy(this.toWorld(T[0] + dx, T[1] + dy, T[2] + dz));
    if (preset === "anterior") {
      this.camera.up.set(0, -1, 0);
      at(0, 0, d);
    } else if (preset === "left") {
      this.camera.up.set(0, -1, 0);
      at(d, 0, 0);
    } else if (preset === "superior") {
      this.camera.up.set(0, 0, 1);
      at(0, -d, 0);
    } else {
      this.camera.up.set(0, -1, 0);
      at(d * 0.55, -d * 0.25, d * 0.8);
    }
    this.controls.update();
  }

  update(t: number, src: SceneSource | null): void {
    const L = this.torsoLayers;
    this.body.visible = L.torso;
    this.electrodes.visible = L.electrodes;
    this.root.visible = L.heart;
    this.sensitivityElectrode = L.sensitivity && this.leads[0] && !isLimb(this.leads[0]) ? PRECORDIAL_POS[this.leads[0]] : null;
    if (src) this.updateOverlay(t, src);
    super.update(t, src);
    // electrode labels
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const v = new THREE.Vector3();
    for (const l of this.electrodeLabels) {
      if (!L.electrodes) {
        l.el.style.display = "none";
        continue;
      }
      v.copy(l.pos).applyMatrix4(this.world.matrixWorld).project(this.camera);
      l.el.style.display = v.z > 1 ? "none" : "block";
      l.el.classList.toggle("on", this.leads.some((x) => x === l.name || leadUses(x, l.name)));
      l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -150%)`;
    }
  }

  private updateOverlay(t: number, src: SceneSource): void {
    const L = this.torsoLayers;
    const key = `${t.toFixed(1)}|${src.data.version}|${this.leads.join()}|${L.leadAxes}|${L.projection}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    for (const c of [...this.overlay.children]) {
      this.overlay.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    if (!L.leadAxes) return;
    const P = new THREE.Vector3(src.data.at(t, 12), src.data.at(t, 13), src.data.at(t, 14));
    const S = this.vectorScale;
    this.leads.forEach((lead, k) => {
      const color = new THREE.Color(LEAD_COLORS[lead] ?? "#ffffff");
      const fit = leadVector(lead, src.data);
      const u = new THREE.Vector3(...fit.vec).normalize();
      const len = 240;
      const solid = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: k === 0 ? 1 : 0.7 });
      const dashed = new THREE.LineDashedMaterial({ color, dashSize: 10, gapSize: 7, depthTest: false, transparent: true, opacity: 0.8 });
      // lead axis through the heart centre: positive half solid, negative half dashed
      const pos = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), u.clone().multiplyScalar(len)]), solid);
      const neg = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), u.clone().multiplyScalar(-len * 0.6)]), dashed);
      neg.computeLineDistances();
      pos.renderOrder = neg.renderOrder = 20;
      this.overlay.add(pos, neg);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(7, 18, 16), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }));
      tip.position.copy(u.clone().multiplyScalar(len));
      tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), u);
      tip.renderOrder = 20;
      this.overlay.add(tip);
      // electrode wiring: which electrodes form the lead
      const wires = leadWires(lead);
      for (const [a, b] of wires) {
        const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
        const line = new THREE.Line(g, dashed);
        line.computeLineDistances();
        line.renderOrder = 19;
        this.overlay.add(line);
      }
      // projection of the heart vector on the primary lead
      if (k === 0 && L.projection) {
        const proj = P.dot(u);
        const foot = u.clone().multiplyScalar(proj * S);
        const tipP = P.clone().multiplyScalar(S);
        const c = new THREE.Color(proj >= 0 ? "#4fd17a" : "#ff5a5a");
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(3.2, 3.2, Math.max(0.1, Math.abs(proj * S)), 10),
          new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.85 }),
        );
        seg.position.copy(foot.clone().multiplyScalar(0.5));
        seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), foot.length() > 1e-6 ? foot.clone().normalize() : u);
        seg.renderOrder = 21;
        const perp = new THREE.Line(new THREE.BufferGeometry().setFromPoints([tipP, foot]), new THREE.LineDashedMaterial({ color: 0xcfd8dc, dashSize: 4, gapSize: 4, depthTest: false, transparent: true }));
        perp.computeLineDistances();
        perp.renderOrder = 21;
        this.overlay.add(seg, perp);
      }
    });
  }

  dispose(): void {
    this.torsoLabelLayer.remove();
    super.dispose();
  }
}

/** Electrode pairs drawn for a lead (bipolar pair, or electrode → its reference). */
function leadWires(lead: string): [[number, number, number], [number, number, number]][] {
  const S = LIMB_SITES;
  const mid = (a: number[], b: number[]): [number, number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  switch (lead) {
    case "I":
      return [[S.RA, S.LA]];
    case "II":
      return [[S.RA, S.LL]];
    case "III":
      return [[S.LA, S.LL]];
    case "aVR":
      return [[S.RA, mid(S.LA, S.LL)]];
    case "aVL":
      return [[S.LA, mid(S.RA, S.LL)]];
    case "aVF":
      return [[S.LL, mid(S.RA, S.LA)]];
    default: {
      // chest electrode → Wilson central terminal (average of RA, LA, LL), drawn to the heart centre
      const e = PRECORDIAL_POS[lead];
      return e ? [[e, [0, 0, 0]]] : [];
    }
  }
}

function leadUses(lead: string, electrode: string): boolean {
  const map: Record<string, string[]> = { I: ["RA", "LA"], II: ["RA", "LL"], III: ["LA", "LL"], aVR: ["RA", "LA", "LL"], aVL: ["RA", "LA", "LL"], aVF: ["RA", "LA", "LL"] };
  return (map[lead] ?? []).includes(electrode) || (lead.startsWith("V") && ["RA", "LA", "LL"].includes(electrode));
}
