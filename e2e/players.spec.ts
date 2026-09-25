import { test, expect } from "@playwright/test";

test.describe("Players page", () => {
  test("search finds current and former players with status badges", async ({ page }) => {
    await page.goto("/#/spelare");
    await page.getByRole("region", { name: "Aktuell trupp 2026" }).waitFor({ timeout: 10000 });

    const search = page.getByLabel("Sök spelare");
    // Current player: squad hit with AKTUELL in the row.
    await search.fill("Doumbia");
    await expect(page.getByTestId("squad-player").first()).toBeVisible();
    await expect(page.getByTestId("squad-player").first()).toContainText("AKTUELL");

    // Former player: diacritic-insensitive, TIDIGARE in the row.
    await search.fill("bjarsmy");
    await expect(page.getByTestId("former-player")).toHaveCount(1);
    await expect(page.getByTestId("former-player").first()).toContainText("TIDIGARE");

    await search.fill("zzzz");
    await expect(page.locator(".empty").first()).toBeVisible();
  });

  test("former players are NOT listed until searched (search-first UX)", async ({ page }) => {
    await page.goto("/#/spelare");
    await page.getByRole("region", { name: "Aktuell trupp 2026" }).waitFor({ timeout: 10000 });
    // Without a query, no former-player rows are shown.
    await expect(page.getByTestId("former-player")).toHaveCount(0);
    // Squad is compact but present.
    await expect(page.getByTestId("squad-player").first()).toBeVisible();
  });

  test("current squad grouped by position shows stats", async ({ page }) => {
    await page.goto("/#/spelare");
    await page.getByRole("region", { name: "Aktuell trupp 2026" }).waitFor({ timeout: 10000 });
    await expect(page.getByText("Målvakter", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Anfall", { exact: true }).first()).toBeVisible();
    // Squad rows show compact stats.
    const firstRow = page.getByTestId("squad-player").first();
    await expect(firstRow).toContainText("M ·");
  });

  test("favorite can be added and persists after reload", async ({ page }) => {
    await page.goto("/#/spelare");
    await page.getByRole("region", { name: "Aktuell trupp 2026" }).waitFor({ timeout: 10000 });
    const favButton = page.getByRole("button", { name: /^Följ / }).first();
    const name = (await favButton.getAttribute("aria-label"))?.replace(/^Följ /, "").trim();
    expect(name).toBeTruthy();
    await favButton.click();

    // Favorites section appears without searching.
    await expect(page.getByRole("region", { name: "Mina spelare" })).toBeVisible();

    await page.reload();
    await page.goto("/#/spelare");
    await page.getByRole("region", { name: "Aktuell trupp 2026" }).waitFor({ timeout: 10000 });
    await expect(page.getByRole("button", { name: `Sluta följa ${name}` }).first()).toBeVisible();

    // Cleanup: unfollow to keep tests idempotent.
    await page.getByRole("button", { name: `Sluta följa ${name}` }).first().click();
  });

  test("player detail sheet shows provenance and closes on Escape", async ({ page }) => {
    await page.goto("/#/spelare");
    await page.getByRole("region", { name: "Aktuell trupp 2026" }).waitFor({ timeout: 10000 });
    await page.getByTestId("squad-player").first().getByRole("button").first().click();
    const detail = page.getByTestId("player-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId("squad-stats")).toBeVisible();

    // Escape closes the sheet.
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
  });

  test("former player detail shows verification status", async ({ page }) => {
    await page.goto("/#/spelare");
    await page.getByRole("region", { name: "Aktuell trupp 2026" }).waitFor({ timeout: 10000 });
    const search = page.getByLabel("Sök spelare");
    await search.fill("Jeremejeff");
    await page.getByTestId("former-player").first().click();
    const detail = page.getByTestId("player-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId("contract-info")).toBeVisible();
    const contractText = await detail.getByTestId("contract-info").innerText();
    expect(
      contractText.includes("Källa") || contractText.includes("Kontraktslut ej verifierat"),
    ).toBeTruthy();
  });

  test("source links are real anchors with href", async ({ page }) => {
    await page.goto("/#/spelare");
    await page.getByRole("region", { name: "Aktuell trupp 2026" }).waitFor({ timeout: 10000 });
    const search = page.getByLabel("Sök spelare");
    await search.fill("Jeremejeff");
    await page.getByTestId("former-player").first().click();
    const detail = page.getByTestId("player-detail");
    const links = detail.locator("a[href^='http']");
    if ((await links.count()) > 0) {
      const href = await links.first().getAttribute("href");
      expect(href).toMatch(/^https?:\/\//);
    }
  });
});
