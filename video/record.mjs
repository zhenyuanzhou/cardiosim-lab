/**
 * Deterministic demo-video recorder. Drives the real running app (vite preview build) through
 * the automation hooks, steps the shared simulation clock frame by frame and screenshots each
 * frame at 1920×1080. Captions are DOM overlays inside the page. Usage:
 *   node video/record.mjs <framesDir> <scene...>      (scenes: s1 … s7)
 * Then video/encode.sh assembles the MP4 at 30 fps.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2];
const SCENES = process.argv.slice(3);
const URL = process.env.APP_URL ?? "http://localhost:5180/";
const FPS = 30;
/** Each captured frame is used for DUP output frames (15 distinct frames/s in a 30 fps file; software GL is slow). */
const DUP = 2;

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("pageerror:", e.message));

async function boot() {
  await page.goto(URL);
  await page.waitForFunction(() => window.__cardiosim?.sim?.data && window.__cardiosim.store.getState().ready, null, { timeout: 60000 });
  await page.addStyleTag({
    content: `
    #cap { position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%); max-width: 1500px; z-index: 9999;
      background: rgba(8,10,12,.86); color: #f3efe7; border: 1px solid rgba(232,163,61,.55); border-radius: 10px;
      padding: 14px 26px; font: 500 30px/1.32 "IBM Plex Sans", "Segoe UI", system-ui, sans-serif; text-align: center;
      box-shadow: 0 8px 30px rgba(0,0,0,.45); }
    #cap small { display: block; font-size: 21px; color: #c9c2b5; margin-top: 4px; }
    #cap:empty { display: none; }
    #card { position: fixed; inset: 0; z-index: 9998; display: grid; place-items: center; background: rgba(9,11,13,.9); color: #f3efe7; text-align: center; }
    #card h1 { font: 600 76px/1.1 "Barlow Semi Condensed", "Arial Narrow", sans-serif; letter-spacing: .02em; margin: 0 0 18px; }
    #card h1 span { color: #e8a33d; }
    #card p { font: 400 36px/1.4 "IBM Plex Sans", system-ui, sans-serif; margin: 6px 0; color: #d9d3c8; }
    #card .small { font-size: 24px; color: #a59e92; margin-top: 30px; }
  `,
  });
  await page.evaluate(() => {
    const c = document.createElement("div");
    c.id = "cap";
    document.body.appendChild(c);
  });
}

const cap = (text, sub = "") =>
  page.evaluate(([t, s]) => {
    document.getElementById("cap").innerHTML = t ? `${t}${s ? `<small>${s}</small>` : ""}` : "";
  }, [text, sub]);
const card = (html) =>
  page.evaluate((h) => {
    let c = document.getElementById("card");
    if (!h) return c?.remove();
    if (!c) {
      c = document.createElement("div");
      c.id = "card";
      document.body.appendChild(c);
    }
    c.innerHTML = `<div>${h}</div>`;
  }, html);
const raf = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));
const wait = (ms) => page.waitForTimeout(ms);

/** Move the shared clock to t (waits until the simulation has produced data beyond t). */
const at = (t) =>
  page.evaluate(async (tt) => {
    const a = window.__cardiosim;
    for (let i = 0; i < 400 && a.sim.data.tEnd < tt + 250; i++) {
      a.clock.t = Math.min(a.sim.data.tEnd, tt);
      await new Promise((r) => setTimeout(r, 40));
    }
    a.seek(tt);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, t);

let dir = "";
let n = 0;
async function shot(dup = DUP) {
  const f = path.join(dir, `f${String(n).padStart(5, "0")}.jpg`);
  await page.screenshot({ path: f, type: "jpeg", quality: 90 });
  n++;
  for (let k = 1; k < dup; k++) {
    fs.copyFileSync(f, path.join(dir, `f${String(n).padStart(5, "0")}.jpg`));
    n++;
  }
  return f;
}
async function hold(seconds) {
  const f = await shot(1);
  for (let k = 1; k < Math.round(seconds * FPS); k++) {
    fs.copyFileSync(f, path.join(dir, `f${String(n).padStart(5, "0")}.jpg`));
    n++;
  }
}
/** Scrub sim time t0→t1 at `msPerFrame`, with captions keyed by sim time [[t, text, sub]]. */
async function scrub(t0, t1, msPerFrame, caps = []) {
  let ci = -1;
  for (let t = t0; t <= t1; t += msPerFrame) {
    let k = ci;
    while (k + 1 < caps.length && caps[k + 1][0] <= t) k++;
    if (k !== ci) {
      ci = k;
      await cap(caps[k][1], caps[k][2] ?? "");
    }
    await at(t);
    await shot();
  }
}
// NOTE: scrub(t0, t1, ms) advances `ms` of simulated time per *captured* frame (= DUP output frames).
const setStore = (patch) => page.evaluate((p) => window.__cardiosim.store.getState().set(p), patch);
const restartWith = (scenarioId) =>
  page.evaluate((id) => {
    const a = window.__cardiosim;
    const s = a.scenarios.find((x) => x.id === id);
    a.store.getState().set({ scenarioId: id });
    a.restart(s.apply());
    a.seek(0);
  }, scenarioId);

const SCENE = {
  async s1() {
    await setStore({ mode: "simulator", maximized: null, heartLayers: { ...(await page.evaluate(() => window.__cardiosim.store.getState().heartLayers)) } });
    await restartWith("nsr");
    await at(2400);
    await cap("");
    await card(`<h1>CARDIO<span>SIM</span> LAB</h1><p>From Cardiac Electrophysiology to the 12-Lead ECG</p><p class="small">Recorded from the running application · reduced-order educational model</p>`);
    await raf();
    await hold(8);
    await card("");
  },
  async s2() {
    await setStore({ mode: "split", maximized: null, explorerLeads: ["II"] });
    await restartWith("nsr");
    await wait(2500);
    await at(800);
    await scrub(880, 1540, 1.24, [
      [880, "Normal sinus rhythm — one beat in slow motion", "Heart, torso, ECG and action potentials share one simulation clock"],
      [952, "The SA node fires", "Too little tissue to be seen on the surface ECG"],
      [962, "Atrial activation spreads from right to left atrium → P wave", "The ECG sums the wavefronts weighted by lead geometry — it is not a membrane voltage"],
      [1045, "The AV node delays conduction → isoelectric PR segment", "Nodal, His and bundle-branch conduction are silent at the body surface"],
      [1080, "His bundle → bundle branches → Purkinje network", "Fast conduction spreads activation over the endocardium"],
      [1119, "Ventricular depolarisation: septum first, then the free walls → QRS", "Only cells at the wavefront (large Vm gradients) contribute"],
      [1205, "Plateau: nearly all cells depolarised, small gradients → ST segment", ""],
      [1300, "Recovery gradients (epicardium recovers first) → T wave", "QT spans earliest activation to latest recovery — not one cell's APD"],
    ]);
  },
  async s3() {
    await setStore({ mode: "explorer", maximized: null, explorerLeads: ["II", "aVR"], torsoLayers: { torso: true, electrodes: true, leadAxes: true, projection: true, heart: true, sensitivity: false } });
    await restartWith("nsr");
    await wait(2500);
    await at(850);
    await scrub(880, 1520, 2.4, [
      [880, "How a limb lead sees the heart: leads II and aVR", "Lead II = LL − RA (positive pole at +60°); aVR = RA − (LA+LL)/2 (−150°)"],
      [1000, "The heart vector projects onto each lead axis", "Projection ∝ vector · lead vector — exact for the limb leads in this model"],
      [1120, "Activation points down and to the left → positive in II, negative in aVR", "The two axes are 150° apart, so aVR mirrors II"],
      [1300, "Same sources, different viewpoints: the T wave follows the same rule", ""],
    ]);
    await setStore({ explorerLeads: ["V1", "V6"] });
    await scrub(1790, 2432, 2.4, [
      [1790, "Chest leads: V1 and V6", "Each is measured against the Wilson central terminal (mean of RA, LA, LL)"],
      [1950, "Chest electrodes are close to the heart: a lead field, not a fixed ray", "Dashed trace = dipole estimate; solid = full forward model (near-field sources included)"],
      [2031, "Early septal activation (left → right) → small r in V1, small q in V6", ""],
      [2080, "LV free-wall activation dominates → deep S in V1, tall R in V6", ""],
    ]);
  },
  async s4() {
    await setStore({ mode: "simulator", maximized: null, tab: "scenarios", ecgLayout: "leads", selectedLeads: ["II", "V1", "V6"], explorerLeads: ["II", "V1", "V6"] });
    await restartWith("pvc");
    await wait(3000);
    await at(1700);
    const caps = [
      [1700, "Premature ventricular complex (scenario: PVC, compensatory pause)", "An ectopic focus in the LV lateral wall fires 450 ms after a sinus QRS"],
      [2470, "No P wave precedes it: the ventricles are activated cell-to-cell → wide QRS", ""],
      [2650, "Repolarisation follows the abnormal activation order → ST–T opposite to the QRS", ""],
      [2780, "The retrograde impulse conceals in the AV node: the next sinus P is blocked", "Watch the AV-node action potential and the event log"],
      [3300, "Fully compensatory pause: two sinus cycles from the simulation itself", "Not a stored waveform — refractoriness and concealed conduction produce it"],
    ];
    await scrub(1700, 2440, 8, caps);
    await scrub(2444, 2900, 2.4, caps);
    await scrub(2905, 4300, 8, caps);
  },
  async s5() {
    // B = LBBB, A = default; ABView simulates both from t = 0
    await restartWith("lbbb");
    await setStore({ mode: "ab", maximized: null, explorerLeads: ["I", "V1", "V6"] });
    await wait(800);
    await page.click('[data-testid="ab-run"]');
    await page.waitForSelector('[data-testid="ab-view"]', { timeout: 120000 });
    await page.evaluate(() => (window.__cardiosim.abTime = 880));
    await wait(1500);
    const caps = [
      [880, "Bundle branch block, A/B side by side: A = normal, B = left bundle branch blocked", "Both runs: same anatomy, lead field and scaling — one parameter differs"],
      [1100, "B: the septum is activated from the right side → no septal q in I and V6", ""],
      [1160, "B: the left ventricle is reached slowly through myocardium → broad QRS (≈ 140 ms here)", "Septal and left-ventricular activation are now in reverse order"],
      [1300, "Secondary ST–T change: repolarisation follows the late LV activation", ""],
    ];
    let ci = -1;
    for (let t = 880; t <= 1560; t += 1.8) {
      let k = ci;
      while (k + 1 < caps.length && caps[k + 1][0] <= t) k++;
      if (k !== ci) {
        ci = k;
        await cap(caps[k][1], caps[k][2]);
      }
      await page.evaluate((tt) => (window.__cardiosim.abTime = tt), t);
      await raf();
      await shot();
    }
    await page.evaluate(() => (window.__cardiosim.abTime = undefined));
  },
  async s6() {
    await setStore({ mode: "simulator", maximized: null, tab: "ionic", ecgLayout: "leads", selectedLeads: ["II", "V5"] });
    await restartWith("nsr");
    await wait(2500);
    await at(5600);
    await page.getByRole("button", { name: "IKr −50 %" }).click();
    await cap("Parameter change: inhibit 50 % of IKr in the TP06 ionic cell model", "ten Tusscher–Panfilov 2006: 19 state variables, epicardial, M and endocardial cells");
    await page.click('[data-testid="ionic-run"]');
    await page.waitForSelector('[data-testid="ionic-lab"] table.meas', { timeout: 120000 });
    await raf();
    await hold(5);
    await cap("APD90 lengthens in every cell type — most in the M cell (low IKs)", "Dashed = baseline, solid = IKr −50 %");
    await hold(4);
    await page.getByRole("button", { name: "Apply to tissue (live)" }).click();
    await page.evaluate(() => window.__cardiosim.seek(5600));
    await scrub(5600, 12600, 14, [
      [5600, "Mapped onto the tissue model (APD × 1.085) and applied live", "A reduced-order bridge: ionic currents act in single cells only"],
      [7800, "QT lengthens beat by beat; QRS is unchanged", "Compare the beats before and after the change on the same strip"],
      [10200, "The Explain tab reports the measured ECG effect", ""],
    ]);
    await setStore({ tab: "explain" });
    await raf();
    await cap("Measured effect of the change, from the simulated ECG", "Not for clinical use — an educational model with documented limitations");
    await hold(5);
  },
  async s7() {
    await cap("");
    await card(`<h1>Understand the mechanisms<br/>behind the waveform.</h1><p>CardioSim Lab · Interactive cardiac electrophysiology education</p><p class="small">Not for clinical use.</p>`);
    await raf();
    await hold(8);
    await card("");
  },
};

await boot();
for (const s of SCENES) {
  dir = path.join(OUT, s);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
  n = 0;
  const t0 = Date.now();
  await SCENE[s]();
  console.log(`${s}: ${n} frames (${(n / FPS).toFixed(1)} s) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();
