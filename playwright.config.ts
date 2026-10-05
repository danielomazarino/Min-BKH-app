import { defineConfig } from "@playwright/test";

/**
 * The app is served under the GitHub Pages base path `/Min-BKH-app/`, so the
 * test baseURL must include it. It previously used the bare origin, which made
 * every `page.goto("/#/")` land on a redirect/404 and time out.
 */
const BASE_PATH = "/Min-BKH-app";

export default defineConfig({
  testDir: "./e2e",
  // 45s was sized when only chromium ran, and never fit a loaded runner once
  // BOTH browser projects executed fully in parallel: a different test would
  // time out each run, always a different one, always on something that is
  // merely LATE rather than wrong. Those tests all pass in isolation and on a
  // quiet machine, which is exactly the signature of a budget problem.
  timeout: 90_000,
  // Retries were already 1 in CI. What that bought was almost nothing, because
  // the retry inherits the same loaded machine and the same budget.
  retries: process.env.CI ? 1 : 0,
  // WHY WORKERS ARE CAPPED.
  //
  // Playwright defaults to roughly half the CPU count, and this suite runs the
  // whole spec set for TWO browser projects. On a 2-core runner that is real
  // oversubscription: several browsers competing for CPU while each is waiting
  // on animations and network stubs. The failures that produces are not flaky
  // assertions — they are correct tests that ran out of wall clock.
  //
  // Capping to 2 keeps both engines covered while stopping the thrash. Reducing
  // total time is a side effect; the point is that each test gets a fair share
  // of the machine.
  workers: 2,
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
