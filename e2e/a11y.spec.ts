import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** All top-level surfaces, including the two-tab navigation model. */
const PAGES = [
  { hash: "#/", name: "Brief" },
  { hash: "#/matcher", name: "Matcher" },
  { hash: "#/tidigare", name: "Tidigare" },
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

  test("reduced motion does not break interaction", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#/");
    await expect(page.getByTestId("layer-oversikt")).toBeAttached();
    // The pager must still be operable when transitions are suppressed.
    await page.getByTestId("pager-dot-nyheter").click();
    await expect(page.getByTestId("pager-dot-nyheter")).toHaveAttribute("aria-current", "true");
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
