import { test, expect } from "@playwright/test";
import type { AppData } from "../pipeline/src/types";

/**
 * The article audit — every headline the feeds delivered, with the pipeline's
 * verdict, reachable from the settings sheet.
 *
 * WHY THIS NEEDS A TEST
 *   The counts ("3 av 20 behölls") say how many, never which. The whole point
 *   of this page is that a wrong drop (B-012: the IFK Göteborg derby preview
 *   dropped as "unknown") can be spotted BY EYE. These tests pin the three
 *   things that make that possible: the link appears only when audit data
 *   exists, every article carries its verdict, and the filter narrows the
 *   list without hiding the verdicts.
 */

const AUDIT = [
  { title: "Inför biljettsläppet hemma mot IFK Göteborg", url: "https://bkhacken.se/a", publisher: "BK Häcken", publishedAt: "2026-10-06T08:00:00Z", verdict: "men-excluded" },
  { title: "Gustav Lindgren: Det kändes väldigt bra", url: "https://bkhacken.se/b", publisher: "BK Häcken", publishedAt: "2026-10-06T07:00:00Z", verdict: "kept" },
  { title: "Storförlust hemma mot Juventus", url: "https://sportbladet.se/a", publisher: "Sportbladet", publishedAt: "2026-10-05T20:00:00Z", verdict: "no Häcken relation" },
];

function appData(withAudit: boolean): AppData {
  return {
    freshness: {
      generatedAt: new Date().toISOString(),
      sourceStatus: { "rss:BK Häcken": "ok", "rss:Sportbladet": "ok", sportomedia: "ok" },
      sourceCounts: {
        "BK Häcken": { fetched: 20, kept: 2, dropped: 18 },
        Sportbladet: { fetched: 39, kept: 0, dropped: 39 },
      },
      ...(withAudit ? { articleAudit: AUDIT } : {}),
    },
    news: [],
    newsEvents: [],
  } as unknown as AppData;
}

test.describe("Article audit", () => {
  test("the link appears when audit data exists and opens the list", async ({ page }) => {
    await page.route("**/data/app.json", (route) => route.fulfill({ json: appData(true) }));
    await page.goto("/#/installningar");
    await page.getByRole("link", { name: /Granska alla 3 hämtade artiklar/ }).click();
    const audit = page.getByTestId("article-audit");
    await expect(audit).toBeVisible();
    // Every article is listed with its verdict — the marking is the point.
    await expect(audit).toContainText("Inför biljettsläppet hemma mot IFK Göteborg");
    await expect(audit).toContainText("Ej herrlag");
    await expect(audit).toContainText("Häcken herr");
    await expect(audit).toContainText("Ingen Häcken-koppling");
    // Headlines link to the original article so the verdict can be checked.
    await expect(audit.locator('a[href="https://bkhacken.se/a"]')).toBeVisible();
  });

  test("the summary states how many were considered relevant", async ({ page }) => {
    await page.route("**/data/app.json", (route) => route.fulfill({ json: appData(true) }));
    await page.goto("/#/installningar?id=artiklar");
    await expect(page.getByTestId("article-audit")).toContainText("1 av 3 bedömdes som Häcken herr");
  });

  test("the filter narrows the list without losing the verdicts", async ({ page }) => {
    await page.route("**/data/app.json", (route) => route.fulfill({ json: appData(true) }));
    await page.goto("/#/installningar?id=artiklar");
    const audit = page.getByTestId("article-audit");
    await page.getByRole("button", { name: "Häcken herr" }).click();
    await expect(audit).toContainText("Gustav Lindgren");
    await expect(audit).not.toContainText("Storförlust hemma mot Juventus");
    await page.getByRole("button", { name: "Utsektade" }).click();
    await expect(audit).toContainText("Storförlust hemma mot Juventus");
    await expect(audit).not.toContainText("Gustav Lindgren");
  });

  test("no link and an honest notice when the run predates the audit", async ({ page }) => {
    await page.route("**/data/app.json", (route) => route.fulfill({ json: appData(false) }));
    await page.goto("/#/installningar");
    await expect(page.getByRole("link", { name: /Granska alla/ })).toHaveCount(0);
    // Deep-linking directly to the audit must state the fact, not render empty.
    await page.goto("/#/installningar?id=artiklar");
    await expect(page.getByTestId("audit-unavailable")).toBeVisible();
  });
});

/**
 * The manual update check. A stale service worker is the "I don't see your
 * change" report the user explicitly does not want to be called about, so the
 * settings sheet offers a way to force a check instead of waiting for the
 * hourly poll.
 */
test.describe("Manual update check", () => {
  test("the settings sheet offers a check and reports the result", async ({ page }) => {
    await page.route("**/data/app.json", (route) => route.fulfill({ json: appData(false) }));
    await page.goto("/#/installningar");
    const btn = page.getByTestId("check-update");
    await expect(btn).toBeVisible();
    await btn.click();
    // The check is async (and raced against an 8s timeout), so wait for it to
    // settle rather than reading the DOM mid-check. Either "you have the
    // latest" or an update button must appear — never a silent no-op.
    await expect(btn).toBeEnabled({ timeout: 15_000 });
    const none = await page.getByTestId("update-none").count();
    const apply = await page.getByTestId("update-apply").count();
    expect(none + apply).toBeGreaterThan(0);
  });
});
