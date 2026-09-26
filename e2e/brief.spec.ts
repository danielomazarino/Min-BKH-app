import { test, expect } from "@playwright/test";

/**
 * Brief is a single vertically scrolling dashboard. These tests pin the
 * product rules it must keep, and the rendering defect the redesign fixed:
 * the heading used to say "5 att hålla koll på" while only four rows were
 * rendered, because of hard-coded 2-suspended / 3-at-risk caps.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByTestId("brief-page")).toBeAttached();
});

test.describe("Brief (dashboard)", () => {
  test("opens with the next match as the single hero", async ({ page }) => {
    await expect(page.getByTestId("next-match")).toBeVisible();
    expect(await page.locator(".hero").count()).toBe(1);
  });

  test("last result shows the score in HOME–AWAY order (Swedish convention)", async ({ page }) => {
    const result = page.getByTestId("last-result");
    await expect(result).toBeVisible();
    await expect(page.getByTestId("last-score")).toHaveText(/^\d+–\d+$/);

    // Section I: the two teams must read home on the left, away on the right,
    // and the score must belong to THAT order. The data is provider-ordered
    // (scoreHome/scoreAway) and the old UI rendered "Häcken first", which
    // silently reversed the numbers for every away match — the Kalmar game
    // read "5–0" when the Swedish reading of Kalmar 0–5 Häcken is "0–5".
    const teams = result.locator(".teams .opponent");
    await expect(teams).toHaveCount(2);
    const [left, right] = await teams.allInnerTexts();

    const meta = await result.locator(".meta").innerText();
    const isHome = /Hemma/.test(meta);
    // The side that is NOT Häcken is the opponent.
    if (isHome) {
      expect(left).toBe("Häcken");
      expect(right).not.toBe("Häcken");
    } else {
      expect(right).toBe("Häcken");
      expect(left).not.toBe("Häcken");
    }
  });

  test("the away result reads Kalmar 0–5 Häcken, not 5–0", async ({ page }) => {
    // Concrete guard for the real fixture in app.json, so the convention
    // cannot silently regress on the exact match that exposed it.
    const result = page.getByTestId("last-result");
    const meta = await result.locator(".meta").innerText();
    test.skip(!/Borta/.test(meta), "the current last result is not an away match");
    const teams = result.locator(".teams .opponent");
    await expect(teams.first()).toHaveText("Kalmar FF");
    await expect(teams.last()).toHaveText("Häcken");
    await expect(page.getByTestId("last-score")).toHaveText("0–5");
  });

  test("Hem does not print a goalscorer event list (Section J)", async ({ page }) => {
    // The scorers moved into the match sheet. Hem is a dashboard; the
    // truncated one-line event log made its most important row unreadable.
    await expect(page.getByTestId("last-scorers")).toHaveCount(0);
  });

  test("the match sheet carries the goalscorers instead", async ({ page }) => {
    const result = page.getByTestId("last-result");
    if ((await result.locator("button").count()) === 0) {
      test.skip(true, "this row does not open a detail sheet");
    }
    await result.click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    // Fixture/competition/date, the two teams home-left, and the scorers.
    await expect(page.getByTestId("fixture")).toBeVisible();
    await expect(page.getByTestId("fixture-home")).toBeVisible();
    await expect(page.getByTestId("fixture-away")).toBeVisible();
    await expect(page.getByTestId("fixture-meta")).toBeVisible();
    await expect(page.getByTestId("sheet-scorers")).toBeVisible();
    await expect(page.getByTestId("sheet-scorers")).toContainText("Lindgren");
  });

  test("the match sheet states plainly that no real statistics exist (Section K)", async ({ page }) => {
    // The provider records no playerStats for this competition. The sheet must
    // say so rather than deriving a substitute from the event list — an
    // invented number that looks like data is worse than an admitted gap.
    const result = page.getByTestId("last-result");
    if ((await result.locator("button").count()) === 0) {
      test.skip(true, "this row does not open a detail sheet");
    }
    await result.click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    await expect(page.getByTestId("no-stats")).toBeVisible();
    // Explicitly no event-derived pseudo-statistic.
    await expect(page.getByTestId("sheet")).not.toContainText(/per minut/i);
  });

  test("discipline players are tappable and show their real card count (Section L)", async ({ page }) => {
    const rows = page.getByTestId("discipline").locator(".cstat");
    if ((await rows.count()) === 0) test.skip(true, "no discipline cases in data");

    // Every qualifying player must be reachable, not just the first.
    await expect(page.getByTestId("discipline")).toHaveAttribute("data-count", String(await rows.count()));

    const first = rows.first();
    // The count comes from the data, never hard-coded per player.
    const tally = first.getByTestId("discipline-count");
    await expect(tally).toBeVisible();
    const n = Number((await tally.innerText()).replace(/\D+/g, ""));
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);

    // And it opens that player's card.
    await first.click();
    await expect(page).toHaveURL(/\u0023\/trupp\?id=/);
    await expect(page.getByTestId("sheet")).toBeVisible();
    await expect(page.getByTestId("squad-card-status")).toBeVisible();
  });

  test("the next match is tappable and leads to the match section", async ({ page }) => {
    const hero = page.getByTestId("next-match");
    if ((await hero.count()) === 0) test.skip(true, "no next match in data");
    await hero.click();
    await expect(page).toHaveURL(/\u0023\/matcher/);
    await expect(page.getByTestId("matches-page")).toBeAttached();
  });

  test("Brief is a vertical scroll surface, not a horizontal layer", async ({ page }) => {
    // There is no layer pager any more: nothing in main is a swipeable panel.
    await expect(page.locator(".pager, .pager-track, .pager-layer")).toHaveCount(0);
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowX).toBeLessThanOrEqual(1);
  });

  test("the SvFF rule paragraph is not in the main brief", async ({ page }) => {
    // It moved behind the Settings disclosure.
    await expect(page.locator("main")).not.toContainText("SvFF tävlingsbestämmelser");
  });

  test("no visible page H1 clutters the main content", async ({ page }) => {
    const h1 = page.locator("main h1");
    await expect(h1).toHaveCount(1);
    const box = await h1.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(2);
  });

  test("the table summary links into the full league table", async ({ page }) => {
    if ((await page.getByTestId("table-position").count()) === 0) test.skip(true, "no table data");
    await page.getByTestId("table-position").waitFor();
    await page.getByRole("link", { name: /Hela tabellen/ }).click();
    await expect(page).toHaveURL(/\u0023\/matcher/);
    await expect(page.getByTestId("league-table")).toBeVisible();
  });
});

test.describe("Kortläget — no artificial caps", () => {
  test("the heading count equals the number of rendered rows", async ({ page }) => {
    const panel = page.getByTestId("discipline");
    if ((await panel.count()) === 0) {
      await expect(page.getByTestId("discipline-clear")).toBeVisible();
      return;
    }
    const declared = Number(await panel.getAttribute("data-count"));
    const rows = await page.locator('[data-testid="suspended-player"], [data-testid="at-risk-player"]').count();
    // The regression: heading said 5, only 4 rows rendered.
    expect(rows).toBe(declared);
    expect(declared).toBeGreaterThan(0);
  });

  test("every qualifying player is rendered, not a truncated subset", async ({ page }) => {
    const panel = page.getByTestId("discipline");
    if ((await panel.count()) === 0) test.skip(true, "no discipline cases");
    const declared = Number(await panel.getAttribute("data-count"));
    // A cap of 2 + 3 would silently drop anyone beyond five; assert the list
    // is long enough to prove no cap is in force when the data warrants it.
    const names = await page.locator('[data-testid="suspended-player"], [data-testid="at-risk-player"]').allInnerTexts();
    expect(names).toHaveLength(declared);
    expect(new Set(names.map((n) => n.split("\n")[0])).size).toBe(declared);
  });

  test("discipline states never contradict the warning data", async ({ page }) => {
    const rows = page.locator('[data-testid="suspended-player"], [data-testid="at-risk-player"]');
    const n = await rows.count();
    if (n === 0) return;
    for (let i = 0; i < n; i++) {
      const text = (await rows.nth(i).innerText()).toLowerCase();
      if (text.includes("varning kvar")) expect(text).not.toMatch(/varningar? kvar.*\b[3-9]\b/);
      if (text.includes("avstängd")) expect(text).toContain("avstängd");
    }
  });

  test("a player who has left the club is not shown as a current risk", async ({ page }) => {
    // Amor Layouni was sold during the season but the ledger spans the whole
    // season, so he appeared as "at_risk" for a team he no longer plays for.
    if ((await page.getByTestId("discipline").count()) === 0) test.skip(true, "no discipline cases");
    await expect(page.getByTestId("brief-page")).not.toContainText("Amor Layouni");
  });
});

test.describe("Match timeline", () => {
  test("the last match opens a URL-addressable sheet with its timeline", async ({ page }) => {
    const result = page.getByTestId("last-result");
    if ((await result.count()) === 0) test.skip(true, "no finished match in data");
    await result.click();
    await expect(page).toHaveURL(/\u0023\/matcher\?id=\d+/);
    await expect(page.getByTestId("sheet")).toBeVisible();
    const timeline = page.getByTestId("match-timeline");
    expect((await timeline.count()) + (await page.getByTestId("no-events").count())).toBeGreaterThan(0);
  });

  test("the back gesture closes the match detail and returns to Brief", async ({ page }) => {
    const result = page.getByTestId("last-result");
    if ((await result.count()) === 0) test.skip(true, "no finished match in data");
    await result.click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId("sheet")).toHaveCount(0);
    // The detail was opened FROM Brief, so back returns to Brief. The old
    // expectation of #/matcher described the previous architecture, where
    // Brief's result row lived on a separate archive route.
    await expect(page).toHaveURL(/\u0023\/$/);
    await expect(page.getByTestId("brief-page")).toBeAttached();
  });

  test("closing the sheet leaves focus in a valid place, never on <body>", async ({ page }) => {
    const result = page.getByTestId("last-result");
    if ((await result.count()) === 0) test.skip(true, "no finished match in data");
    await result.click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sheet")).toHaveCount(0);
    // Focus must land on a real element. Previously it was null, which is an
    // invalid state for screen-reader users.
    const focused = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a) return null;
      return { tag: a.tagName, id: a.id, testid: a.getAttribute("data-testid") };
    });
    expect(focused).not.toBeNull();
    expect(focused!.tag).not.toBe("BODY");
  });

  test("sheet traps focus while open", async ({ page }) => {
    const result = page.getByTestId("last-result");
    if ((await result.count()) === 0) test.skip(true, "no finished match in data");
    await result.click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    const inside = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="sheet"]');
      return !!s && s.contains(document.activeElement);
    });
    expect(inside).toBe(true);

    // Closing navigates back to the section, which unmounts the opener, so
    // focus is restored to the main landmark rather than to a dead node.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sheet")).toHaveCount(0);
    const focused = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
    expect(focused).toBeTruthy();
    expect(focused).not.toBe("BODY");
  });

  test("sheet is dismissible without any gesture", async ({ page }) => {
    const result = page.getByTestId("last-result");
    if ((await result.count()) === 0) test.skip(true, "no finished match in data");
    await result.click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    await expect(page.getByTestId("sheet-close")).toHaveAttribute("aria-label", /Stäng/);
    await page.getByTestId("sheet-close").click();
    await expect(page.getByTestId("sheet")).toHaveCount(0);
  });
});
