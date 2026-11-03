import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against local Supabase (`npm run db:start`) and, for the XES and BPMN
 * steps, a local miner (skipped when MINER_URL isn't reachable). See e2e/README in
 * docs/handover-pack.md. Locally they drive the installed Google Chrome; CI installs Chromium.
 */
const PORT = Number(process.env.E2E_PORT ?? 3000);

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    channel: process.env.CI ? undefined : "chrome",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "phone", use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }, grep: /@phone/ },
  ],
  webServer: {
    // A production build in CI; the dev server locally (reused if one is already running).
    command: process.env.CI ? `npm run build && npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
