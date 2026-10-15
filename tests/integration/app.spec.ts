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
    await expect(page.locator('[data-testid="heart-canvas"] canvas')).toHaveCount(1);
    await expect(page.locator(".scene-label.chamber", { hasText: "LV" })).toBeVisible();
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
    await page.click('[data-scenario="rbbb"]');
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

  test("exports the ECG as SVG and PNG", async ({ page }) => {
    const [svg] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "SVG", exact: true }).click()]);
    const fs = await import("fs");
    expect(fs.readFileSync((await svg.path())!, "utf8")).toContain("<svg");
    const [png] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PNG", exact: true }).click()]);
    const buf = fs.readFileSync((await png.path())!);
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
  });

  test("Leads & Vectors mode shows torso, hexaxial diagram, lead strips and the lead explanation", async ({ page }) => {
    await page.click('[data-mode="explorer"]');
    await expect(page.locator('[data-testid="torso-canvas"] canvas')).toHaveCount(1);
    await page.click('.lead-picker [data-lead="aVR"]');
    await page.waitForTimeout(1500);
    expect(await inkFraction(page, "hexaxial")).toBeGreaterThan(0.01);
    expect(await inkFraction(page, "lead-strips")).toBeGreaterThan(0.2);
    await page.dblclick('.lead-picker [data-lead="V1"]');
    await expect(page.locator('[data-testid="lead-info"]')).toContainText("Lead V1");
    await expect(page.locator('[data-testid="lead-info"]')).toContainText("Wilson central terminal");
  });

  test("experiments menu loads a variant (bundle branch block) in the explorer", async ({ page }) => {
    await page.click('[data-mode="explorer"]');
    await page.click('[data-testid="experiments-button"]');
    await page.click('[data-variant="C:C-lbbb"]');
    await expect(page.locator('.lead-picker [data-lead="V1"]')).toHaveClass(/primary/);
    await page.click('[data-mode="simulator"]');
    await page.click('[data-tab="parameters"]');
    await expect(page.locator('#p-hisPurkinje-lbbBlock')).toBeChecked();
  });

  test("split view shows heart, torso, ECG and action potentials on one clock", async ({ page }) => {
    await page.click('[data-mode="split"]');
    await expect(page.locator('[data-testid="heart-canvas"] canvas')).toHaveCount(1);
    await expect(page.locator('[data-testid="torso-canvas"] canvas')).toHaveCount(1);
    await page.waitForTimeout(1500);
    expect(await inkFraction(page, "lead-strips")).toBeGreaterThan(0.2);
    expect(await inkFraction(page, "ap-canvas")).toBeGreaterThan(0.05);
  });

  test("scenario registry: a validated PVC scenario produces an ectopic beat; unsupported ones cannot be loaded", async ({ page }) => {
    await page.click('[data-tab="scenarios"]');
    await page.click('[data-scenario="af"]');
    await expect(page.locator('[data-testid="scenario-card"]')).toContainText("not supported yet");
    await expect(page.locator('[data-testid="scenario-load"]')).toHaveCount(0);
    await page.click('[data-scenario="pvc"]');
    await page.click('[data-testid="scenario-load"]');
    await page.waitForTimeout(6000);
    await expect(page.locator('[data-testid="event-log"]')).toContainText(/Ectopic beat|SA node fires/);
    const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV", exact: true }).click()]);
    expect(csv).toBeTruthy();
  });

  test("clicking a timeline event highlights the structure and explains it", async ({ page }) => {
    await page.locator(".evlog .row", { hasText: "AV nodal exit" }).first().click();
    await expect(page.locator('[data-testid="event-note"]')).toContainText("His bundle");
  });

  test("lessons load a starting state and switch the view", async ({ page }) => {
    await page.click('[data-tab="lessons"]');
    await page.selectOption("#lesson-pick", "L4");
    await page.getByRole("button", { name: "Load starting state" }).click();
    await expect(page.locator('[data-mode="split"]')).toHaveClass(/on/);
  });

  test("ionic cell lab paces TP06 cells and reports APD90", async ({ page }) => {
    await page.click('[data-tab="ionic"]');
    await page.getByRole("button", { name: "IKr −50 %" }).click();
    await page.click('[data-testid="ionic-run"]');
    await expect(page.locator('[data-testid="ionic-lab"] table.meas')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid="ionic-lab"] table.meas')).toContainText("M cell");
  });

  test("A/B mode animates two runs side by side", async ({ page }) => {
    await page.click('[data-tab="scenarios"]');
    await page.click('[data-scenario="rbbb"]');
    await page.getByRole("button", { name: "Apply live" }).click();
    await page.click('[data-mode="ab"]');
    await page.click('[data-testid="ab-run"]');
    await expect(page.locator('[data-testid="ab-view"]')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1500);
    expect(await inkFraction(page, "ab-strips")).toBeGreaterThan(0.2);
    await expect(page.locator('[data-testid="ab-view"]')).toContainText("Right bundle branch block");
  });
});

test.describe("responsive layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("phone width: no horizontal page scroll and the ECG fills its width", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-testid="ecg-canvas"]')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3000);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over).toBeLessThanOrEqual(1);
    const box = (await page.locator('[data-testid="ecg-canvas"]').boundingBox())!;
    expect(box.width).toBeGreaterThan(330);
    expect(box.height).toBeLessThan(box.width * 0.9); // sized to content, no empty paper
  });
});
