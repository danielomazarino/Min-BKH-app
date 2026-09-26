import { test, expect, type Page } from "@playwright/test";

/**
 * Spelare — a football-player search against Wikidata.
 *
 * This is a REWRITE, not a rename. The page no longer loads a 31-player
 * registry; it queries Wikidata live. What matters now is that the page never
 * claims a player does not exist when it merely failed to look, and never
 * invents a status or a Häcken link it was not given.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NETWORK IS STUBBED, AND HOW
 * ---------------------------------------------------------------------------
 *
 * The obvious way to fake this — `page.route(...)` / `context.route(...)` —
 * DOES NOT WORK for these calls. Measured in this repo (2026-09-26):
 *
 *     page.route    -> handler invoked 0 times, request reached the network
 *     context.route -> handler invoked 0 times, request reached the network
 *
 * Playwright's request interception does not fire for these cross-origin
 * `fetch` calls, and `serviceWorkers: "block"` did not change it. The first
 * draft of this spec therefore looked green for the wrong reasons: it was
 * quietly hitting the real Wikidata API, which is why the 429 and
 * "no results" cases "failed" (the real API answered them) and why the
 * ambiguous case "failed" (the real API returned one hit, not two).
 *
 * The fix is `addInitScript`, which replaces `window.fetch` before any app
 * code runs. The app calls `window.fetch.bind(window)`, so it picks up the
 * stub. The response is faked; the ranking, filtering, caching and state logic
 * under test are all the real code.
 *
 * The live contract was verified separately against the real API — the
 * measurements are recorded in app/players/wikidata.ts.
 */

type Mode = "ok" | "empty" | "rate-limited" | "error" | "single";

/** Realistic Wikidata JSON, captured from the live API. */
const ENTITIES: Record<string, unknown> = {
  // Alexander Jeremejeff — P54 DOES include BK Häcken (Q639723).
  Q16633101: {
    id: "Q16633101",
    labels: { sv: { value: "Alexander Jeremejeff" } },
    descriptions: { sv: { value: "svensk fotbollsspelare" } },
    aliases: { sv: [{ value: "Jeremejeff" }, { value: "Alexander Thomas Jeremejeff" }] },
    claims: {
      P31: [{ mainsnak: { datavalue: { value: { id: "Q5" } } } }],
      P106: [{ mainsnak: { datavalue: { value: { id: "Q937857" } } } }],
      P569: [{ mainsnak: { datavalue: { value: { time: "+1993-10-12T00:00:00Z", precision: 11 } } } }],
      P27: [{ mainsnak: { datavalue: { value: { id: "Q34" } } } }],
      P54: [
        { mainsnak: { datavalue: { value: { id: "Q639723" } } } },
        { mainsnak: { datavalue: { value: { id: "Q204881" } } } },
      ],
    },
  },
  // Mattias Bjärsmyr — ten P54 clubs, and BK Häcken is NOT one of them.
  Q518833: {
    id: "Q518833",
    labels: { sv: { value: "Mattias Bjärsmyr" } },
    descriptions: { sv: { value: "svensk fotbollsspelare" } },
    aliases: { sv: [{ value: "Bjärsmyr" }] },
    claims: {
      P31: [{ mainsnak: { datavalue: { value: { id: "Q5" } } } }],
      P106: [{ mainsnak: { datavalue: { value: { id: "Q937857" } } } }],
      P569: [{ mainsnak: { datavalue: { value: { time: "+1986-01-03T00:00:00Z", precision: 11 } } } }],
      P54: [{ mainsnak: { datavalue: { value: { id: "Q186785" } } } }],
    },
  },
  Q34: { id: "Q34", labels: { sv: { value: "Sverige" } } },
  Q639723: { id: "Q639723", labels: { sv: { value: "BK Häcken" } } },
  Q204881: { id: "Q204881", labels: { sv: { value: "Malmö FF" } } },
  Q186785: { id: "Q186785", labels: { sv: { value: "Rosenborg BK" } } },
};

/**
 * Install the fetch stub. Must run before the app's first request, hence
 * addInitScript rather than a route handler.
 */
async function stubWikidata(page: Page, mode: Mode = "ok") {
  await page.addInitScript(
    ([stubMode, entities]) => {
      const w = window as unknown as {
        __wdCalls: string[];
        fetch: typeof fetch;
      };
      w.__wdCalls = [];

      // Keep the REAL fetch and delegate everything that is not Wikidata.
      //
      // An earlier version of this stub answered EVERY request, which broke
      // app boot with "Cannot read properties of undefined (reading
      // 'generatedAt')": the app fetches data/app.json on mount and the stub
      // returned `{}` for it. Only the player search is ours to fake.
      const realFetch = w.fetch.bind(window);

      const all = entities as Record<string, unknown>;

      w.fetch = (async (input: RequestInfo | URL) => {
        const raw = String(typeof input === "string" ? input : (input as Request).url ?? input);
        if (!raw.includes("wikidata.org")) return realFetch(input as RequestInfo);

        const url = new URL(raw, "https://www.wikidata.org");
        w.__wdCalls.push(url.pathname + url.search);

        if (stubMode === "rate-limited") {
          return new Response("{}", { status: 429, headers: { "Retry-After": "42" } });
        }
        if (stubMode === "error") {
          return new Response("boom", { status: 500 });
        }

        const action = url.searchParams.get("action");

        if (action === "wbsearchentities") {
          if (stubMode === "empty") return Response.json({ search: [] });
          const search = [
            { id: "Q16633101", label: "Alexander Jeremejeff", description: "svensk fotbollsspelare" },
          ];
          if (stubMode !== "single") {
            search.push({ id: "Q518833", label: "Mattias Bjärsmyr", description: "svensk fotbollsspelare" });
          }
          return Response.json({ search });
        }

        if (action === "wbgetentities") {
          const ids = (url.searchParams.get("ids") ?? "").split("|").filter(Boolean);
          const out: Record<string, unknown> = {};
          for (const id of ids) if (all[id]) out[id] = all[id];
          return Response.json({ entities: out });
        }

        if (action === "query") {
          // Backlinks fallback: the surname-entity path.
          return Response.json({ query: { backlinks: [{ title: "Q16633101" }] } });
        }

        return Response.json({});
      }) as typeof fetch;
    },
    [mode, ENTITIES] as const,
  );
}

async function search(page: Page, query: string) {
  const input = page.getByLabel("Sök fotbollsspelare");
  await input.fill(query);
  await input.press("Enter");
}

test.beforeEach(async ({ page }) => {
  // Default to the two-hit response; individual tests override.
  await stubWikidata(page, "ok");
  await page.goto("/#/spelare");
  await expect(page.getByTestId("former-page")).toBeVisible();
});

test.describe("Spelare (footballer search)", () => {
  test("the destination is named Spelare and routes to #/spelare", async ({ page }) => {
    await expect(page.getByTestId("tab-spelare")).toHaveText("Spelare");
    await expect(page).toHaveURL(/\u0023\/spelare$/);
  });

  test("nothing is listed before the user searches — there is no player wall", async ({ page }) => {
    // The old page offered an A–Z browse of a fixed list. That list is gone,
    // and this assertion is what keeps it from creeping back.
    await expect(page.getByTestId("former-player")).toHaveCount(0);
    await expect(page.getByTestId("az-index")).toHaveCount(0);
    await expect(page.getByTestId("idle-hint")).toBeVisible();
  });

  test("search is submit-driven, never per keystroke", async ({ page }) => {
    const input = page.getByLabel("Sök fotbollsspelare");
    await input.pressSequentially("Jeremejeff", { delay: 10 });
    expect(await page.evaluate(() => window.__wdCalls.length)).toBe(0);

    await input.press("Enter");
    await expect(page.getByTestId("former-player").first()).toBeVisible();
    const calls = await page.evaluate(() => window.__wdCalls.length);
    expect(calls).toBeGreaterThan(0);
  });

  test("a single hit is shown without disambiguation ceremony", async ({ page }) => {
    // Re-stub BEFORE reload: addInitScript installs on every navigation, so
    // the later script wins and the earlier default never applies.
    await stubWikidata(page, "single");
    await page.reload();
    await search(page, "Jeremejeff");
    await expect(page.getByTestId("former-player")).toHaveCount(1);
    await expect(page.getByTestId("ambiguous-hint")).toHaveCount(0);
  });

  test("finds a player and shows the Häcken link as enrichment, not as a gate", async ({ page }) => {
    await search(page, "Jeremejeff");
    const row = page.getByTestId("former-player").filter({ hasText: "Jeremejeff" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Alexander Jeremejeff");
    await expect(row).toContainText("HÄCKEN");
  });

  test("a player with no recorded Häcken club is still shown", async ({ page }) => {
    await search(page, "Bjärsmyr");
    const row = page.getByTestId("former-player").filter({ hasText: "Bjärsmyr" });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText("HÄCKEN");
  });

  test("multiple hits are presented as a choice, not silently collapsed", async ({ page }) => {
    // The stub returns two hits for ANY non-empty query, so the only thing
    // that matters here is that the page offers the choice. The query must be
    // at least MIN_QUERY (2) characters or the page correctly refuses to
    // search at all — an earlier draft used "a" and failed for that reason.
    await search(page, "an");
    await expect(page.getByTestId("ambiguous-hint")).toBeVisible();
    await expect(page.getByTestId("former-player")).toHaveCount(2);
  });

  test("a one-character query is not sent to the network at all", async ({ page }) => {
    // Guards the rate limit: one keystroke must not cost a request.
    await search(page, "a");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__wdCalls.length)).toBe(0);
    await expect(page.getByTestId("idle-hint")).toBeVisible();
  });

  test("a genuine miss is reported as a miss", async ({ page }) => {
    await stubWikidata(page, "empty");
    await page.reload();
    await search(page, "Zzzz nonexistent");
    await expect(page.getByTestId("no-results")).toBeVisible();
  });

  /**
   * THE MOST IMPORTANT TEST IN THIS FILE.
   *
   * A rate limit means "we did not look". Rendering it as "no such player"
   * would be the exact dishonesty the rewrite set out to remove.
   */
  test("a 429 is NEVER rendered as 'no such player'", async ({ page }) => {
    await stubWikidata(page, "rate-limited");
    await page.reload();
    await search(page, "Jeremejeff");
    await expect(page.getByTestId("rate-limited")).toBeVisible();
    await expect(page.getByTestId("no-results")).toHaveCount(0);
    // The copy must admit we do not know.
    await expect(page.getByTestId("rate-limited")).toContainText("vet inte");
  });

  test("a transport failure is reported as a failure, with a retry", async ({ page }) => {
    await stubWikidata(page, "error");
    await page.reload();
    await search(page, "Jeremejeff");
    await expect(page.getByTestId("search-failed")).toBeVisible();
    await expect(page.getByTestId("no-results")).toHaveCount(0);
    await expect(page.getByTestId("retry")).toBeVisible();
  });

  test("detail is deep-linkable and the back gesture closes it", async ({ page }) => {
    await search(page, "Jeremejeff");
    await page.getByTestId("former-player").filter({ hasText: "Jeremejeff" }).locator("button.open").click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toMatch(/^#\/spelare\?id=/);
    await page.goBack();
    await expect(page.getByTestId("sheet")).toHaveCount(0);
  });

  test("the sheet states a missing Häcken link without denying one", async ({ page }) => {
    await search(page, "Bjärsmyr");
    await page.getByTestId("former-player").filter({ hasText: "Bjärsmyr" }).locator("button.open").click();
    const sheet = page.getByTestId("sheet");
    await expect(sheet.getByTestId("hacken-unknown")).toBeVisible();
    // "Not recorded" must not read as "never played there".
    await expect(sheet.getByTestId("hacken-unknown")).toContainText("betyder inte");
  });

  test("the sheet never invents a status", async ({ page }) => {
    await search(page, "Bjärsmyr");
    await page.getByTestId("former-player").filter({ hasText: "Bjärsmyr" }).locator("button.open").click();
    const sheet = page.getByTestId("sheet");
    await expect(sheet.getByTestId("status-unknown")).toBeVisible();
    for (const word of ["Pensionerad", "Fri agent", "Utan klubb", "Aktiv i"]) {
      await expect(sheet).not.toContainText(word);
    }
  });

  test("the sheet always offers provenance and the stable Q-ID", async ({ page }) => {
    await search(page, "Bjärsmyr");
    await page.getByTestId("former-player").filter({ hasText: "Bjärsmyr" }).locator("button.open").click();
    const prov = page.getByTestId("sheet").getByTestId("provenance");
    await expect(prov).toContainText("Wikidata");
    await expect(prov).toContainText("Q518833");
  });

  test("a verified Häcken link is stated as verified", async ({ page }) => {
    await search(page, "Jeremejeff");
    await page.getByTestId("former-player").filter({ hasText: "Jeremejeff" }).locator("button.open").click();
    await expect(page.getByTestId("sheet").getByTestId("hacken-yes")).toBeVisible();
  });

  test("favourites persist across a reload, keyed by Q-ID", async ({ page }) => {
    await search(page, "Jeremejeff");
    await page.getByTestId("former-player").filter({ hasText: "Jeremejeff" }).locator("button.open").click();
    await page.getByTestId("sheet").getByTestId("fav-toggle").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("fav-toggle").first()).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await search(page, "Jeremejeff");
    await expect(page.getByTestId("fav-toggle").first()).toHaveAttribute("aria-pressed", "true");
  });

  test("a repeated identical search is served from the session cache", async ({ page }) => {
    await search(page, "Jeremejeff");
    await expect(page.getByTestId("former-player").first()).toBeVisible();
    const afterFirst = await page.evaluate(() => window.__wdCalls.length);
    expect(afterFirst).toBeGreaterThan(0);

    await page.getByTestId("clear-search").click();
    await search(page, "Jeremejeff");
    await expect(page.getByTestId("former-player").first()).toBeVisible();
    // No new traffic: the cache exists precisely so repeated searching does
    // not exhaust Wikidata's ~10 requests/minute budget.
    expect(await page.evaluate(() => window.__wdCalls.length)).toBe(afterFirst);
  });

  test("no A–Z browse exists — the old fixed list is gone", async ({ page }) => {
    await expect(page.getByTestId("az-index")).toHaveCount(0);
    await expect(page.getByTestId("az-letter")).toHaveCount(0);
  });
});

declare global {
  interface Window {
    __wdCalls: string[];
  }
}
