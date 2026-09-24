import { test, expect } from "@playwright/test";

test.describe("News", () => {
  test("shows news events with summaries and source pills", async ({ page }) => {
    await page.goto("/#/nyheter");
    await page.locator("[data-testid='news-event'], .empty").first().waitFor({ timeout: 10000 });
    const events = page.getByTestId("news-event");
    const empty = page.locator(".empty");
    expect((await events.count()) + (await empty.count())).toBeGreaterThan(0);

    if ((await events.count()) > 0) {
      const first = events.first();
      // Summary visible without external navigation.
      await expect(first.getByTestId("news-summary")).toBeVisible();
      // Source pills exist and open canonical URLs.
      const pills = first.getByTestId("source-pills").locator("a");
      expect(await pills.count()).toBeGreaterThan(0);
      const href = await pills.first().getAttribute("href");
      expect(href).toMatch(/^https?:\/\//);
    }
  });
});
