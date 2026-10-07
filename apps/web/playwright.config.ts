import { defineConfig, devices } from "@playwright/test";

// Next 16 allows one dev server per app directory, so tests reuse a running `npm run dev`
// on :3000 locally, or start one (CI always starts a fresh one).
const PORT = Number(process.env.E2E_PORT ?? 3000);

/**
 * End-to-end tests in a real browser. The chat API is mocked at the network layer
 * (page.route), so runs are deterministic and need no Groq key, Qdrant or Express server.
 * Locally they use your installed Chrome; CI installs Playwright's Chromium.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    channel: process.env.PW_CHANNEL ?? (process.env.CI ? undefined : "chrome"),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
