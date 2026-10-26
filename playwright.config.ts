import { defineConfig } from "@playwright/test";

// End-to-end tests against the dev server, in Microsoft Edge (installed with Windows, so no
// browser download). Set E2E_BASE_URL to test another server, E2E_CHANNEL=chrome for Chrome,
// and add --headed (or --ui) to watch the browser.
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: process.env.E2E_CHANNEL ?? "msedge",
    trace: "retain-on-failure",
    // For live demos: E2E_SLOWMO=600 pauses that many ms between actions so people can follow.
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO) || 0 },
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
