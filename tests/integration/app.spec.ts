import { expect, test, type Page } from "@playwright/test";

/** Fraction of non-background pixels in a canvas (proves something was drawn). */
async function inkFraction(page: Page, testId: string): Promise<number> {
  return page.locator(`[data-testid="${testId}"]`).evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext("2d")!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 0) ink++;
    return ink / (d.length / 16);
  });
}

async function clockSeconds(page: Page): Promise<number> {
  const txt = await page.locator('[data-testid="clock"]').innerText();
  return parseFloat(txt.replace(/[^\d.]/g, ""));
}

test.describe("CardioSim Lab", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-testid="heart-canvas"]')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3500);
  });

  test("starts in normal sinus rhythm with all four panels drawn and the clock running", async ({ page }) => {
    const t1 = await clockSeconds(page);
    await page.waitForTimeout(1500);
    const t2 = await clockSeconds(page);
    expect(t2).toBeGreaterThan(t1);
    expect(await inkFraction(page, "heart-canvas")).toBeGreaterThan(0.02);
    expect(await inkFraction(page, "ap-canvas")).toBeGreaterThan(0.05);
    expect(await inkFraction(page, "ecg-canvas")).toBeGreaterThan(0.2);
    await expect(page.locator('[data-testid="measurements"]')).toContainText("PR (ms)");
    await expect(page.locator('[data-testid="event-log"]')).toContainText("SA node fires");
  });

  test("pause freezes all views at one simulation time", async ({ page }) => {
    await page.click('[data-testid="play"]');
    const t1 = await clockSeconds(page);
    await page.waitForTimeout(1000);
    expect(await clockSeconds(page)).toBeCloseTo(t1, 2);
  });

  test("a live parameter change alters the simulation and is explained with measured effects", async ({ page }) => {
    await page.click('[data-tab="scenarios"]');
    await page.click('[data-scenario="avb1"]');
    await page.getByRole("button", { name: "Apply live" }).click();
    await page.waitForTimeout(9000);
    await page.click('[data-tab="explain"]');
    const card = page.locator('[data-testid="explanation"]').first();
    await expect(card).toContainText("Minimum AV nodal conduction time");
    await expect(card).toContainText("PR interval", { timeout: 20_000 });
    // the measurements table now reports a prolonged PR from the ECG signal
    const pr = await page.locator('[data-testid="measurements"] tr', { hasText: "PR (ms)" }).locator("td").nth(1).innerText();
    expect(parseFloat(pr)).toBeGreaterThan(220);
  });

  test("clicking the ECG inspects the heart state at that instant", async ({ page }) => {
    const box = (await page.locator('[data-testid="ecg-canvas"]').boundingBox())!;
    // rhythm strip (bottom row), early part of the page
    await page.mouse.click(box.x + 60, box.y + box.height * 0.85);
    await expect(page.locator('[data-testid="inspect-box"]')).toBeVisible();
    await expect(page.locator('[data-testid="inspect-box"]')).toContainText(/P wave|PR segment|QRS complex|ST segment|T wave|Isoelectric/);
  });

  test("validation dashboard confirms lead identities and ECG–activation coherence", async ({ page }) => {
    await page.waitForTimeout(4000);
    await page.click('[data-tab="validation"]');
    const t = page.locator('[data-testid="validation-table"]');
    await expect(t.first()).toBeVisible();
    await expect(page.locator("tr", { hasText: "Einthoven" }).locator(".status")).toHaveText("pass");
    await expect(page.locator("tr", { hasText: "QRS onset vs first ventricular activation" }).locator(".status")).toHaveText("pass");
    await expect(page.locator("tr", { hasText: "Activation sequence" }).locator(".status")).toHaveText("pass");
  });

  test("A/B comparison runs both conditions and overlays them", async ({ page }) => {
    await page.click('[data-tab="compare"]');
    await page.getByRole("button", { name: "Set current as A" }).click();
    await page.click('[data-tab="scenarios"]');
    await page.click('[data-scenario="rbb-slow"]');
    await page.getByRole("button", { name: "Apply live" }).click();
    await page.click('[data-tab="compare"]');
    await page.getByRole("button", { name: /Run A vs B/ }).click();
    await expect(page.locator('[data-testid="compare-table"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("A/B overlay")).toBeVisible();
    const qrsRow = page.locator('[data-testid="compare-table"] tr', { hasText: "QRS" }).first();
    const delta = parseFloat((await qrsRow.locator("td").nth(3).innerText()).replace("+", ""));
    expect(delta).toBeGreaterThan(15);
  });

  test("exports the ECG as CSV", async ({ page }) => {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV", exact: true }).click()]);
    const path = await dl.path();
    const fs = await import("fs");
    const text = fs.readFileSync(path!, "utf8");
    expect(text.split("\n")[0]).toBe("time_ms,I,II,III,aVR,aVL,aVF,V1,V2,V3,V4,V5,V6");
    expect(text.split("\n").length).toBeGreaterThan(100);
  });
});
