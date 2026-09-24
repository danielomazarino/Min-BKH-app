import { test, expect } from "@playwright/test";

test.describe("Home", () => {
  test("loads and shows next match, latest result, warnings and news", async ({ page }) => {
    await page.goto("/#/");

    // Next match section renders (with real generated data or empty state).
    await expect(page.getByRole("heading", { name: "Nästa match" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Varningar & avstängningar" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Senaste resultatet" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Senaste nyheterna" })).toBeVisible();

    // Either real data or a deliberate empty state — never a blank screen.
    const nextMatch = page.getByTestId("next-match");
    const empty = page.locator(".empty");
    expect((await nextMatch.count()) + (await empty.count())).toBeGreaterThan(0);
  });

  test("warning status shows suspended/at-risk or explicit none", async ({ page }) => {
    await page.goto("/#/");
    await page.locator("[data-testid='warnings'], .empty").first().waitFor({ timeout: 10000 });
    const warnings = page.getByTestId("warnings");
    const empty = page.locator(".empty");
    expect((await warnings.count()) + (await empty.count())).toBeGreaterThan(0);
  });

  test("stale note shows last updated time", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByTestId("stale-note")).toContainText("Senast uppdaterad");
  });
});
