import { test, expect } from "@playwright/test";

test.describe("News", () => {
  test("shows news items with source attribution or empty state", async ({ page }) => {
    await page.goto("/#/nyheter");
    // Wait for either news items or the empty state — count() is an instant
    // snapshot and can race React's async data commit.
    await page.locator("[data-testid='news-item'], .empty").first().waitFor({ timeout: 10000 });
    const items = page.getByTestId("news-item");
    const empty = page.locator(".empty");
    expect((await items.count()) + (await empty.count())).toBeGreaterThan(0);

    if ((await items.count()) > 0) {
      const first = items.first();
      await expect(first.locator("a")).toBeVisible();
      // Source attribution (publisher) is visible.
      await expect(first.locator(".meta")).toContainText("·");
    }
  });
});
