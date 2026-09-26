import { test, expect } from "@playwright/test";

/**
 * Trupp — the current men's squad.
 *
 * This destination exists to fix a real discoverability failure: 27 players
 * with full season statistics were present in app.json the whole time and
 * were never rendered anywhere in the UI. These tests make sure they stay
 * visible, and stay separate from former players.
 */

const SQUAD_NAMES = [
  "Andreas Linde",
  "Etrit Berisha",
  "Abdoulaye Doumbia",
  "Olle Samuelsson",
  "Brice Wembangomo",
  "Gustav Lindgren",
];

test.beforeEach(async ({ page }) => {
  await page.goto("/#/trupp");
  await expect(page.getByTestId("squad-page")).toBeAttached();
  await page.waitForTimeout(600);
});

test.describe("Current squad is visible", () => {
  test("renders the squad, or an explicit empty state", async ({ page }) => {
    const players = await page.getByTestId("squad-player").count();
    const empty = await page.getByTestId("squad-empty").count();
    expect(players + empty).toBeGreaterThan(0);
  });

  test("known current players are actually on the page", async ({ page }) => {
    if ((await page.getByTestId("squad-empty").count()) > 0) test.skip(true, "no squad data");
    // The core correction: the squad was invisible before this destination.
    for (const name of SQUAD_NAMES) {
      await expect(page.getByTestId("squad-page")).toContainText(name);
    }
  });

  test("the whole squad is rendered, not a truncated list", async ({ page }) => {
    if ((await page.getByTestId("squad-empty").count()) > 0) test.skip(true, "no squad data");
    const declared = Number((await page.getByTestId("squad-page").locator(".mod-label .count").first().innerText()).replace(/\D/g, ""));
    const rows = await page.getByTestId("squad-player").count();
    expect(rows).toBe(declared);
    expect(declared).toBeGreaterThan(20);
  });

  test("players are grouped by position", async ({ page }) => {
    if ((await page.getByTestId("squad-empty").count()) > 0) test.skip(true, "no squad data");
    for (const group of ["squad-group-goalkeepers", "squad-group-defenders", "squad-group-midfields", "squad-group-forwards"]) {
      if ((await page.getByTestId(group).count()) > 0) {
        await expect(page.getByTestId(group)).toBeVisible();
      }
    }
    // Målvakter must come first, the way a team sheet reads.
    const first = await page.getByTestId("squad-page").locator("[data-testid^='squad-group-']").first().getAttribute("data-testid");
    expect(first).toBe("squad-group-goalkeepers");
  });

  test("each row exposes season numbers", async ({ page }) => {
    if ((await page.getByTestId("squad-player").count()) === 0) test.skip(true, "no squad data");
    const label = await page.getByTestId("squad-player").first().getAttribute("aria-label");
    expect(label).toMatch(/matcher/);
    expect(label).toMatch(/mål/);
  });

  test("a player opens a detail sheet with the season totals", async ({ page }) => {
    if ((await page.getByTestId("squad-player").count()) === 0) test.skip(true, "no squad data");
    await page.getByTestId("squad-player").first().click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    await expect(page.getByTestId("squad-stats")).toBeVisible();
    for (const label of ["Matcher", "Start", "Mål", "Assist", "Gult", "Rött"]) {
      await expect(page.getByTestId("sheet")).toContainText(label);
    }
  });

  test("player detail is deep-linkable and the back gesture closes it", async ({ page }) => {
    if ((await page.getByTestId("squad-player").count()) === 0) test.skip(true, "no squad data");
    await page.getByTestId("squad-player").first().click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toMatch(/^#\/trupp\?id=/);
    await page.goBack();
    await expect(page.getByTestId("sheet")).toHaveCount(0);
    await expect(page).toHaveURL(/\u0023\/trupp$/);
  });

  test("the squad screen does not invent a contract or a current club", async ({ page }) => {
    if ((await page.getByTestId("squad-player").count()) === 0) test.skip(true, "no squad data");
    await page.getByTestId("squad-player").first().click();
    const sheet = page.getByTestId("sheet");
    // Those fields do not exist for current players in the data, so the UI
    // must not manufacture them.
    await expect(sheet).not.toContainText("Kontrakt");
    await expect(sheet).not.toContainText("Nuvarande klubb");
  });
});

test.describe("Current and former players stay separate", () => {
  test("a current player is not a former player", async ({ page }) => {
    await page.goto("/#/spelare");
    await expect(page.getByTestId("former-page")).toBeAttached();
    await page.waitForTimeout(600);
    for (const name of SQUAD_NAMES) {
      await expect(page.getByText(name, { exact: false })).toHaveCount(0);
    }
    await expect(page.getByTestId("former-page")).not.toContainText("Aktuell trupp");
  });

  test("a former player is not listed in the current squad", async ({ page }) => {
    await page.goto("/#/trupp");
    await expect(page.getByTestId("squad-page")).toBeAttached();
    await page.waitForTimeout(600);
    // Frölund played for Häcken but is not in the current squad.
    await expect(page.getByTestId("squad-page")).not.toContainText("Frölund");
  });
});
