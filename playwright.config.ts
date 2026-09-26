import { defineConfig } from "@playwright/test";

/**
 * The app is served under the GitHub Pages base path `/Min-BKH-app/`, so the
 * test baseURL must include it. It previously used the bare origin, which made
 * every `page.goto("/#/")` land on a redirect/404 and time out.
 */
const BASE_PATH = "/Min-BKH-app";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:4173${BASE_PATH}`,
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    port: 4173,
    // Always boot a server for the CURRENT dist. Reusing a leftover server
    // silently tests a stale bundle, which is what produced a whole misleading
    // failing run while iterating on this redesign.
    reuseExistingServer: false,
    timeout: 60000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
