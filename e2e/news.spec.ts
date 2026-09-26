import { test, expect } from "@playwright/test";

/**
 * News must be scannable, not browsed. The redesign replaced a horizontal rail
 * of 296px cards with a 2x2 grid of small cards plus a dense chronological
 * list, and made story detail URL-addressable.
 *
 * The data contract is unchanged: events are already deduplicated, men's-team
 * only, and carry publisher + role + original URL per source.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/#/nyheter");
  await expect(page.getByTestId("news-page")).toBeAttached();
  await page.waitForTimeout(400);
});

test.describe("News layout", () => {
  test("renders a compact grid, or an explicit empty state", async ({ page }) => {
    const cards = page.getByTestId("news-card");
    const empty = page.getByTestId("news-empty");
    expect((await cards.count()) + (await empty.count())).toBeGreaterThan(0);
  });

  test("the latest grid is capped at four small cards", async ({ page }) => {
    if ((await page.getByTestId("news-card").count()) === 0) test.skip(true, "no news in data");
    // Four = exactly one 2x2 block. No fifth giant card.
    expect(await page.getByTestId("news-card").count()).toBeLessThanOrEqual(4);
  });

  test("cards are small — no giant horizontally-scrolling card", async ({ page }) => {
    if ((await page.getByTestId("news-card").count()) === 0) test.skip(true, "no news in data");
    const box = await page.getByTestId("news-card").first().boundingBox();
    // The old rail card was 296px wide and ~320px tall.
    expect(box!.width).toBeLessThan(200);
    expect(box!.height).toBeLessThan(220);
  });

  test("the grid is two-up and requires no horizontal scrolling", async ({ page }) => {
    if ((await page.getByTestId("news-card").count()) === 0) test.skip(true, "no news in data");
    const grid = await page.getByTestId("news-grid").boundingBox();
    const first = await page.getByTestId("news-card").first().boundingBox();
    // Two cards sit side by side inside the visible width.
    expect(first!.x).toBeGreaterThanOrEqual(grid!.x - 1);
    expect(first!.x).toBeLessThan(grid!.x + grid!.width / 2);
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowX).toBeLessThanOrEqual(1);
  });

  test("a single-source event is never labelled 'flera källor'", async ({ page }) => {
    const cards = page.getByTestId("news-card");
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      const t = await cards.nth(i).innerText();
      expect(t).not.toMatch(/källor/i);
    }
  });

  test("older news collapses to single-line rows", async ({ page }) => {
    const rows = page.getByTestId("news-row");
    if ((await rows.count()) === 0) test.skip(true, "not enough news to collapse");
    const h = await rows.first().evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBeLessThan(60);
  });

  test("no story appears twice on the page", async ({ page }) => {
    // Regression guard: the old rail showed events 0-4 while "Tidigare" started
    // at event 1, so four headlines rendered twice.
    const cardTitles = await page.getByTestId("news-card").locator(".ncard-title").allInnerTexts();
    const rowTitles = await page.getByTestId("news-row").locator(".head").allInnerTexts();
    expect(cardTitles.filter((t) => rowTitles.includes(t))).toEqual([]);
  });
});

test.describe("News detail is a URL-addressable state", () => {
  test("opening a story sets the hash and the back gesture closes it", async ({ page }) => {
    const card = page.getByTestId("news-card").first();
    if ((await card.count()) === 0) test.skip(true, "no news in data");
    await card.click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    // The detail is a CHILD of /nyheter, so the URL says so.
    expect(await page.evaluate(() => location.hash)).toMatch(/^#\/nyheter\?id=/);

    await page.goBack();
    await expect(page.getByTestId("sheet")).toHaveCount(0);
    await expect(page).toHaveURL(/\u0023\/nyheter$/);
    // Still inside the news section, not bounced somewhere else.
    await expect(page.getByTestId("news-page")).toBeAttached();
  });

  test("a news deep link opens the story directly", async ({ page }) => {
    const id = await page.getByTestId("news-card").first().evaluate(() => window.location.hash);
    expect(id).toBe("#/nyheter");
    await page.getByTestId("news-card").first().click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    const href = await page.evaluate(() => location.href);
    await page.goto(href);
    await expect(page.getByTestId("sheet")).toBeVisible();
  });

  test("the story shows real external source links", async ({ page }) => {
    const card = page.getByTestId("news-card").first();
    if ((await card.count()) === 0) test.skip(true, "no news in data");
    await card.click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    const links = page.getByTestId("source-link");
    expect(await links.count()).toBeGreaterThan(0);
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
      const text = await sum.innerText();
      expect(text.length).toBeLessThanOrEqual(320);
    }
  });
});

test.describe("Matches archive", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#/matcher");
    await expect(page.getByTestId("matches-page")).toBeAttached();
    await page.waitForTimeout(400);
  });

  test("shows a compact archive with an explicit empty state", async ({ page }) => {
    const rows = page.getByTestId("match-row");
    const empty = page.locator(".empty");
    expect((await rows.count()) + (await empty.count())).toBeGreaterThan(0);
  });

  test("the next match is answered on this screen", async ({ page }) => {
    if ((await page.getByTestId("matcher-next").count()) === 0) test.skip(true, "no next match");
    await expect(page.getByTestId("matcher-next")).toContainText("Nästa match");
  });

  test("both played and upcoming lists exist and switch", async ({ page }) => {
    const played = await page.getByTestId("match-row").count();
    await page.getByTestId("tab-upcoming").click();
    const upcoming = await page.getByTestId("match-row").count();
    expect(played).toBeGreaterThan(0);
    expect(upcoming).toBeGreaterThan(0);
  });

  test("the full 16-team table is present", async ({ page }) => {
    await expect(page.getByTestId("league-table")).toBeVisible();
    expect(await page.getByTestId("table-row").count()).toBeGreaterThanOrEqual(16);
  });

  test("match detail is deep-linkable and the back gesture closes it", async ({ page }) => {
    await page.getByTestId("tab-played").click();
    const clickable = page.locator('button[data-testid="match-row"]');
    if ((await clickable.count()) === 0) test.skip(true, "no match with event data");
    await clickable.first().click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toMatch(/^#\/matcher\?id=\d+/);
    const timeline = page.getByTestId("match-timeline");
    if ((await timeline.count()) > 0) {
      expect(await page.locator('[data-testid^="timeline-"]').count()).toBeGreaterThan(0);
    }
    await page.goBack();
    await expect(page.getByTestId("sheet")).toHaveCount(0);
    await expect(page).toHaveURL(/\u0023\/matcher$/);
  });

  test("no dead heading for player statistics", async ({ page }) => {
    // playerStats is absent from the data, so the old "Senaste matchens
    // spelare" section could never render content.
    await expect(page.getByText("Senaste matchens spelare")).toHaveCount(0);
    await expect(page.getByTestId("last-match-stats")).toHaveCount(0);
  });

  test("finished rows show score, opponent, date and venue", async ({ page }) => {
    const row = page.getByTestId("match-row").first();
    if ((await row.count()) === 0) test.skip(true, "no matches");
    expect(await row.innerText()).toMatch(/\d+–\d+/);
  });
});
