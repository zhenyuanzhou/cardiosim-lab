import { chromium } from "playwright";
const [id, wait] = [process.argv[2], +(process.argv[3] ?? 5000)];
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto("file:///home/claude/cardiosim/dist-standalone/index.html"); await page.waitForTimeout(1500);
await page.click('[data-tab="scenarios"]'); await page.click(`[data-scenario="${id}"]`); await page.click('[data-testid="scenario-load"]');
await page.selectOption("#speed", "2"); await page.waitForTimeout(wait); await page.click("text=Pause").catch(()=>{});
await page.locator('[data-panel] header button[aria-label="Maximise panel"]').nth(+(process.env.NTH ?? 2)).click().catch(e=>console.log(e.message));
await page.waitForTimeout(800); await page.screenshot({ path: `/tmp/claude-0/svt/appmax-${id}.png` }); await b.close();
