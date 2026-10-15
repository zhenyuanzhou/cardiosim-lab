// Usage: node scripts/dev/shots.mjs <outdir> [mode...]  (needs `npx vite preview --port 5180` running)
import { chromium } from "playwright";
const out = process.argv[2];
const modes = process.argv.slice(3).length ? process.argv.slice(3) : ["simulator", "explorer", "split"];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const logs = [];
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && logs.push(m.type() + ": " + m.text()));
page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
await page.goto("http://localhost:5180/");
await page.waitForTimeout(6000);
for (const m of modes) {
  await page.click(`[data-mode="${m}"]`);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/${m}.png` });
}
console.log(logs.slice(0, 20).join("\n"));
await browser.close();
