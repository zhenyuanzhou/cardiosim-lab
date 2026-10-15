// Opens the standalone build over file:// and checks that the simulation and the ionic worker run.
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("file://" + process.argv[2]);
await page.waitForFunction(() => window.__cardiosim?.store.getState().ready, null, { timeout: 60000 });
await page.waitForTimeout(3000);
const t = await page.evaluate(() => window.__cardiosim.clock.t);
await page.click('[data-tab="ionic"]');
await page.click('[data-testid="ionic-run"]');
await page.waitForSelector('[data-testid="ionic-lab"] table.meas', { timeout: 90000 });
console.log("clock", t.toFixed(0), "ionic OK", "errors:", errs.join(" | ") || "none");
await browser.close();
