import { test, expect } from "@playwright/test";

test.describe("Offline / cached state", () => {
  test("app shell loads and data fetch failure shows graceful message, not blank", async ({ page }) => {
    // Block data requests to simulate source failure.
    await page.route("**/data/*.json", (route) => route.abort());
    await page.goto("/#/");
    // The app must show either cached data or an explicit error message.
    const error = page.locator(".empty");
    await expect(error.first()).toBeVisible({ timeout: 10000 });
    const text = await error.first().innerText();
    expect(text.length).toBeGreaterThan(0);
  });
});
