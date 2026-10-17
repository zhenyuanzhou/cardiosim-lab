/**
 * Three.js anatomical heart scene shared by the activation view, the lead explorer
 * (inside the torso) and the A/B side-by-side view.
 *
 * Visual layers (all driven by the same simulation records that produce the ECG):
 *   anatomy · major conduction pathways · electrical activation · repolarisation ·
 *   refractory tissue · electrical (heart) vector · detailed tissue mesh (advanced).
 * Surfaces are smooth meshes derived from the analytic anatomy; each vertex colour is an
 * inverse-distance blend of the 4 nearest simulation cells.
 */
import * as THREE from "three";
import { substrateMasks } from "../../simulation/core/derive";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CT, RG, REGION_NAMES } from "../../simulation/core/model";
import { shapesFor, repolMidpoint } from "../../simulation/cellular/actionPotential";
import { apModsFor } from "../apMods";
import type { ModelMeta } from "../../simulation/worker/protocol";
import type { SurfaceMesh } from "../../simulation/tissue/surfaces";
import type { SimData } from "../../simulation/worker/client";
import type { SimParams } from "../../simulation/core/params";

export interface HeartLayers {
  anatomy: boolean;
  pathways: boolean;
  activation: boolean;
  repolarization: boolean;
  refractory: boolean;
  vectors: boolean;
  mesh: boolean;
  labels: boolean;
  atria: boolean;
  ventricles: boolean;
}
export type ActivationDisplay = "live" | "isochrones";
export type ViewPreset = "anterior" | "posterior" | "left" | "superior" | "inferior" | "right";

export interface Highlight {
  nodes: number[];
  label: string;
}

export interface SceneSource {
  meta: ModelMeta;
  data: SimData;
  params: SimParams;
}

type RGB = [number, number, number];
const C = {
  lv: [0.62, 0.45, 0.41] as RGB,
  rv: [0.68, 0.52, 0.46] as RGB,
  septum: [0.6, 0.43, 0.4] as RGB,
  ra: [0.52, 0.53, 0.66] as RGB,
  la: [0.47, 0.47, 0.62] as RGB,
  neutral: [0.55, 0.55, 0.57] as RGB,
  front: [1.0, 0.97, 0.78] as RGB,
  depol: [1.0, 0.45, 0.1] as RGB,
  repol: [0.2, 0.76, 0.82] as RGB,
  absRef: [0.91, 0.22, 0.31] as RGB,
  relRef: [1.0, 0.82, 0.25] as RGB,
  pathIdle: [0.86, 0.84, 0.74] as RGB,
  pathLive: [1, 1, 1] as RGB,
  pathDep: [1.0, 0.66, 0.2] as RGB,
  highlight: [0.2, 0.95, 1.0] as RGB,
  /** Non-conducting tissue of an active substrate (valve annulus, caval orifices, block line, scar). */
  scar: [0.32, 0.32, 0.34] as RGB,
  ischaemia: [0.42, 0.3, 0.62] as RGB,
};
export const LAYER_COLORS = C;
const AT_STOPS: [number, RGB][] = [
  [0, [0.99, 0.91, 0.15]],
  [0.33, [0.37, 0.79, 0.38]],
  [0.66, [0.13, 0.57, 0.55]],
  [1, [0.27, 0.0, 0.33]],
];
export function atColor(x: number): RGB {
  if (x <= 0) return AT_STOPS[0][1];
  for (let i = 1; i < AT_STOPS.length; i++)
    if (x <= AT_STOPS[i][0]) {
      const [x0, a] = AT_STOPS[i - 1];
      const [x1, b] = AT_STOPS[i];
      const u = (x - x0) / (x1 - x0);
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    }
  return AT_STOPS[AT_STOPS.length - 1][1];
}
const mix = (a: RGB, b: RGB, t: number, out: RGB): RGB => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
};

const baseColor = (region: number, anatomy: boolean): RGB => {
  if (!anatomy) return C.neutral;
  switch (region) {
    case RG.LV:
      return C.lv;
    case RG.RV:
      return C.rv;
    case RG.SEPTUM:
      return C.septum;
    case RG.LA:
      return C.la;
    default:
      return C.ra;
  }
};

/** Names of the major conduction structures, keyed by region. */
const PATH_NAMES: Record<number, string> = {
  [RG.HIS]: "His bundle",
  [RG.LBB]: "Left bundle branch",
  [RG.RBB]: "Right bundle branch",
  [RG.LAF]: "Left anterior fascicle",
  [RG.LPF]: "Left posterior fascicle",
  [RG.LSF]: "Left septal fibres",
  [RG.PURK_LV]: "LV Purkinje network",
  [RG.PURK_RV]: "RV Purkinje network",
};

interface PathMesh {
  mesh: THREE.Mesh;
  nodes: number[]; // node per ring
  rings: number;
  ringVerts: number;
  region: number;
  major: boolean;
}

export class HeartScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly root = new THREE.Group(); // heart content (moved as a unit inside the torso view)
  /**
   * The model frame (x → patient's left, y → inferior, z → anterior) is LEFT-handed, whereas
   * three.js renders a right-handed space. Everything anatomical lives under this mirror group
   * (x → −x) so that an anterior view shows the patient's left on the viewer's right.
   */
  readonly world = new THREE.Group();
  /** Model coordinates → three.js world coordinates. */
  protected toWorld(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(-x, y, z);
  }
  private surfaces: { mesh: THREE.Mesh; src: SurfaceMesh; colors: Float32Array }[] = [];
  private paths: PathMesh[] = [];
  private nodeSpheres: { mesh: THREE.Mesh; node: number; name: string }[] = [];
  private points: THREE.Points | null = null;
  private arrow: THREE.Group;
  private arrowShaft: THREE.Mesh;
  private arrowHead: THREE.Mesh;
  private loop: THREE.Line;
  private loopPositions = new Float32Array(3 * 1200);
  private loopColors = new Float32Array(3 * 1200);
  private nodeColor: Float32Array = new Float32Array(0);
  private labelEls: { el: HTMLDivElement; pos: THREE.Vector3; layer: "chamber" | "path" | "vessel" }[] = [];
  /** Great vessels: anatomical context only (not part of the electrical model). */
  readonly vessels = new THREE.Group();
  private radius = 90;
  private subKey = "";
  private blockedMask: Uint8Array | null = null;
  private lastPreset: ViewPreset = "anterior";
  private userMoved = false;
  private labelLayer: HTMLDivElement;
  private lastKey = "";
  private disposed = false;
  meta: ModelMeta | null = null;
  layers: HeartLayers = {
    anatomy: true,
    pathways: true,
    activation: true,
    repolarization: true,
    refractory: false,
    vectors: false,
    mesh: false,
    labels: true,
    atria: true,
    ventricles: true,
  };
  opacity = 0.62;
  activationDisplay: ActivationDisplay = "live";
  highlight: Highlight | null = null;
  vectorScale = 26; // mm per mV-equivalent
  /** When set, surfaces show the chest-electrode proximity sensitivity (1/R²) instead of activity. */
  sensitivityElectrode: [number, number, number] | null = null;
  onSelect: ((sel: { node: number; label: string }) => void) | null = null;
  private center = new THREE.Vector3();

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    container.appendChild(this.renderer.domElement);
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "scene-labels";
    container.appendChild(this.labelLayer);
    this.camera = new THREE.PerspectiveCamera(30, 1, 5, 5000);
    this.camera.up.set(0, -1, 0); // y points to the feet: screen-up is superior
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 80;
    this.controls.maxDistance = 1800;
    this.controls.addEventListener("start", () => (this.userMoved = true));
    this.world.scale.set(-1, 1, 1);
    this.world.add(this.root);
    this.scene.add(this.world);
    this.root.add(this.vessels);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.3, -0.6, 1);
    this.camera.add(key);
    this.scene.add(this.camera);
    // electrical vector arrow + loop
    this.arrow = new THREE.Group();
    const vecMat = new THREE.MeshStandardMaterial({ color: 0x35d0ff, emissive: 0x0b4a66, roughness: 0.4, depthTest: false, transparent: true });
    this.arrowShaft = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1, 12), vecMat);
    this.arrowHead = new THREE.Mesh(new THREE.ConeGeometry(4.2, 10, 16), vecMat);
    this.arrow.add(this.arrowShaft, this.arrowHead);
    this.arrow.renderOrder = 10;
    this.arrowShaft.renderOrder = 10;
    this.arrowHead.renderOrder = 10;
    this.root.add(this.arrow);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(this.loopPositions, 3));
    lg.setAttribute("color", new THREE.BufferAttribute(this.loopColors, 3));
    lg.setDrawRange(0, 0);
    this.loop = new THREE.Line(lg, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, linewidth: 2 }));
    this.loop.renderOrder = 9;
    this.root.add(this.loop);
    this.renderer.domElement.addEventListener("pointerdown", this.onDown);
    this.renderer.domElement.addEventListener("pointerup", this.onUp);
  }

  // ---- construction ------------------------------------------------------------------
  setModel(meta: ModelMeta, surfaces: SurfaceMesh[] | null): void {
    this.meta = meta;
    this.nodeColor = new Float32Array(meta.n * 3);
    // centre of the whole heart
    const box = new THREE.Box3();
    for (let i = 0; i < meta.n; i += 7) box.expandByPoint(new THREE.Vector3(meta.pos[3 * i], meta.pos[3 * i + 1], meta.pos[3 * i + 2]));
    box.getCenter(this.center);
    this.radius = box.getBoundingSphere(new THREE.Sphere()).radius + 18;
    this.controls.target.copy(this.toWorld(this.center.x, this.center.y, this.center.z));
    this.setView("anterior");
    if (surfaces) this.setSurfaces(surfaces);
    this.buildPaths(meta);
    this.buildPoints(meta);
    this.buildLabels(meta);
    this.buildVessels(meta);
  }

  setSurfaces(surfaces: SurfaceMesh[]): void {
    for (const s of this.surfaces) {
      this.root.remove(s.mesh);
      s.mesh.geometry.dispose();
    }
    this.surfaces = [];
    for (const src of surfaces) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(src.positions, 3));
      g.setIndex(new THREE.BufferAttribute(src.indices, 1));
      g.computeVertexNormals();
      const colors = new Float32Array(src.positions.length);
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.62,
        metalness: 0.0,
        transparent: true,
        opacity: this.opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = src.name === "atria" ? 2 : 3;
      mesh.userData.kind = "surface";
      this.root.add(mesh);
      this.surfaces.push({ mesh, src, colors });
    }
    this.lastKey = "";
  }

  private buildPaths(meta: ModelMeta): void {
    // children & subtree sizes for Purkinje trees (to keep only major branches)
    const kids = new Map<number, number[]>();
    for (const p of meta.conductionPaths)
      if (p.region === RG.PURK_LV || p.region === RG.PURK_RV) {
        const [a, b] = p.nodes;
        kids.set(a, [...(kids.get(a) ?? []), b]);
      }
    const size = new Map<number, number>();
    const sub = (n: number): number => {
      const c = size.get(n);
      if (c !== undefined) return c;
      let s = 1;
      for (const k of kids.get(n) ?? []) s += sub(k);
      size.set(n, s);
      return s;
    };
    const P = meta.pos;
    const v = (i: number) => new THREE.Vector3(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
    for (const p of meta.conductionPaths) {
      const isNet = p.region === RG.PURK_LV || p.region === RG.PURK_RV;
      const major = !isNet || sub(p.nodes[1]) >= 10;
      const pts = p.nodes.map(v);
      if (pts.length < 2) continue;
      const curve = pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, "centripetal") : new THREE.LineCurve3(pts[0], pts[1]);
      const radius = isNet ? 0.55 : p.region === RG.HIS ? 1.5 : p.region === RG.LBB || p.region === RG.RBB ? 1.2 : 0.95;
      const radial = isNet ? 5 : 8;
      const segs = pts.length - 1;
      const g = new THREE.TubeGeometry(curve as THREE.Curve<THREE.Vector3>, segs, radius, radial, false);
      const colors = new Float32Array(g.attributes.position.count * 3);
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, emissive: 0x222018, depthTest: true });
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = 5;
      mesh.userData.kind = "path";
      mesh.userData.region = p.region;
      mesh.userData.node = p.nodes[Math.floor(p.nodes.length / 2)];
      this.root.add(mesh);
      this.paths.push({ mesh, nodes: p.nodes, rings: segs + 1, ringVerts: radial + 1, region: p.region, major });
    }
    const sphereGeo = new THREE.SphereGeometry(3.4, 20, 14);
    for (const [node, name] of [
      [meta.san, "SA node"],
      [meta.avn, "AV node"],
    ] as [number, string][]) {
      const m = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({ color: 0xdcd6bf, emissive: 0x111111, roughness: 0.3 }));
      m.position.copy(v(node));
      m.renderOrder = 6;
      m.userData.kind = "node";
      m.userData.node = node;
      m.userData.name = name;
      this.root.add(m);
      this.nodeSpheres.push({ mesh: m, node, name });
    }
  }

  private buildPoints(meta: ModelMeta): void {
    const idx: number[] = [];
    for (let i = 0; i < meta.n; i++) if (meta.cellType[i] === CT.ATRIAL || meta.cellType[i] === CT.VENTRICULAR) idx.push(i);
    const pos = new Float32Array(idx.length * 3);
    idx.forEach((n, k) => pos.set(meta.pos.subarray(3 * n, 3 * n + 3), 3 * k));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(idx.length * 3), 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.9, vertexColors: true, sizeAttenuation: true }));
    this.points.userData.idx = idx;
    this.points.visible = false;
    this.root.add(this.points);
  }

  private buildLabels(meta: ModelMeta): void {
    for (const l of this.labelEls) l.el.remove();
    this.labelEls = [];
    const acc = new Map<string, number[]>();
    const lab = (rg: number) => (rg === RG.RA || rg === RG.CRISTA ? "RA" : rg === RG.LA ? "LA" : rg === RG.RV ? "RV" : rg === RG.LV ? "LV" : null);
    for (let i = 0; i < meta.n; i++) {
      const k = lab(meta.region[i]);
      if (!k) continue;
      const a = acc.get(k) ?? [0, 0, 0, 0];
      a[0] += meta.pos[3 * i];
      a[1] += meta.pos[3 * i + 1];
      a[2] += meta.pos[3 * i + 2];
      a[3]++;
      acc.set(k, a);
    }
    const add = (text: string, p: THREE.Vector3, layer: "chamber" | "path") => {
      const el = document.createElement("div");
      el.className = `scene-label ${layer}`;
      el.textContent = text;
      this.labelLayer.appendChild(el);
      this.labelEls.push({ el, pos: p, layer });
    };
    for (const [k, a] of acc) add(k, new THREE.Vector3(a[0] / a[3], a[1] / a[3], a[2] / a[3]), "chamber");
    const P = meta.pos;
    const at = (i: number) => new THREE.Vector3(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
    add("SA", at(meta.san), "path");
    add("AV", at(meta.avn), "path");
    add("His", at(meta.hisDistal), "path");
    const short: Record<number, string> = { [RG.RBB]: "RBB", [RG.LBB]: "LBB", [RG.LAF]: "LAF", [RG.LPF]: "LPF" };
    for (const p of meta.conductionPaths) {
      const s = short[p.region];
      if (!s) continue;
      add(s, at(p.nodes[Math.floor(p.nodes.length * (p.region === RG.LBB ? 0.9 : 0.6))]), "path");
    }
  }

  // ---- view ----------------------------------------------------------------------------
  setView(preset: ViewPreset, distance?: number): void {
    const c = this.center;
    this.lastPreset = preset;
    this.userMoved = false;
    const aspect = Math.max(0.3, this.camera.aspect || 1);
    const vf = (this.camera.fov * Math.PI) / 360;
    const hf = Math.atan(Math.tan(vf) * aspect);
    const d = distance ?? (this.radius / Math.sin(Math.min(vf, hf))) * 0.88;
    const dirs: Record<ViewPreset, [number, number, number, [number, number, number]]> = {
      anterior: [0, 0, 1, [0, -1, 0]],
      posterior: [0, 0, -1, [0, -1, 0]],
      left: [1, 0, 0, [0, -1, 0]],
      right: [-1, 0, 0, [0, -1, 0]],
      superior: [0, -1, 0, [0, 0, 1]],
      inferior: [0, 1, 0, [0, 0, 1]],
    };
    const [x, y, z, up] = dirs[preset];
    this.camera.up.set(...up);
    this.camera.position.copy(this.toWorld(c.x + x * d, c.y + y * d, c.z + z * d));
    this.controls.target.copy(this.toWorld(c.x, c.y, c.z));
    this.controls.update();
    this.lastKey = "";
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    const cur = this.renderer.getSize(new THREE.Vector2());
    if (cur.x !== w || cur.y !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      if (!this.userMoved && this.meta && this.fitOnResize) this.setView(this.lastPreset);
    }
  }
  /** Re-fit the camera when the panel is resized (until the user moves the camera). */
  protected fitOnResize = true;

  /**
   * Great vessels drawn for anatomical orientation only (aorta, pulmonary trunk, venae cavae,
   * pulmonary veins). They are geometric context and carry no electrical activity.
   */
  private buildVessels(meta: ModelMeta): void {
    for (const c of [...this.vessels.children]) {
      this.vessels.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    const P = meta.pos;
    const mean = (pred: (i: number) => boolean) => {
      const a = new THREE.Vector3();
      let k = 0;
      for (let i = 0; i < meta.n; i++)
        if (pred(i)) {
          a.x += P[3 * i];
          a.y += P[3 * i + 1];
          a.z += P[3 * i + 2];
          k++;
        }
      return k ? a.multiplyScalar(1 / k) : a;
    };
    const R = meta.region;
    const raC = mean((i) => R[i] === RG.RA);
    const laC = mean((i) => R[i] === RG.LA);
    const lvBase = mean((i) => (R[i] === RG.LV || R[i] === RG.SEPTUM) && meta.apicobasal[i] < 0.08);
    let rvot = new THREE.Vector3();
    let best = -Infinity;
    for (let i = 0; i < meta.n; i++)
      if (R[i] === RG.RV && meta.apicobasal[i] < 0.15) {
        const sc = P[3 * i + 2] - P[3 * i + 1] + 0.5 * P[3 * i];
        if (sc > best) {
          best = sc;
          rvot = new THREE.Vector3(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
        }
      }
    const v = (b: THREE.Vector3, x: number, y: number, z: number) => new THREE.Vector3(b.x + x, b.y + y, b.z + z);
    const tube = (pts: THREE.Vector3[], r: number, color: number, label?: string, labelAt = 0.75) => {
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 48, r, 16, false);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0, transparent: true, opacity: 0.88 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.vessel = label;
      this.vessels.add(mesh);
      if (label) this.addLabel(label, curve.getPoint(labelAt), "vessel");
    };
    const ao0 = v(lvBase.clone().lerp(raC, 0.25), 0, -6, 6);
    tube([ao0, v(ao0, -6, -28, 6), v(ao0, 2, -52, -4), v(ao0, 22, -56, -26), v(ao0, 30, -38, -44), v(ao0, 30, 0, -50), v(ao0, 30, 50, -52)], 11, 0xb4524a, "Ao", 0.3);
    const pa0 = v(rvot, 0, -2, 0);
    const bif = v(pa0, 12, -34, -18);
    tube([pa0, v(pa0, 6, -18, -6), bif], 10.5, 0x5b74b0, "PA", 0.45);
    tube([bif, v(bif, 18, -2, -10), v(bif, 34, 4, -16)], 7, 0x5b74b0);
    tube([bif, v(bif, -20, 6, -6), v(bif, -48, 10, -10)], 7, 0x5b74b0);
    tube([v(raC, -4, -18, -2), v(raC, -6, -45, -4), v(raC, -6, -75, -4)], 8.5, 0x4c5f8f, "SVC", 0.8);
    tube([v(raC, -2, 16, -10), v(raC, 0, 45, -16), v(raC, 0, 80, -18)], 10, 0x4c5f8f, "IVC", 0.75);
    for (const [dx, dy] of [[14, -8], [14, 8], [-12, -8], [-12, 8]]) {
      const s0 = v(laC, dx * 0.6, dy, -16);
      tube([s0, v(s0, Math.sign(dx) * 14, dy * 0.3, -10), v(s0, Math.sign(dx) * 30, dy * 0.4, -12)], 4.5, 0xa8584f, dx > 0 && dy < 0 ? "PV" : undefined, 0.9);
    }
  }

  private addLabel(text: string, p: THREE.Vector3, layer: "chamber" | "path" | "vessel"): void {
    const el = document.createElement("div");
    el.className = `scene-label ${layer}`;
    el.textContent = text;
    this.labelLayer.appendChild(el);
    this.labelEls.push({ el, pos: p, layer });
  }

  // ---- per-frame update ------------------------------------------------------------------
  update(t: number, src: SceneSource | null): void {
    if (this.disposed) return;
    this.resize();
    this.controls.update();
    this.vessels.visible = this.layers.anatomy;
    if (src && this.meta) {
      const L = this.layers;
      const key = `${t.toFixed(2)}|${src.data.version}|${JSON.stringify(L)}|${this.opacity}|${this.activationDisplay}|${this.highlight?.label ?? ""}|${this.sensitivityElectrode?.join() ?? ""}`;
      if (key !== this.lastKey) {
        this.lastKey = key;
        this.computeNodeColors(t, src);
        this.applyColors();
        this.updateVector(t, src);
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  }

  private computeNodeColors(t: number, src: SceneSource): void {
    const { meta, data, params } = src;
    const L = this.layers;
    const out = this.nodeColor;
    const tmp: RGB = [0, 0, 0];
    let wave: { id: number; tA: number; tV: number } | null = null;
    if (L.activation && this.activationDisplay === "isochrones") {
      for (const wv of data.wavesSorted())
        if (wv.t0 <= t) wave = { id: wv.id, tA: Number.isFinite(wv.tFirstAtrial) ? wv.tFirstAtrial : wv.t0, tV: Number.isFinite(wv.tFirstVent) ? wv.tFirstVent : wv.t0 };
    }
    const hl = this.highlight ? new Set(this.highlight.nodes) : null;
    const subKey = `${params.atria.flutterSubstrate}|${params.ventricles.scar}`;
    if (subKey !== this.subKey) {
      this.subKey = subKey;
      this.blockedMask = params.atria.flutterSubstrate || params.ventricles.scar ? substrateMasks(meta, params).blocked : null;
    }
    const blocked = this.blockedMask;
    const isch = apModsFor(meta, params).field;
    const ischTmp: RGB = [0, 0, 0];
    for (let i = 0; i < meta.n; i++) {
      const ct = meta.cellType[i];
      let base = blocked && blocked[i] ? C.scar : ct === CT.ATRIAL || ct === CT.VENTRICULAR ? baseColor(meta.region[i], L.anatomy) : C.pathIdle;
      // ischaemic territory of the culprit lesion: tinted at rest so the "victim" region is visible
      if (isch && isch[i] > 0.02) base = mix(base, C.ischaemia, 0.75 * isch[i], ischTmp);
      let col: RGB = base;
      const r = data.lastActIndex(i, t);
      if (r >= 0) {
        const tau = t - data.recT[r];
        const apd = data.recApd[r];
        const s = shapesFor(params)[ct];
        const erp = apd * (ct === CT.ATRIAL ? params.atria.erpRatio : params.ventricles.erpRatio);
        if (wave) {
          if (data.recWave[r] === wave.id && (ct === CT.ATRIAL || ct === CT.VENTRICULAR)) {
            const at = data.recT[r] - (ct === CT.ATRIAL ? wave.tA : wave.tV);
            col = atColor(Math.min(1, at / (ct === CT.ATRIAL ? 110 : 100)));
            if (at % 10 < 1.2) col = mix(col, [0, 0, 0], 0.35, [0, 0, 0]);
          }
        } else {
          const w = s ? s.repolWidth * apd : 0.1 * apd;
          const t50 = s ? repolMidpoint(s, apd) : 0.8 * apd;
          const ph3Start = t50 - 1.6 * w;
          const ph3End = apd + 1.5 * w;
          if (L.refractory) {
            if (tau < erp) col = mix(base, C.absRef, 0.85, tmp).slice() as RGB;
            else if (tau < apd + 40) col = mix(base, C.relRef, 0.75, tmp).slice() as RGB;
          } else {
            if (L.activation && tau < ph3Start) col = mix(base, C.depol, 0.82, tmp).slice() as RGB;
            if (L.repolarization && tau >= ph3Start && tau < ph3End) {
              const prog = 1 - Math.abs((tau - t50) / (ph3End - ph3Start));
              col = mix(base, C.repol, 0.35 + 0.55 * Math.max(0, prog), tmp).slice() as RGB;
            }
          }
          if (L.activation && tau < 6) col = C.front;
        }
      }
      if (hl && hl.has(i)) col = mix(col, C.highlight, 0.7, [0, 0, 0]);
      out[3 * i] = col[0];
      out[3 * i + 1] = col[1];
      out[3 * i + 2] = col[2];
    }
    // conduction-system colours (idle / impulse passing / depolarised)
    for (const p of [...this.paths]) {
      for (const n of p.nodes) {
        const r = data.lastActIndex(n, t);
        let c = C.pathIdle;
        if (r >= 0) {
          const tau = t - data.recT[r];
          if (tau < 10) c = C.pathLive;
          else if (tau < data.recApd[r] && L.activation) c = C.pathDep;
        }
        if (hl && hl.has(n)) c = C.highlight;
        out[3 * n] = c[0];
        out[3 * n + 1] = c[1];
        out[3 * n + 2] = c[2];
      }
    }
    for (const s of this.nodeSpheres) {
      const r = data.lastActIndex(s.node, t);
      const tau = r >= 0 ? t - data.recT[r] : 1e9;
      const mat = s.mesh.material as THREE.MeshStandardMaterial;
      const hit = hl?.has(s.node);
      mat.color.setRGB(...(hit ? C.highlight : tau < 15 ? C.pathLive : tau < 160 ? C.pathDep : C.pathIdle));
      mat.emissive.setRGB(...(tau < 15 || hit ? ([0.6, 0.55, 0.3] as RGB) : ([0.05, 0.05, 0.05] as RGB)));
      s.mesh.scale.setScalar(tau < 15 ? 1.3 : 1);
      s.mesh.visible = this.layers.pathways;
    }
  }

  private applyColors(): void {
    const nc = this.nodeColor;
    const L = this.layers;
    const se = this.sensitivityElectrode;
    for (const s of this.surfaces) {
      const { vNodes, vWeights } = s.src;
      const col = s.colors;
      const nv = col.length / 3;
      if (se) {
        // lead-field magnitude of a point electrode in an infinite medium ∝ 1/R² (log scale)
        const P = s.src.positions;
        let rmin = Infinity;
        for (let v = 0; v < nv; v++) rmin = Math.min(rmin, Math.hypot(P[3 * v] - se[0], P[3 * v + 1] - se[1], P[3 * v + 2] - se[2]));
        for (let v = 0; v < nv; v++) {
          const R = Math.hypot(P[3 * v] - se[0], P[3 * v + 1] - se[1], P[3 * v + 2] - se[2]);
          const x = Math.max(0, Math.min(1, 1 + Math.log10((rmin * rmin) / (R * R)) / 1.2));
          const c = atColor(1 - x);
          col[3 * v] = c[0];
          col[3 * v + 1] = c[1];
          col[3 * v + 2] = c[2];
        }
        (s.mesh.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
        s.mesh.visible = s.src.name === "atria" ? L.atria : L.ventricles;
        continue;
      }
      for (let v = 0; v < nv; v++) {
        let r = 0,
          g = 0,
          b = 0;
        for (let q = 0; q < 4; q++) {
          const n = vNodes[4 * v + q];
          const w = vWeights[4 * v + q];
          r += w * nc[3 * n];
          g += w * nc[3 * n + 1];
          b += w * nc[3 * n + 2];
        }
        col[3 * v] = r;
        col[3 * v + 1] = g;
        col[3 * v + 2] = b;
      }
      (s.mesh.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      const mat = s.mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = L.mesh ? Math.min(this.opacity, 0.25) : this.opacity;
      mat.depthWrite = this.opacity >= 0.98;
      s.mesh.visible = s.src.name === "atria" ? L.atria : L.ventricles;
    }
    for (const p of this.paths) {
      p.mesh.visible = L.pathways && (p.major || L.mesh);
      const colAttr = p.mesh.geometry.attributes.color as THREE.BufferAttribute;
      const arr = colAttr.array as Float32Array;
      for (let ring = 0; ring < p.rings; ring++) {
        const n = p.nodes[Math.min(ring, p.nodes.length - 1)];
        for (let k = 0; k < p.ringVerts; k++) {
          const vi = ring * p.ringVerts + k;
          arr[3 * vi] = nc[3 * n];
          arr[3 * vi + 1] = nc[3 * n + 1];
          arr[3 * vi + 2] = nc[3 * n + 2];
        }
      }
      colAttr.needsUpdate = true;
    }
    if (this.points) {
      this.points.visible = L.mesh;
      if (L.mesh) {
        const idx = this.points.userData.idx as number[];
        const arr = (this.points.geometry.attributes.color as THREE.BufferAttribute).array as Float32Array;
        idx.forEach((n, k) => {
          arr[3 * k] = nc[3 * n];
          arr[3 * k + 1] = nc[3 * n + 1];
          arr[3 * k + 2] = nc[3 * n + 2];
        });
        (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      }
    }
  }

  /** Heart (dipole) vector at time t and its loop since the start of the current wave. */
  private updateVector(t: number, src: SceneSource): void {
    const show = this.layers.vectors;
    this.arrow.visible = show;
    this.loop.visible = show;
    if (!show) return;
    const { data } = src;
    const px = data.at(t, 12);
    const py = data.at(t, 13);
    const pz = data.at(t, 14);
    const v = new THREE.Vector3(px, py, pz);
    const mag = v.length();
    const len = mag * this.vectorScale;
    const origin = new THREE.Vector3(0, 0, 0);
    this.arrow.position.copy(origin);
    if (len > 0.5) {
      const dir = v.clone().normalize();
      this.arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const shaft = Math.max(0.1, len - 8);
      this.arrowShaft.scale.set(1, shaft, 1);
      this.arrowShaft.position.set(0, shaft / 2, 0);
      this.arrowHead.position.set(0, shaft + 5, 0);
      this.arrowHead.scale.setScalar(Math.min(1, len / 14));
      this.arrow.visible = true;
    } else this.arrow.visible = false;
    // loop: from the start of the current wave (or last 700 ms)
    const ws = data.wavesSorted();
    let t0 = t - 700;
    let cur = null;
    for (const w of ws) if (w.t0 <= t) cur = w;
    if (cur) t0 = Math.max(t0, cur.t0);
    let k = 0;
    const max = this.loopPositions.length / 3;
    const step = Math.max(data.dt, (t - t0) / max);
    for (let tt = t0; tt <= t && k < max; tt += step, k++) {
      this.loopPositions[3 * k] = data.at(tt, 12) * this.vectorScale;
      this.loopPositions[3 * k + 1] = data.at(tt, 13) * this.vectorScale;
      this.loopPositions[3 * k + 2] = data.at(tt, 14) * this.vectorScale;
      let c: RGB = [0.6, 0.6, 0.65];
      if (cur) {
        if (Number.isFinite(cur.tFirstAtrial) && tt >= cur.tFirstAtrial && tt <= cur.tLastAtrial + 15) c = [0.45, 0.6, 1];
        else if (Number.isFinite(cur.tFirstVent) && tt >= cur.tFirstVent && tt <= cur.tLastVent + 8) c = [1, 0.62, 0.15];
        else if (Number.isFinite(cur.tLastVent) && tt > cur.tLastVent + 8) c = [0.7, 0.45, 1];
      }
      this.loopColors.set(c, 3 * k);
    }
    const g = this.loop.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, k);
    g.computeBoundingSphere();
  }

  private placeLabels(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const show = this.layers.labels;
    const v = new THREE.Vector3();
    for (const l of this.labelEls) {
      const vis = show && (l.layer === "chamber" || (l.layer === "vessel" ? this.layers.anatomy : this.layers.pathways));
      if (!vis) {
        l.el.style.display = "none";
        continue;
      }
      v.copy(l.pos).applyMatrix4(this.root.matrixWorld).project(this.camera);
      if (v.z > 1) {
        l.el.style.display = "none";
        continue;
      }
      l.el.style.display = "block";
      l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
    }
  }

  // ---- picking -------------------------------------------------------------------------
  private downAt: [number, number] | null = null;
  private onDown = (e: PointerEvent) => {
    this.downAt = [e.clientX, e.clientY];
  };
  private onUp = (e: PointerEvent) => {
    if (!this.downAt || !this.meta) return;
    const moved = Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]);
    this.downAt = null;
    if (moved > 4) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const targets: THREE.Object3D[] = [...this.nodeSpheres.map((s) => s.mesh), ...this.paths.filter((p) => p.mesh.visible).map((p) => p.mesh), ...this.surfaces.filter((s) => s.mesh.visible).map((s) => s.mesh)];
    const hits = ray.intersectObjects(targets, false);
    if (!hits.length) return;
    const hit = hits[0];
    const ud = hit.object.userData;
    if (ud.kind === "node") this.onSelect?.({ node: ud.node, label: ud.name });
    else if (ud.kind === "path") this.onSelect?.({ node: ud.node, label: PATH_NAMES[ud.region] ?? "Conduction system" });
    else if (ud.kind === "surface" && hit.face) {
      const s = this.surfaces.find((x) => x.mesh === hit.object)!;
      const n = s.src.vNodes[4 * hit.face.a];
      const meta = this.meta;
      const layer = meta.cellType[n] === CT.VENTRICULAR ? (meta.transmural[n] < 0.33 ? " (endocardial)" : meta.transmural[n] > 0.67 ? " (epicardial)" : " (mid-wall)") : "";
      this.onSelect?.({ node: n, label: `${REGION_NAMES[meta.region[n]]}${layer}` });
    }
  };

  dispose(): void {
    this.disposed = true;
    this.renderer.domElement.removeEventListener("pointerdown", this.onDown);
    this.renderer.domElement.removeEventListener("pointerup", this.onUp);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }
}
