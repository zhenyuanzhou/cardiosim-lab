import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const m = await browser.newPage({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
await m.goto("http://localhost:5180/");
await m.waitForTimeout(13000);
await m.screenshot({ path: process.argv[2] });
await browser.close();
