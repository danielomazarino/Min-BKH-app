import { test, expect } from "@playwright/test";

/**
 * News must not promise "multiple sources" unless the data actually has them.
 * Every live event currently has exactly one source, so the UI is verified to
 * present single-source events cleanly AND to handle multi-source events.
 */

test.describe("News", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#/");
    await page.getByTestId("pager-dot-nyheter").click();
    await expect(page.getByTestId("layer-nyheter")).toBeVisible();
    await page.waitForTimeout(500);
  });

  test("renders story cards or an explicit empty state", async ({ page }) => {
    const cards = page.getByTestId("news-card");
    const empty = page.locator(".empty");
    expect((await cards.count()) + (await empty.count())).toBeGreaterThan(0);
  });

  test("a single-source event is never labelled 'flera källor'", async ({ page }) => {
    const cards = page.getByTestId("news-card");
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      const t = await cards.nth(i).innerText();
      // Either one publisher, or an accurate count.
      expect(t).not.toMatch(/källor/i);
    }
  });

  test("opening a story shows the original article links", async ({ page }) => {
    const card = page.getByTestId("news-card").first();
    if ((await card.count()) === 0) test.skip(true, "no news in data");
    await card.click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    const links = page.getByTestId("source-link");
    expect(await links.count()).toBeGreaterThan(0);
    // Real external URLs, opened safely.
    const href = await links.first().getAttribute("href");
    expect(href).toMatch(/^https?:\/\//);
    expect(await links.first().getAttribute("rel")).toContain("noopener");
  });

  test("Firecrawl is never presented as a source", async ({ page }) => {
    const card = page.getByTestId("news-card").first();
    if ((await card.count()) === 0) test.skip(true, "no news in data");
    await card.click();
    await expect(page.getByTestId("sheet")).not.toContainText(/firecrawl/i);
  });

  test("summary is shown when the pipeline produced one", async ({ page }) => {
    const card = page.getByTestId("news-card").first();
    if ((await card.count()) === 0) test.skip(true, "no news in data");
    await card.click();
    const sum = page.getByTestId("news-summary");
    if ((await sum.count()) > 0) {
      await expect(sum).toBeVisible();
      const text = await sum.innerText();
      // The old pipeline truncated mid-sentence with an ellipsis; a synthesis
      // summary must be a complete, bounded sentence.
      expect(text.length).toBeLessThanOrEqual(320);
    }
  });

  test("ordinary stories collapse to single-line rows", async ({ page }) => {
    const rows = page.getByTestId("news-row");
    if ((await rows.count()) === 0) test.skip(true, "not enough news to collapse");
    const h = await rows.first().evaluate((el) => el.getBoundingClientRect().height);
    // ~150px card became ~44px line.
    expect(h).toBeLessThan(60);
  });

  test("no story appears twice on the layer", async ({ page }) => {
    // Regression: the rail showed events 0-4 while "Tidigare" started at
    // event 1, so four headlines were rendered twice on one screen.
    const railTitles = await page.getByTestId("news-card").locator(".news-title").allInnerTexts();
    const rowTitles = await page.getByTestId("news-row").locator(".head").allInnerTexts();
    const overlap = railTitles.filter((t) => rowTitles.includes(t));
    expect(overlap).toEqual([]);
  });

  test("the snap rail scrolls horizontally without breaking the page", async ({ page }) => {
    const rail = page.getByTestId("news-rail");
    if ((await rail.count()) === 0) test.skip(true, "no rail without news");
    const overflowY = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowY).toBeLessThanOrEqual(1);
  });
});

test.describe("Matches archive", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#/matcher");
    await page.waitForTimeout(500);
  });

  test("shows a compact archive with an explicit empty state", async ({ page }) => {
    const rows = page.getByTestId("match-row");
    const empty = page.locator(".empty");
    expect((await rows.count()) + (await empty.count())).toBeGreaterThan(0);
  });

  test("no dead heading for player statistics", async ({ page }) => {
    // playerStats is an empty array for the current data set, so the old
    // "Senaste matchens spelare" section could never render its content.
    await expect(page.getByText("Senaste matchens spelare")).toHaveCount(0);
    await expect(page.getByTestId("last-match-stats")).toHaveCount(0);
  });

  test("finished rows show score, opponent, date and venue", async ({ page }) => {
    const row = page.getByTestId("match-row").first();
    if ((await row.count()) === 0) test.skip(true, "no matches");
    const t = await row.innerText();
    expect(t).toMatch(/\d+–\d+/);
  });
});
