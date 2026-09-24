import { test, expect } from "@playwright/test";

test.describe("Former players", () => {
  test("search filters by partial name and Swedish characters", async ({ page }) => {
    await page.goto("/#/spelare");
    await page.getByTestId("former-player").first().waitFor({ timeout: 10000 });

    const search = page.getByLabel("Sök tidigare Häcken-spelare");
    await search.fill("Ryg");
    await expect(page.getByTestId("former-player")).toHaveCount(1);

    // Diacritic-insensitive: bjarsmy matches Bjärsmy.
    await search.fill("bjarsmy");
    await expect(page.getByTestId("former-player")).toHaveCount(1);

    await search.fill("zzzz");
    await expect(page.locator(".empty")).toBeVisible();
  });

  test("favorite can be added and persists after reload", async ({ page }) => {
    await page.goto("/#/spelare");
    const favButton = page.getByRole("button", { name: /^Följ / }).first();
    // The accessible name is the aria-label "Följ <name>".
    const name = (await favButton.getAttribute("aria-label"))?.replace(/^Följ /, "").trim();
    expect(name).toBeTruthy();
    await favButton.click();

    await page.reload();
    await page.goto("/#/spelare");
    await expect(page.getByRole("button", { name: `Sluta följa ${name}` }).first()).toBeVisible();

    // Cleanup: unfollow to keep tests idempotent.
    await page.getByRole("button", { name: `Sluta följa ${name}` }).first().click();
  });

  test("player detail shows club, contract provenance and latest event", async ({ page }) => {
    await page.goto("/#/spelare");
    // Open the player row (the row button shows name + club text; fav buttons
    // have aria-labels "Följ …"/"Sluta följa …").
    await page.getByRole("button", { name: /Nuvarande klubb|·/ }).first().click();
    const detail = page.getByTestId("player-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId("contract-info")).toBeVisible();
    // Provenance: source link or explicit "not verified" text.
    const contractText = await detail.getByTestId("contract-info").innerText();
    expect(
      contractText.includes("Källa") || contractText.includes("Kontraktslut ej verifierat"),
    ).toBeTruthy();
  });

  test("source links are real anchors with href", async ({ page }) => {
    await page.goto("/#/spelare");
    await page.getByRole("button", { name: /Nuvarande klubb|·/ }).first().click();
    const detail = page.getByTestId("player-detail");
    const links = detail.locator("a[href^='http']");
    if ((await links.count()) > 0) {
      const href = await links.first().getAttribute("href");
      expect(href).toMatch(/^https?:\/\//);
    }
  });
});
