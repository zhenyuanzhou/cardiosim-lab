import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto("http://localhost:5180/");
await page.waitForFunction(() => window.__cardiosim?.sim?.data && window.__cardiosim.store.getState().ready, null, { timeout: 60000 });
for (const mode of ["split", "simulator"]) {
  await page.evaluate((m) => window.__cardiosim.store.getState().set({ mode: m }), mode);
  await page.waitForTimeout(3000);
  let t0 = Date.now();
  for (let i = 0; i < 5; i++) await page.evaluate((t) => { window.__cardiosim.seek(t); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }, 1000 + i);
  const tSeek = (Date.now() - t0) / 5;
  t0 = Date.now();
  for (let i = 0; i < 5; i++) await page.screenshot({ path: `/tmp/claude-0/p${i}.jpg`, type: "jpeg", quality: 90 });
  console.log(mode, "seek+2raf ms", tSeek.toFixed(0), "screenshot ms", ((Date.now() - t0) / 5).toFixed(0));
}
await browser.close();
