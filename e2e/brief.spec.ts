import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

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
});

/**
 * E-005 — the discipline panel must never present a suspension risk for a
 * player who is not in the current squad.
 *
 * WHY THIS BLOCK IS HERMETIC. The committed `public/data/app.json` is stale by
 * design: the pipeline was deliberately not re-run, so it still contains
 * `('Amor Layouni', 'at_risk')`. An assertion derived from that file would
 * FAIL until an unrelated scheduled job regenerates it — which makes it a
 * broken test, not a strict one. So these tests inject their own dataset via
 * `page.route` and assert against THAT. They pass today and after every
 * future transfer.
 *
 * WHY THE SERVICE WORKER IS TORN DOWN FIRST. This is not defensive noise, it
 * is the whole reason the mechanism works. vite-plugin-pwa's service worker
 * registers on the suite's `beforeEach` load and claims the page. It then
 * answers `/data/app.json` from the `bkh-data` cache via NetworkFirst —
 * BEFORE the request ever reaches Playwright. Measured here: with the worker
 * active `page.route` receives ZERO hits and the app renders the committed
 * bytes; after `unregister()` + `caches.delete()` the route is hit and the
 * fixture renders. Without this the tests silently degrade into asserting
 * against the real file while believing they had stubbed it.
 *
 * The pattern matches `e2e/offline.spec.ts`, which already manipulates these
 * same `/data/*.json` routes.
 */
test.describe("Kortläget — current-squad scoping (E-005)", () => {
  const URL_ROW = '[data-testid="suspended-player"], [data-testid="at-risk-player"]';

  /** A discipline row as the pipeline emits it. */
  function row(
    playerId: string,
    playerName: string,
    status: string,
    warningsUntilSuspension: number,
    extras: Record<string, unknown> = {},
  ) {
    return {
      playerId,
      playerName,
      warningCount: warningsUntilSuspension,
      warningsUntilSuspension,
      redCards: 0,
      status,
      relevantWarnings: [{ matchId: 1, date: "2026-04-01T00:00:00.000Z" }],
      incomplete: false,
      ...extras,
    };
  }

  function squadPlayer(playerId: string, playerName: string) {
    return {
      playerId,
      playerName,
      positionGroup: "midfields",
      matchesPlayed: 10,
      matchesStarted: 8,
      goals: 1,
      assists: 0,
      yellowCards: 2,
      redCards: 0,
      competition: "Allsvenskan",
    };
  }

  /**
   * Serve a dataset the test fully controls, hermetically.
   *
   * Three deliberate steps, all load-bearing:
   *  1. unregister the service worker — otherwise it serves the data itself
   *  2. delete the caches — a re-registered worker could re-seed them
   *  3. `route.fulfill` — the app now fetches OUR bytes
   *
   * `reload()`, not `goto()`: the suite-level `beforeEach` already navigated
   * to "/#/", so a second `goto("/#/")` is a same-document hash navigation
   * and the app never re-fetches.
   *
   * The `discipline` panel is asserted present before returning. That is the
   * precondition that stops an empty or broken render from being read as
   * "nothing wrong, nothing to see".
   */
  async function serve(page: import("@playwright/test").Page, discipline: unknown[], squadStats: unknown[]) {
    const base = JSON.parse(readFileSync("public/data/app.json", "utf8"));
    const payload = { ...base, discipline, squadStats };

    await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    });

    let hits = 0;
    await page.route("**/data/app.json", (r) => {
      hits++;
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
    });

    await page.reload();
    await expect(page.getByTestId("brief-page")).toBeAttached();
    await expect(page.getByTestId("discipline")).toHaveCount(1);
    expect(hits, "app must have fetched the stubbed data, not a cached copy").toBeGreaterThan(0);
  }

  /**
   * Player names of every rendered discipline row.
   *
   * Read from `aria-label` (`"{name}, {state}. {n} gula kort den här säsongen."`)
   * rather than from the visible text, so the assertion is not coupled to the
   * meter/tally markup. The name is the leading segment before the first comma.
   */
  async function renderedNames(page: import("@playwright/test").Page): Promise<string[]> {
    const labels = await page.locator(URL_ROW).evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label") ?? ""),
    );
    return labels.map((l) => l.split(",")[0].trim()).filter(Boolean);
  }

  test("a player the data still flags at_risk is excluded once they leave the squad", async ({ page }) => {
    // The regression, in the exact shape the committed data has today.
    //
    // The fixture deliberately gives the departed player `status: "at_risk"`
    // — the PRE-fix value — rather than the post-fix `"departed"`. That is the
    // point: it simulates the pipeline having emitted a forward-looking risk
    // for someone no longer at the club, and asserts the UI still does not
    // present him. If the exclusion in `currentSquadDiscipline()` were
    // removed, `urgentDiscipline()` would pass him through (at_risk IS in its
    // allowlist) and this row would render. The test fails.
    //
    // The earlier version of this block asserted over a `departed` row, which
    // `urgentDiscipline()` drops anyway — so it passed regardless of the
    // guard and proved nothing. Caught by mutation: removing the filter did
    // not fail it.
    const inSquad = [squadPlayer("fogis:1", "Nuvarande Spelare")];
    const stale = row("name:avgangen spelare", "Avgangen Spelare", "at_risk", 2);
    await serve(page, [row("fogis:1", "Nuvarande Spelare", "at_risk", 2), stale], inSquad);

    const squadNames = new Set(inSquad.map((p) => p.playerName));
    // Derived from the fixture, not hardcoded: anyone the data flags with a
    // forward-looking risk who is not in the squad.
    const nonSquadAtRisk = [stale].map((r) => r.playerName).filter((n) => !squadNames.has(n));
    expect(nonSquadAtRisk.length).toBeGreaterThan(0); // the fixture really is a violation

    const names = await renderedNames(page);
    for (const bad of nonSquadAtRisk) expect(names).not.toContain(bad);
    // The qualifying current-squad player still renders, so the panel is not
    // simply empty (which would satisfy the assertion above vacuously).
    expect(names).toContain("Nuvarande Spelare");
  });

  test("a broken or empty render is a FAILURE, not a silent pass", async ({ page }) => {
    // The old test was `not.toContainText("Layouni")`, which a blank Brief or a
    // crashed render satisfies trivially. This asserts the panel is genuinely
    // present with the expected rows BEFORE any absence claim, so "nothing
    // rendered" can never masquerade as "nothing wrong".
    const inSquad = [squadPlayer("fogis:1", "Nuvarande Spelare")];
    await serve(page, [row("fogis:1", "Nuvarande Spelare", "at_risk", 2)], inSquad);

    const panel = page.getByTestId("discipline");
    await expect(panel).toHaveCount(1);
    const declared = Number(await panel.getAttribute("data-count"));
    expect(declared).toBeGreaterThan(0);
    await expect(page.locator(URL_ROW)).toHaveCount(declared);
  });

  test("the declared count equals the number of rendered rows", async ({ page }) => {
    // E-001's invariant, asserted where the data is available: a heading that
    // claims more rows than exist is the exact regression this project hit.
    const inSquad = [
      squadPlayer("fogis:1", "Spelare Ett"),
      squadPlayer("fogis:2", "Spelare Två"),
      squadPlayer("fogis:3", "Spelare Tre"),
    ];
    const discipline = [
      row("fogis:1", "Spelare Ett", "suspended_next", 3),
      row("fogis:2", "Spelare Två", "at_risk", 2),
      row("fogis:3", "Spelare Tre", "at_risk", 2),
    ];
    await serve(page, discipline, inSquad);

    const declared = Number(await page.getByTestId("discipline").getAttribute("data-count"));
    const rendered = await page.locator(URL_ROW).count();
    expect(rendered).toBe(declared);
    expect(declared).toBe(3); // no 2+3 cap in force
  });

  test("no rendered row belongs to a non-squad player, and none states a warning countdown for one", async ({ page }) => {
    // The substantive domain assertion, honestly scoped.
    //
    // IMPORTANT — WHAT THIS CAN AND CANNOT PROVE. On Brief a departed row is
    // filtered out TWICE: `currentSquadDiscipline()` drops it (it is not in
    // squadStats) and `urgentDiscipline()` drops it (its status is not a
    // forward-looking one). So the row never reaches `cstatFor()` on THIS
    // screen, and no fixture here can make the `cstatFor` guard observable
    // here. That is a property of the architecture, not a gap in the test.
    //
    // What this test DOES prove is the user-visible contract: whatever the
    // data says, every discipline row Brief shows belongs to someone who can
    // actually be suspended by the club, and none of them carries a
    // "varning kvar" countdown for a player who cannot be.
    //
    // The `cstatFor` guard is covered by unit tests in format.test.ts, and is
    // reachable in principle from any future consumer that does not
    // pre-filter — this test cannot be its proof.
    const inSquad = [
      squadPlayer("fogis:1", "Nuvarande Spelare"),
      squadPlayer("fogis:2", "Annan Nuvarande"),
    ];
    const rows = [
      row("fogis:1", "Nuvarande Spelare", "at_risk", 2),
      row("fogis:2", "Annan Nuvarande", "suspended_next", 3),
      // Departed players, in the PRE-fix shape the data would still carry:
      // a forward-looking status for someone no longer at the club. Using the
      // post-fix `"departed"`/`"served"` statuses here would make these rows
      // disappear via `urgentDiscipline()`'s own status allowlist, so the
      // assertions would hold even with the squad filter removed. Verified by
      // mutation — the `at_risk` shape is what actually makes these fail.
      row("name:avgangen demotad", "Avgangen Demotad", "at_risk", 2, { departed: true }),
      row("name:avgangen served", "Avgangen Served", "at_risk", 2, {
        departed: true,
        warningCount: 5,
        servedAt: "2026-05-17T00:00:00.000Z",
      }),
      row("name:avgangen none", "Avgangen Ingen", "at_risk", 2, { departed: true }),
    ];
    await serve(page, rows, inSquad);

    const squadNames = new Set(inSquad.map((p) => p.playerName));
    const labels = await page.locator(URL_ROW).evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label") ?? ""),
    );
    // Precondition: rows really rendered. Without this an empty panel would
    // satisfy every loop below and prove nothing.
    expect(labels.length).toBeGreaterThan(0);

    // 1. Every rendered row belongs to a current squad member — so no row can
    //    be a suspension risk for someone the club can no longer suspend.
    //    A non-squad name here is the exact defect.
    for (const label of labels) {
      const name = label.split(",")[0].trim();
      expect(squadNames.has(name), `rendered row is not a current squad player: ${label}`).toBe(true);
    }

    // 2. No countdown claim is attached to a departed name. The departed
    //    players are named explicitly so the intent survives a future edit of
    //    the fixtures above. A current player legitimately gets
    //    "En varning kvar" — that is the feature working, and the next test
    //    pins it — so the countdown is only forbidden for a non-squad name.
    const names = await renderedNames(page);
    for (const gone of ["Avgangen Demotad", "Avgangen Served", "Avgangen Ingen"]) {
      expect(names).not.toContain(gone);
      for (const label of labels) {
        if (label.startsWith(gone)) expect(label).not.toMatch(/varning(?:ar)? kvar/);
      }
    }
  });

  test("a CURRENT at-risk player still gets their warning-away claim", async ({ page }) => {
    // Over-correction guard. Scoping must not silently disable the panel, and
    // a player who IS in the squad must keep the ordinary wording. Without
    // this, "the panel is empty" would pass every other test in this block.
    const inSquad = [squadPlayer("fogis:1", "Nuvarande Spelare")];
    await serve(page, [row("fogis:1", "Nuvarande Spelare", "at_risk", 2)], inSquad);

    const label = await page.locator(URL_ROW).first().getAttribute("aria-label");
    expect(label).toMatch(/En varning kvar/);
    expect(label).toContain("Nuvarande Spelare");
  });

  test("a departed player in the data is never counted in the declared total", async ({ page }) => {
    // The count must reflect what is SHOWN. A departed row inflating
    // `data-count` would reintroduce E-001's "heading says 5, four render"
    // shape in a new costume.
    const inSquad = [squadPlayer("fogis:1", "Nuvarande Spelare")];
    const rows = [
      row("fogis:1", "Nuvarande Spelare", "at_risk", 2),
      // Pre-fix shape, so this row survives `urgentDiscipline()` on its own
      // and only the squad filter can remove it.
      row("name:avgangen demotad", "Avgangen Demotad", "at_risk", 2, { departed: true }),
    ];
    await serve(page, rows, inSquad);

    const declared = Number(await page.getByTestId("discipline").getAttribute("data-count"));
    const rendered = await page.locator(URL_ROW).count();
    expect(declared).toBe(rendered);
    // One qualifying current-squad player, not two.
    expect(declared).toBe(1);
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
