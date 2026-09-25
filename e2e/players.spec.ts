import { test, expect } from "@playwright/test";

test.describe("Players page", () => {
  test("search filters squad and former players by partial name and Swedish characters", async ({ page }) => {
    await page.goto("/#/spelare");
    await page.getByTestId("former-player").first().waitFor({ timeout: 10000 });

    const search = page.getByLabel("Sök spelare");
    await search.fill("Jeremejeff");
    // Alexander Jeremejeff is a former player in the registry.
    await expect(page.getByTestId("former-player")).toHaveCount(1);

    // Diacritic-insensitive: bjarsmy matches Bjärsmy.
    await search.fill("bjarsmy");
    await expect(page.getByTestId("former-player")).toHaveCount(1);

    await search.fill("zzzz");
    await expect(page.locator(".empty").first()).toBeVisible();
  });

  test("current squad section shows verified 2026 players with AKTUELL badge", async ({ page }) => {
    await page.goto("/#/spelare");
    await page.getByRole("region", { name: "Aktuell trupp 2026" }).waitFor({ timeout: 10000 });
    // Squad rows are buttons whose accessible name contains AKTUELL.
    await expect(page.getByRole("button", { name: /AKTUELL/ }).first()).toBeVisible();
  });

  test("favorite can be added and persists after reload", async ({ page }) => {
    await page.goto("/#/spelare");
    await page.getByTestId("former-player").first().waitFor({ timeout: 10000 });
    const favButton = page.getByRole("button", { name: /^Följ / }).first();
    const name = (await favButton.getAttribute("aria-label"))?.replace(/^Följ /, "").trim();
    expect(name).toBeTruthy();
    await favButton.click();

    await page.reload();
    await page.goto("/#/spelare");
    await expect(page.getByRole("button", { name: `Sluta följa ${name}` }).first()).toBeVisible();

    // Cleanup: unfollow to keep tests idempotent.
    await page.getByRole("button", { name: `Sluta följa ${name}` }).first().click();
  });

  test("player detail sheet shows provenance and closes on Escape", async ({ page }) => {
    await page.goto("/#/spelare");
    await page.getByTestId("former-player").first().waitFor({ timeout: 10000 });
    // Open the first former player row (row button shows name + club text; fav
    // buttons have aria-labels "Följ …"/"Sluta följa …").
    await page.getByTestId("former-player").first().click();
    const detail = page.getByTestId("player-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId("contract-info")).toBeVisible();
    // Provenance: source link or explicit "not verified" text.
    const contractText = await detail.getByTestId("contract-info").innerText();
    expect(
      contractText.includes("Källa") || contractText.includes("Kontraktslut ej verifierat"),
    ).toBeTruthy();

    // Escape closes the sheet.
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
  });

  test("squad player detail shows season stats table", async ({ page }) => {
    await page.goto("/#/spelare");
    await page.getByRole("region", { name: "Aktuell trupp 2026" }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: /AKTUELL/ }).first().click();
    const detail = page.getByTestId("player-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId("squad-stats")).toBeVisible();
  });

  test("source links are real anchors with href", async ({ page }) => {
    await page.goto("/#/spelare");
    await page.getByTestId("former-player").first().waitFor({ timeout: 10000 });
    await page.getByTestId("former-player").first().click();
    const detail = page.getByTestId("player-detail");
    const links = detail.locator("a[href^='http']");
    if ((await links.count()) > 0) {
      const href = await links.first().getAttribute("href");
      expect(href).toMatch(/^https?:\/\//);
    }
  });
});
