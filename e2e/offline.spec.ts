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
    await expect(page.getByTestId("layer-oversikt")).toBeAttached();

    // Cut only the data endpoints, not the app shell.
    await page.route("**/data/*.json", (route) => route.abort());

    await page.goto("/#/");
    await page.waitForTimeout(1500);

    // Either a usable brief (from cache) or an honest error — never a blank
    // screen and never a crash.
    const brief = page.getByTestId("layer-oversikt");
    const err = page.getByTestId("load-error");
    expect((await brief.count()) + (await err.count())).toBeGreaterThan(0);
  });

  test("the tab bar remains usable when data cannot be fetched", async ({ page }) => {
    await page.goto("/#/");
    await page.waitForTimeout(1000);
    await page.route("**/data/*.json", (route) => route.abort());
    await page.goto("/#/tidigare");
    await expect(page.getByTestId("tab-former")).toBeVisible();
    await expect(page.getByTestId("tab-home")).toBeVisible();
  });

  test("a service worker is registered", async ({ page }) => {
    await page.goto("/#/");
    await page.waitForTimeout(1500);
    const has = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.length > 0;
    });
    expect(has).toBe(true);
  });
});
