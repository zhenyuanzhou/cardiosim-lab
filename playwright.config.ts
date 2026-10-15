import { defineConfig, devices } from "@playwright/test";

// Run with: npm run test:e2e   (first time on a new machine: npx playwright install chromium)
// Set PW_CHROMIUM_PATH to use an already-installed Chromium binary instead.
export default defineConfig({
  testDir: "tests/integration",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5179",
    viewport: { width: 1600, height: 950 },
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 950 } } }],
  webServer: {
    command: "npx vite --port 5179 --strictPort",
    url: "http://localhost:5179",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
