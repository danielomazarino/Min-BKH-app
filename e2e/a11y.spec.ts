import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** All five primary destinations, plus the not-found surface. */
const PAGES = [
  { hash: "#/", name: "Brief" },
  { hash: "#/nyheter", name: "Nyheter" },
  { hash: "#/matcher", name: "Matcher" },
  { hash: "#/trupp", name: "Trupp" },
  { hash: "#/spelare", name: "Spelare" },
];

test.describe("Accessibility (axe-core)", () => {
  for (const p of PAGES) {
    test(`no critical violations on ${p.name}`, async ({ page }) => {
      await page.goto(`/${p.hash}`);
      await page.waitForTimeout(600);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const serious = results.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
      expect(
        serious.map((v) => `${v.id}: ${v.nodes.length} nodes`),
        `Accessibility violations on ${p.name}`,
      ).toEqual([]);
    });
  }

  test("open sheets are scanned too", async ({ page }) => {
    // The previous suite never scanned a dialog, which is where the focus-trap
    // and backdrop bugs lived.
    await page.goto("/#/");
    await page.waitForTimeout(600);

    const result = page.getByTestId("last-result");
    if ((await result.count()) > 0) {
      await result.click();
      await expect(page.getByTestId("sheet")).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      const serious = results.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
      expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
      await page.keyboard.press("Escape");
    }

    await page.getByTestId("open-settings").click();
    await expect(page.getByTestId("settings-sheet")).toBeVisible();
    const s = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    const bad = s.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
    expect(bad.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  test("status is never conveyed by colour alone", async ({ page }) => {
    await page.goto("/#/");
    await page.waitForTimeout(600);
    // Match results carry a letter alongside the coloured edge.
    await page.goto("/#/matcher");
    const rows = page.getByTestId("match-row");
    const n = await rows.count();
    for (let i = 0; i < Math.min(n, 5); i++) {
      const t = await rows.nth(i).innerText();
      // Either a result letter (S/O/F) or a deliberate non-finished marker.
      expect(/[SFO]|–/.test(t)).toBe(true);
    }
  });

  test("reduced motion does not break navigation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#/");
    await expect(page.getByTestId("brief-page")).toBeAttached();
    // Navigation must still be operable when transitions are suppressed, and
    // the active state must not depend on motion.
    await page.getByTestId("tab-nyheter").click();
    await expect(page.getByTestId("tab-nyheter")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("news-page")).toBeAttached();
  });

  test("the not-found surface is not a silent blank", async ({ page }) => {
    await page.goto("/#/hittades-inte");
    await expect(page.getByTestId("not-found")).toBeVisible();
    await expect(page.getByTestId("not-found")).toContainText("Sidan finns inte");
  });

  test("the five destinations are distinguishable to a screen reader", async ({ page }) => {
    await page.goto("/#/");
    const nav = page.getByRole("navigation", { name: "Huvudnavigation" });
    await expect(nav).toBeVisible();
    const names = await nav.locator("a").allInnerTexts();
    expect(names).toEqual(["Brief", "Nyheter", "Matcher", "Trupp", "Spelare"]);
    // The active destination is announced, not only coloured.
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  });

  test("every icon-only control has an accessible name", async ({ page }) => {
    await page.goto("/#/");
    await page.waitForTimeout(500);
    const unnamed = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, a"));
      return btns
        .filter((b) => {
          const text = (b.textContent ?? "").trim();
          const label = b.getAttribute("aria-label") ?? b.getAttribute("title") ?? "";
          return text === "" && label === "";
        })
        .map((b) => b.outerHTML.slice(0, 90));
    });
    expect(unnamed).toEqual([]);
  });
});
