import { defineConfig, devices } from "@playwright/test";

// vite.config.ts pins 1420 (strictPort) for `tauri dev`; the e2e server runs
// on its own port so both can be up at once.
const PORT = Number(process.env.E2E_PORT ?? 1430);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 360, height: 360 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 360 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 360, height: 360 } } },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `${BASE_URL}/tests/e2e/harness.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
