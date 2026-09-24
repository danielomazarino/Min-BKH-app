import { test, expect } from "@playwright/test";

test.describe("Matches", () => {
  test("shows tabs and match list or empty state", async ({ page }) => {
    await page.goto("/#/matcher");
    await expect(page.getByRole("tab", { name: "Kommande" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Spelade" })).toBeVisible();

    await page.getByRole("tab", { name: "Spelade" }).click();
    const rows = page.getByTestId("match-row");
    const empty = page.locator(".empty");
    expect((await rows.count()) + (await empty.count())).toBeGreaterThan(0);
  });

  test("latest match player statistics render when data exists", async ({ page }) => {
    await page.goto("/#/matcher");
    await page.getByRole("tab", { name: "Spelade" }).click();
    const stats = page.getByTestId("last-match-stats");
    // Stats are optional (depends on API-Football availability); if present,
    // the table must have headers.
    if ((await stats.count()) > 0) {
      await expect(stats.locator("th").first()).toBeVisible();
    }
  });
});
