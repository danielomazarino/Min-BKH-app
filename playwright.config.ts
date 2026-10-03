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
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    // WHY WEBKIT IS A SEPARATE PROJECT NOW
    //
    // The nav swipe is the feature most likely to differ between engines, and
    // Chromium alone cannot see WebKit's behaviour. WebKit here is Playwright's
    // WebKit build, which is much closer to real iOS Safari than Chromium is —
    // though still not the same thing.
    //
    // WHAT THIS IS NOT: native gesture verification. Playwright's CDP touch
    // injection is Chromium-only (`newCDPSession` throws in WebKit), so in the
    // WebKit project the touch helper dispatches synthetic PointerEvents.
    // Synthetic events exercise the app's own logic and WebKit's CSS and event
    // handling, but they bypass WebKit's NATIVE gesture recognition — the
    // layer that decides scroll-versus-drag and raises the link callout.
    //
    // So a green WebKit run is evidence about OUR LOGIC, not about iOS. Only a
    // real iPhone can verify the gesture itself. See docs/ENHANCEMENTS.md.
    {
      name: "webkit",
      use: {
        browserName: "webkit",
        // A phone-sized viewport, and touch, so the media queries and the
        // touch-action arbitration are exercised at the size that matters.
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 3,
      },
    },
  ],
});
