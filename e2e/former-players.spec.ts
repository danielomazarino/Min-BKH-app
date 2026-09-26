import { test, expect } from "@playwright/test";

/**
 * Product rules under test:
 *  - Former players are a search experience, not a directory.
 *  - The CURRENT squad is never listed on the former-player screen.
 *  - Favourites and recent searches are distinct, persistent capabilities.
 */

const SQUAD_NAMES = [
  "Abdoulaye Doumbia",
  "Mikkel Rygaard Jensen",
  "Adrian Svanbäck",
  "Amor Layouni",
  "Brice Wembangomo",
  "Etrit Berisha",
  "Andreas Linde",
  "Olle Samuelsson",
];

test.describe("Former players", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#/tidigare");
    await expect(page.getByTestId("former-page")).toBeVisible();
  });

  test("search is the primary interaction, not a directory", async ({ page }) => {
    const search = page.getByLabel("Sök tidigare Häcken-spelare");
    await expect(search).toBeVisible();
    // Nothing is listed until the user searches or browses.
    await expect(page.getByTestId("former-player")).toHaveCount(0);
  });

  test("the current 2026 squad is NOT rendered as a list here", async ({ page }) => {
    // This is the core product correction. Current players belong to match
    // context; former players are the searchable population.
    await page.waitForTimeout(800);
    for (const name of SQUAD_NAMES) {
      await expect(page.getByText(name, { exact: false })).toHaveCount(0);
    }
    // And there is no "squad"/"trupp" section anywhere on this screen.
    await expect(page.getByTestId("former-page")).not.toContainText("Aktuell trupp");
  });

  test("search finds a former player and opens a detail sheet", async ({ page }) => {
    await page.getByLabel("Sök tidigare Häcken-spelare").fill("Jeremejeff");
    const row = page.getByTestId("former-player").first();
    await expect(row).toBeVisible();
    await row.locator("button.open").click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    // Former-Häcken identity is explicit.
    await expect(page.getByTestId("sheet")).toContainText("Tidigare Häcken-spelare");
  });

  test("alias search works (Frölund is also known as Marek)", async ({ page }) => {
    await page.getByLabel("Sök tidigare Häcken-spelare").fill("Marek");
    await expect(page.getByTestId("former-player")).toHaveCount(1);
    await expect(page.getByTestId("former-player").first()).toContainText("Frölund");
  });

  test("a miss is reported honestly rather than silently", async ({ page }) => {
    await page.getByLabel("Sök tidigare Häcken-spelare").fill("Zzzz nonexistent");
    await expect(page.getByTestId("no-results")).toBeVisible();
  });

  test("favourites persist and are distinct from recent searches", async ({ page }) => {
    await page.getByLabel("Sök tidigare Häcken-spelare").fill("Gustafson");
    await page.getByTestId("former-player").first().locator("button.open").click();
    await page.getByTestId("sheet").getByTestId("fav-toggle").click();
    await page.keyboard.press("Escape");

    await page.reload();
    await expect(page.getByTestId("fav-chip")).toHaveCount(1);
    // The search was remembered as a recent search.
    await expect(page.getByTestId("recent-search")).toHaveCount(1);
  });

  test("browsing by letter works as a secondary mechanism", async ({ page }) => {
    await page.getByTestId("az-letter").first().click();
    await expect(page.getByTestId("former-player").first()).toBeVisible();
    await page.getByTestId("az-clear").click();
  });

  test("the sheet does not imply data the pipeline cannot provide", async ({ page }) => {
    await page.getByLabel("Sök tidigare Häcken-spelare").fill("Jeremejeff");
    await page.getByTestId("former-player").first().locator("button.open").click();
    const sheet = page.getByTestId("sheet");
    // Missing data must be stated, not dressed up.
    await expect(sheet.getByTestId("no-club")).toBeVisible();
    await expect(sheet.getByTestId("no-stats")).toBeVisible();
  });
});
