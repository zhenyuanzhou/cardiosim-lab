// Reproduces the user's ectopy routes in the running app and counts ectopic ventricular beats.
import { chromium } from "playwright";
const url = process.argv[2] ?? "http://localhost:5180/";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(url);
await page.waitForFunction(() => window.__cardiosim?.store.getState().ready, null, { timeout: 60000 });
const count = () =>
  page.evaluate(() => {
    const ws = [...window.__cardiosim.sim.data.waves.values()];
    return { t: Math.round(window.__cardiosim.clock.t), simEnd: Math.round(window.__cardiosim.sim.data.tEnd), ectopicV: ws.filter((w) => w.origin === "ectopic" && Number.isFinite(w.tFirstVent)).length, ectopicAll: ws.filter((w) => w.origin === "ectopic").length, scenario: window.__cardiosim.store.getState().scenarioId, ectopy: JSON.stringify(window.__cardiosim.store.getState().params.ectopy) };
  });
await page.evaluate(() => window.__cardiosim.store.getState().set({ speed: 4 }));
// Route 1: Scenarios → Load
await page.click('[data-tab="scenarios"]');
await page.click('[data-scenario="bigeminy"]');
await page.click('[data-testid="scenario-load"]');
await page.waitForTimeout(8000);
console.log("scenario load:", await count());
// Route 2: Scenarios → Apply live (from NSR)
await page.click('[data-scenario="nsr"]');
await page.click('[data-testid="scenario-load"]');
await page.waitForTimeout(3000);
await page.click('[data-scenario="trigeminy"]');
await page.getByRole("button", { name: "Apply live" }).click();
await page.waitForTimeout(8000);
console.log("apply live:", await count());
// Route 3: Parameters → Ectopy
await page.click('[data-scenario="nsr"]');
await page.click('[data-testid="scenario-load"]');
await page.waitForTimeout(2000);
await page.click('[data-tab="parameters"]');
await page.locator("details.group", { hasText: "Ectopy" }).locator("summary").click();
await page.selectOption("#p-ectopy-site", "rv-apex");
await page.waitForTimeout(8000);
console.log("parameters site only:", await count());
await page.selectOption("#p-ectopy-pattern", "bigeminy");
await page.waitForTimeout(8000);
console.log("parameters bigeminy:", await count());
// Route 4: Experiments F (explorer)
await page.click('[data-mode="explorer"]');
await page.click('[data-testid="experiments-button"]');
await page.click('[data-variant="F:F-single"]');
await page.waitForTimeout(8000);
console.log("experiment F-single:", await count());
await browser.close();
