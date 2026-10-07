import { test, expect } from "@playwright/test";
import type { ApiMetrics } from "../pipeline/src/apiMetrics";

/**
 * The per-source news counts, and what each source actually does.
 *
 * WHY THIS NEEDS A TEST AND NOT JUST A SCREENSHOT
 *   The failure this guards against is a claim the app makes about itself. It
 *   is very easy to ship a panel where a feed that returned 39 articles and
 *   contributed none looks identical to a feed that returned nothing at all —
 *   because `sourceStatus` says "ok" for both. That is exactly what happened
 *   in production on 2026-10-05 and it is invisible without these assertions.
 *
 * THE HONESTY RULE UNDER TEST
 *   "Not measured" must never render as "0". A run from before the measurement
 *   existed has no entry; printing a zero there invents a fact.
 */

/** A metrics log with two runs: one measured, one from before measurement. */
function fixture(): ApiMetrics {
  return {
    version: 1,
    generatedAt: "2026-10-06T03:30:00.000Z",
    latestRun: {
      runAt: "2026-10-06T03:30:00.000Z",
      durationMs: 20000,
      calls: 64,
      failures: 0,
      costCredits: 0,
      services: [
        {
          service: "rss:Sportbladet",
          calls: 1,
          failures: 0,
          skipped: 0,
          skipReasons: [],
          totalDurationMs: 2000,
          maxDurationMs: 2000,
          requestBytes: 0,
          responseBytes: 39000,
          costCredits: 0,
          costReported: 0,
          meteredCalls: 0,
        },
        {
          service: "rss:BK Häcken",
          calls: 1,
          failures: 0,
          skipped: 0,
          skipReasons: [],
          totalDurationMs: 2000,
          maxDurationMs: 2000,
          requestBytes: 0,
          responseBytes: 15000,
          costCredits: 0,
          costReported: 0,
          meteredCalls: 0,
        },
        {
          service: "sportomedia",
          calls: 28,
          failures: 0,
          skipped: 0,
          skipReasons: [],
          totalDurationMs: 15000,
          maxDurationMs: 1500,
          requestBytes: 0,
          responseBytes: 214000,
          costCredits: 0,
          costReported: 0,
          meteredCalls: 0,
        },
      ],
      sourceArticles: {
        Sportbladet: { fetched: 39, kept: 0, dropped: 39 },
        "BK Häcken": { fetched: 20, kept: 3, dropped: 17 },
      },
    },
    latestCalls: [],
    latestCallsTotal: 30,
    latestCallsTruncated: true,
    // A run from BEFORE the measurement existed. It must render as "—".
    history: [
      {
        runAt: "2026-10-05T03:30:00.000Z",
        durationMs: 18000,
        calls: 60,
        failures: 0,
        costCredits: 0,
        services: [],
      },
    ],
    budget: [],
    totals: { calls: 64, failures: 0, costCredits: 0, meteredRequests: 0 },
  };
}

/** Open settings, expand the technical disclosure, and wait for the panel. */
async function openDiagnostics(page: import("@playwright/test").Page) {
  await page.goto("/#/installningar");
  await page.getByTestId("diagnostics").locator("summary").click();
  await expect(page.getByTestId("api-metrics")).toBeVisible({ timeout: 20_000 });
}

test.describe("Per-source news counts", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/data/api-metrics.json", (route) =>
      route.fulfill({ json: fixture() }),
    );
  });

  test("a feed that answered but contributed nothing is visibly zero", async ({ page }) => {
    await openDiagnostics(page);
    // The whole point. "OK" alone would hide a source delivering nothing.
    // These are PER-PUBLISHER counts under the rolled-up feed row, because
    // the rollup total alone cannot say WHICH feed stopped contributing.
    const counts = page.getByTestId("feed-counts");
    await expect(counts).toContainText("Sportbladet");
    await expect(counts).toContainText("0 av 39");
    await expect(counts).toContainText("3 av 20");
  });

  test("distinguishes 'answered with nothing' from 'produced articles'", async ({ page }) => {
    await openDiagnostics(page);
    // One of two feeds actually produced anything. A total of "3 of 59" would
    // read like a healthy feed set; this is the number that shows otherwise.
    await expect(page.getByTestId("metrics-services")).toContainText("1 av 2 källor bidrog");
  });

  test("shows 'Ej mätt' rather than a zero for a service with no article count", async ({
    page,
  }) => {
    await openDiagnostics(page);
    // sportomedia returns fixtures and fixtures, not articles. It must not be
    // rendered as "0 artiklar", which would read as "this source is broken".
    await expect(page.getByTestId("metrics-services")).toContainText("Ej mätt");
  });

  test("the over-time table marks an unmeasured run with a dash, not 0", async ({ page }) => {
    await openDiagnostics(page);
    const table = page.getByTestId("metrics-count-history");
    await expect(table).toBeVisible();
    // The 2026-10-05 run predates the measurement.
    await expect(table.locator("td.cunmeasured").first()).toHaveText("—");
    // And the measured run shows real numbers.
    await expect(table).toContainText("3");
  });

  test("the table explains what the fetched total after the slash means", async ({ page }) => {
    await openDiagnostics(page);
    // The explanatory prose lives in the closing paragraph, not the note above
    // the table. Asserting on the wrong paragraph would have passed a real
    // regression in the note above it, which is exactly the false green this
    // project has been bitten by before.
    await expect(page.getByTestId("count-history-note")).toContainText("0");
    await expect(page.getByTestId("api-metrics")).toContainText("3 av 39");
  });

  test("the table is reachable and not clipped at 390px", async ({ page }) => {
    await openDiagnostics(page);
    const wrap = page.getByTestId("metrics-count-history");
    const box = await wrap.boundingBox();
    // The SCROLL CONTAINER may be as wide as the phone; the page must not be.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // A few px of rounding is normal; a whole column is not.
    expect(overflow).toBeLessThanOrEqual(2);
    expect(box!.width).toBeGreaterThan(200);
  });
});

test.describe("What each source does", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/data/api-metrics.json", (route) =>
      route.fulfill({ json: fixture() }),
    );
  });

  test("a source explains itself on tap, not on hover", async ({ page }) => {
    await openDiagnostics(page);
    const info = page
      .getByTestId("metrics-services")
      .getByRole("button", { name: /Vad betyder detta\?/ })
      .first();
    // A `title` tooltip would pass a `hover` test and be unreachable on a
    // phone. The real button and real visible text is the requirement.
    await info.click();
    await expect(page.getByRole("note").first()).toBeVisible();
  });

  test("says what breaks, in plain Swedish", async ({ page }) => {
    await openDiagnostics(page);
    // The accessible name is prefixed by the button's own label, so match on
    // the description text rather than the whole string.
    await page
      .getByTestId("feed-counts")
      .getByRole("button", { name: /Sportbladets fotbollskrivning/ })
      .click();
    await expect(page.getByRole("note").first()).toContainText("går sönder");
  });

  test("the settings source list carries the same explanations and counts", async ({ page }) => {
    // The settings sheet reads app.json, not the metrics log. The REAL app.json
    // has no sourceCounts yet — the nightly has not run with the new pipeline —
    // so without this mock the test would assert against data that does not
    // exist and fail for a reason that has nothing to do with the UI.
    await page.route("**/data/app.json", (route) =>
      route.fulfill({
        json: {
          freshness: {
            generatedAt: new Date().toISOString(),
            sourceStatus: {
              "rss:Sportbladet": "ok",
              "rss:BK Häcken": "ok",
              sportomedia: "ok",
            },
            sourceCounts: {
              Sportbladet: { fetched: 39, kept: 0, dropped: 39 },
              "BK Häcken": { fetched: 20, kept: 3, dropped: 17 },
            },
          },
        },
      }),
    );
    await page.goto("/#/installningar");
    const sources = page.getByTestId("news-sources");
    // Text shortened 2026-10-07 (one-page settings restructure): the count
    // label is now "N av M behölls" instead of "N av M artiklar behölls".
    await expect(sources).toContainText("3 av 20 behölls");
    await expect(sources).toContainText("0 av 39 behölls");
    // Every row has an info button.
    await expect(sources.getByRole("button", { name: /Vad betyder detta/ }).first()).toBeVisible();
  });
});