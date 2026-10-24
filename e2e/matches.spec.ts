import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const appData = JSON.parse(readFileSync("public/data/app.json", "utf8"));

test("Matcher opens the shared next-match card with kickoff time", async ({ page }) => {
  await page.goto("/#/matcher");
  await expect(page.getByTestId("matches-page")).toBeAttached({ timeout: 20_000 });

  const match = appData.nextMatch;
  if (!match) test.skip(true, "no next match in data");

  const banner = page.getByTestId("next-match");
  await expect(banner).toBeVisible();
  const expectedTime = await page.evaluate(
    (date: string) => new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(new Date(date)),
    match.date,
  );
  await expect(banner.locator(".strip-when > span")).toContainText(expectedTime);

  // Matcher defaults to "Spelade"; the banner must still resolve its fixture
  // from upcoming data and open the same sheet as Hem.
  await banner.click();
  await expect(page.getByTestId("upcoming-sheet")).toBeVisible();
  await expect(page.getByTestId("fixture-meta")).toContainText(expectedTime);
  await expect(
    page.locator(
      '[data-testid="lineup-loading"], [data-testid="lineup-content"], [data-testid="lineup-not-published"], [data-testid="lineup-error"]',
    ),
  ).toBeVisible();
});

test("Matcher banner has the same top spacing as Home", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByTestId("brief-page")).toBeAttached({ timeout: 20_000 });
  const homeGap = await page.evaluate(() => {
    const header = document.querySelector(".app-header")!.getBoundingClientRect();
    const banner = document.querySelector('[data-testid="next-match"]')!.getBoundingClientRect();
    return banner.top - header.bottom;
  });

  await page.goto("/#/matcher");
  await expect(page.getByTestId("matches-page")).toBeAttached({ timeout: 20_000 });
  const matcherGap = await page.evaluate(() => {
    const header = document.querySelector(".app-header")!.getBoundingClientRect();
    const banner = document.querySelector('[data-testid="next-match"]')!.getBoundingClientRect();
    return banner.top - header.bottom;
  });
  expect(matcherGap).toBe(homeGap);
});

test("Matcher's Tabell tab shows the league table in the tab position", async ({ page }) => {
  await page.goto("/#/matcher");
  await expect(page.getByTestId("matches-page")).toBeAttached({ timeout: 20_000 });
  await page.getByTestId("tab-table").click();

  await expect(page.getByTestId("tab-table")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("league-table")).toBeVisible();
  await expect(page.getByTestId("league-table")).toBeInViewport();
});

test("Hem keeps the unavailable notice in Settings with the last SportoMedia update", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByTestId("brief-page")).toBeAttached({ timeout: 20_000 });
  await expect(page.getByTestId("current-data-unavailable")).toHaveCount(0);

  await page.getByTestId("open-settings").click();
  await expect(page.getByTestId("settings-sheet")).toBeVisible();
  await expect(page.getByTestId("sportomedia-updated")).toContainText(
    "Matchdata från SportoMedia senast hämtad:",
  );
});
