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
    // REWRITTEN 2026-10-07: the sheet is now the SHARED player card, and the
    // squad facts render under `squad-facts` (the old minimal sheet used
    // `squad-stats`). "Start" is no longer a tile — the card shows the
    // supporter-facing five (Matcher, Mål, Assist, Gult, Rött).
    await expect(page.getByTestId("squad-facts")).toBeVisible();
    for (const label of ["Matcher", "Mål", "Assist", "Gult", "Rött"]) {
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

/**
 * The squad card must render its Wikidata/Wikipedia layers from the pipeline's
 * pre-resolved enrichment, with NO live search. The pipeline resolves the
 * squad once per nightly; the card is the consumer. Mocked here so the test is
 * deterministic and does not depend on a live Wikidata call.
 */
test.describe("Squad card uses pre-resolved enrichment", () => {
  const ENRICHED = {
    freshness: { generatedAt: new Date().toISOString(), sourceStatus: { sportomedia: "ok" } },
    news: [],
    newsEvents: [],
    squadStats: [
      {
        playerId: "fogis:1",
        playerName: "Etrit Berisha",
        positionGroup: "goalkeepers",
        matchesPlayed: 7,
        matchesStarted: 7,
        goals: 0,
        assists: 0,
        yellowCards: 1,
        redCards: 0,
        competition: "Allsvenskan",
      },
    ],
    disciplineRule: { rule: "3 varningar", ruleSource: "SvFF", ruleSourceUrl: "https://x", threshold: 3, suspensionMatches: 1 },
    squadEnrichment: {
      "fogis:1": {
        playerId: "fogis:1",
        queryName: "Etrit Berisha",
        qid: "Q1523030",
        name: "Etrit Berisha",
        description: "albansk fotbollsspelare",
        citizenship: ["Albanien"],
        pageUrl: "https://www.wikidata.org/wiki/Q1523030",
        career: [
          { years: "2025–", team: "BK Häcken", loan: false, apps: 7, goals: 0 },
          { years: "2008–2013", team: "Kalmar FF", loan: false, apps: 90, goals: 3 },
        ],
        nationalTeams: [{ years: "2012–", team: "Albanien", loan: false, apps: 80, goals: 0 }],
        usedInfobox: true,
        wiki: { lang: "sv", extract: "Etrit Berisha är en albansk målvakt.", pageUrl: "https://sv.wikipedia.org/wiki/Etrit_Berisha" },
        candidate: {
          qid: "Q1523030",
          name: "Etrit Berisha",
          alsoKnownAs: [],
          citizenship: ["Albanien"],
          clubs: [],
          career: [],
          nationalTeams: [],
          sitelinks: { svwiki: { title: "Etrit Berisha" } },
          hackenClub: true,
          hackenTeam: "men",
          pageUrl: "https://www.wikidata.org/wiki/Q1523030",
          matchScore: 100,
        },
      },
    },
  };

  test("renders the pre-resolved career with no live search", async ({ page }) => {
    // HERMETIC, like brief.spec.ts's serve(): the service worker caches
    // /data/app.json with NetworkFirst, so a route mock alone is a race — the
    // worker can answer from its cache and the app then renders the REAL
    // squad (27 players, no enrichment) instead of this fixture. That made
    // this test pass or fail depending on whether the worker had already
    // cached the file, which is why it failed in the batch and passed alone.
    // Unregister the worker and drop the caches BEFORE routing, so the app
    // must fetch our bytes.
    await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    });

    let hits = 0;
    await page.route("**/data/app.json", (route) => {
      hits++;
      return route.fulfill({ json: ENRICHED });
    });
    // The file-level beforeEach already navigated, so a hash-only goto would
    // NOT re-fetch app.json. A full reload is required for the mock to apply.
    await page.reload();
    // POLL, do not assert immediately: reload() resolves on the load event,
    // but the app fetches app.json asynchronously AFTER React mounts. An
    // immediate check reads hits=0 and fails even though the mock is used.
    await expect.poll(() => hits, { message: "app must fetch the stubbed data, not a cached copy" }).toBeGreaterThan(0);
    await page.getByTestId("squad-player").first().click();
    await expect(page.getByTestId("squad-facts")).toBeAttached();
    // The career comes straight from the enrichment — Häcken at the top.
    const career = page.getByTestId("career");
    await expect(career).toBeVisible();
    await expect(career).toContainText("BK Häcken");
    await expect(career).toContainText("Kalmar FF");
    // The narrative is present too.
    await expect(page.getByTestId("wiki-extract")).toContainText("albansk målvakt");
  });
});
