import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { AxeResults } from "axe-core";

/** All five primary destinations, plus the not-found surface. */
const PAGES = [
  { hash: "#/", name: "Hem" },
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

  /**
   * Render a violation as something a human can act on.
   *
   * A bare `["color-contrast: 13"]` says a count and nothing else — and this
   * assertion has failed only in CI, with a DIFFERENT count on each attempt
   * (13, then 18), which is the signature of a scan that races the page
   * rather than a fixed styling defect. Reporting the offending selectors,
   * the measured ratio and the resolved colours turns the next failure into
   * a diagnosis instead of a mystery.
   */
  function describe(violations: AxeResults["violations"]): string[] {
    return violations
      .filter((v) => ["critical", "serious"].includes(v.impact ?? ""))
      .map((v) => {
        const nodes = v.nodes.map((n) => {
          const d = (n.any[0]?.data ?? {}) as {
            contrastRatio?: number;
            fgColor?: string;
            bgColor?: string;
            fontSize?: string;
            expectedContrastRatio?: string;
          };
          return [
            `      target=${JSON.stringify(n.target)}`,
            `      html=${n.html.replace(/\s+/g, " ").slice(0, 140)}`,
            `      ratio=${d.contrastRatio} need=${d.expectedContrastRatio} ` +
              `fg=${d.fgColor} bg=${d.bgColor} size=${d.fontSize}`,
          ].join("\n");
        });
        return [`${v.id} (${v.impact}): ${v.nodes.length} nodes`, ...nodes].join("\n");
      });
  }

  /**
   * Wait until NOTHING is animating.
   *
   * `.sheet-backdrop` runs a 220ms `fade-in` from `opacity: 0`. axe samples
   * the composited result, so a scan that lands mid-fade sees the dialog at
   * ~71% opacity — every colour is scaled toward the black page and the
   * measured contrast collapses. This is why the violation count CHANGED
   * between runs (13, then 18, then 10): it depended purely on where in the
   * fade the scan happened. `expect(...).toBeVisible()` returns as soon as
   * the element is laid out, so it does not imply the animation has ended.
   */
  async function animationsSettled(page: Page) {
    await page.waitForFunction(
      () => document.getAnimations().every((a) => a.playState !== "running"),
      undefined,
      { timeout: 5000 },
    );
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
      await animationsSettled(page);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      expect(describe(results.violations).join("\n")).toEqual("");
      await page.keyboard.press("Escape");
    }

    await page.getByTestId("open-settings").click();
    await expect(page.getByTestId("settings-sheet")).toBeVisible();
    await animationsSettled(page);
    const s = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    expect(describe(s.violations).join("\n")).toEqual("");
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
    expect(names).toEqual(["Hem", "Nyheter", "Matcher", "Trupp", "Spelare"]);
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

/**
 * Every sheet's scroll container must be keyboard-reachable.
 *
 * axe rule `scrollable-region-focusable` (WCAG 2.1.1) accepts EITHER a
 * focusable descendant OR the region itself being in the tab order. The
 * older sheets all contain buttons and so passed via the first route, which
 * hid the gap until the match sheet arrived with a text-only timeline.
 *
 * Asserted here for EVERY sheet, because "it passed for the other four" is
 * not a reason to stop checking — the property belongs to the container, not
 * to whichever content happens to be inside it.
 */
test.describe("Sheet scroll containers are keyboard reachable", () => {
  // `testId` is per-sheet: the settings dialog keeps its own historical id
  // so deep links and existing tests do not break, even though it now renders
  // through the shared <Sheet>. Asserting a hard-coded "sheet" would have
  // silently skipped this sheet.
  const OPENERS: Array<{
    name: string;
    testId: string;
    open: (page: import("@playwright/test").Page) => Promise<void>;
  }> = [
    {
      name: "match sheet",
      testId: "sheet",
      open: async (page) => {
        await page.goto("/#/");
        await expect(page.getByTestId("last-result")).toBeVisible();
        await page.getByTestId("last-result").click();
      },
    },
    {
      name: "settings sheet",
      testId: "settings-sheet",
      open: async (page) => {
        await page.goto("/#/");
        await page.getByTestId("open-settings").click();
      },
    },
    {
      name: "news sheet",
      testId: "sheet",
      open: async (page) => {
        await page.goto("/#/nyheter");
        await expect(page.getByTestId("news-card").first()).toBeVisible();
        await page.getByTestId("news-card").first().click();
      },
    },
  ];

  for (const { name, testId, open } of OPENERS) {
    test(`the ${name} body is in the tab order`, async ({ page }) => {
      await open(page);
      const dialog = page.getByTestId(testId);
      await expect(dialog).toBeVisible();
      await page.waitForFunction(
        () => document.getAnimations().every((a) => a.playState !== "running"),
        undefined,
        { timeout: 5000 },
      );

      const body = dialog.locator(".sheet-body");
      const tabindex = await body.getAttribute("tabindex");
      // "0" puts it in the tab order; "-1" is programmatic-only and axe
      // rejects it. Measured: -1 -> rule fails, 0 -> clean.
      expect(tabindex, `${name} body must be tabbable, not programmatic-only`).toBe("0");

      const scrollable = await body.evaluate((el) => el.scrollHeight > el.clientHeight);
      if (scrollable) {
        // A keyboard user must be able to move it.
        const moved = await body.evaluate((el) => {
          el.focus();
          const start = el.scrollTop;
          el.scrollTop = 40;
          return el.scrollTop !== start;
        });
        expect(moved, `${name} body could not be scrolled programmatically once focused`).toBe(true);
      }

      // The REAL requirement is that axe passes, not that an attribute is
      // present. Assert the rule directly so the test fails for the actual
      // user-facing reason, and so a future axe version that tightens the
      // rule is caught here rather than in a later, more confusing failure.
      const scan = await new AxeBuilder({ page })
        .withRules(["scrollable-region-focusable"])
        .analyze();
      const hits = scan.violations.filter(
        (v) => (v.nodes ?? []).some((n) => (n.target ?? []).some((t) => String(t).includes("sheet-body"))),
      );
      expect(
        hits.map((v) => `${v.id}: ${v.nodes.length}`),
        `${name} scroll region is not keyboard reachable (WCAG 2.1.1)`,
      ).toEqual([]);
    });
  }
});
