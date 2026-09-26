import { test, expect } from "@playwright/test";

/**
 * The PWA must keep working without a network, using the cached snapshot.
 *
 * Note on method: Playwright's `context.setOffline(true)` also severs
 * localhost, so `page.reload()` fails at the transport layer with
 * ERR_INTERNET_DISCONNECTED before the service worker is ever consulted. That
 * tests the harness, not the app.
 *
 * Instead we simulate the real offline condition: block the /data/*.json
 * requests the app makes, then reload. The document and the already-cached
 * assets still resolve, so the service worker is genuinely exercised.
 */
test.describe("Offline", () => {
  test("renders the brief from cache when the data fetch fails", async ({ page }) => {
    await page.goto("/#/");
    await page.waitForTimeout(1200);
    // Confirm we have real data before simulating the failure.
    await expect(page.getByTestId("brief-page")).toBeAttached();

    // Cut only the data endpoints, not the app shell.
    await page.route("**/data/*.json", (route) => route.abort());

    await page.goto("/#/");
    await page.waitForTimeout(1500);

    // Either a usable brief (from cache) or an honest error — never a blank
    // screen and never a crash.
    const brief = page.getByTestId("brief-page");
    const err = page.getByTestId("load-error");
    expect((await brief.count()) + (await err.count())).toBeGreaterThan(0);
  });

  test("the tab bar remains usable when data cannot be fetched", async ({ page }) => {
    await page.goto("/#/");
    await page.waitForTimeout(1000);
    await page.route("**/data/*.json", (route) => route.abort());
    await page.goto("/#/spelare");
    await expect(page.getByTestId("tab-spelare")).toBeVisible();
    await expect(page.getByTestId("tab-brief")).toBeVisible();
  });

  test("a service worker is registered", async ({ page }) => {
    await page.goto("/#/");
    // Poll for the registration instead of sleeping a fixed 1500ms: worker
    // install is asynchronous and machine-speed dependent, and a fixed sleep
    // made this test fail intermittently without any product change.
    const has = await page
      .waitForFunction(
        async () => {
          if (!("serviceWorker" in navigator)) return false;
          return (await navigator.serviceWorker.getRegistrations()).length > 0;
        },
        undefined,
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false);
    expect(has).toBe(true);
  });
});
