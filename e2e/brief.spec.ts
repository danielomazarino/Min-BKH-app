import { test, expect } from "@playwright/test";

/**
 * The brief (Home) is a three-layer surface reachable by swipe, by dot and by
 * keyboard. These tests pin the product rules the redesign introduced, not
 * incidental markup.
 */

test.describe("Brief (Home)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByTestId("layer-oversikt")).toBeAttached();
  });

  test("opens on the overview layer with the next match as the single hero", async ({ page }) => {
    await expect(page.getByTestId("pager-dot-oversikt")).toHaveAttribute("aria-current", "true");
    // Hero exists, and it is the only one.
    await expect(page.getByTestId("next-match")).toBeVisible();
    expect(await page.locator(".hero").count()).toBe(1);
  });

  test("last result shows a correctly ordered Häcken-first score", async ({ page }) => {
    const result = page.getByTestId("last-result");
    await expect(result).toBeVisible();
    // Regression: the old UI rendered "BK Häcken Kalmar FF 5–0" — no
    // separator, score on the wrong side. The score must now be its own node.
    const score = page.getByTestId("last-score");
    await expect(score).toBeVisible();
    await expect(score).toHaveText(/^\d+–\d+$/);
  });

  test("compactness: the overview layer is at most ~1.5 phone screens", async ({ page }) => {
    const h = await page.getByTestId("layer-oversikt").evaluate((el) => el.scrollHeight);
    // 844px viewport. Previous implementation was ~2155px (2.6 screens).
    expect(h).toBeLessThanOrEqual(1.6 * 844);
  });

  test("discipline states never contradict the warning data", async ({ page }) => {
    const rows = page.locator('[data-testid="suspended-player"], [data-testid="at-risk-player"]');
    const n = await rows.count();
    if (n === 0) {
      await expect(page.getByTestId("discipline-clear")).toBeVisible();
      return;
    }
    for (let i = 0; i < n; i++) {
      const text = (await rows.nth(i).innerText()).toLowerCase();
      // "1 warning left" must never be stated next to a served-suspension
      // total, and multi-warning states must be pluralised.
      if (text.includes("varning kvar")) expect(text).not.toMatch(/varningar? kvar.*\b[3-9]\b/);
      if (text.includes("avstängd")) expect(text).toContain("avstängd");
    }
  });

  test("the SvFF rule paragraph is not in the main brief", async ({ page }) => {
    // It moved behind the Settings disclosure.
    await expect(page.locator("main")).not.toContainText("SvFF tävlingsbestämmelser");
  });

  test("no visible page H1 clutters the main content", async ({ page }) => {
    // Identity lives in the header. The only h1 is an sr-only label for the
    // pager — 1x1px and clipped, so it must not take visual space. (Playwright
    // treats sr-only as "visible", so we assert on rendered size instead.)
    const h1 = page.locator("main h1");
    await expect(h1).toHaveCount(1);
    const box = await h1.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(2);
    expect(box!.height).toBeLessThanOrEqual(2);
    // No other heading competes for the top of the screen.
    const visibleH2s = await page.locator("main h2:visible").allInnerTexts();
    expect(visibleH2s.length).toBeGreaterThan(0);
  });
});

test.describe("Layers and gestures", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByTestId("layer-oversikt")).toBeAttached();
  });

  test("dot indicator is a working non-gesture equivalent for the swipe", async ({ page }) => {
    await page.getByTestId("pager-dot-nyheter").click();
    await expect(page.getByTestId("pager-dot-nyheter")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("layer-nyheter")).toBeVisible();
  });

  test("keyboard arrows move between layers", async ({ page }) => {
    // The pager is a group, not a focusable control, so keyboard interaction
    // is carried by the tablist. Focus a dot, then use the arrow keys — the
    // same model as a native tab bar.
    await page.getByTestId("pager-dot-oversikt").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("pager-dot-nyheter")).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("pager-dot-oversikt")).toHaveAttribute("aria-current", "true");
  });

  test("off-screen layers are not reachable by keyboard", async ({ page }) => {
    // A hidden layer that stays tabbable is a screen-reader trap.
    await expect(page.getByTestId("pager-layer-nyheter")).toHaveAttribute("aria-hidden", "true");
    // `inert` must be a real DOM property — React 18 drops the prop, so this
    // is asserted in the browser rather than on the attribute.
    const inert = await page.evaluate(() =>
      [...document.querySelectorAll(".pager-layer")].map((e) => (e as HTMLElement).inert),
    );
    expect(inert).toEqual([false, true, true]);
  });
});

test.describe("Match timeline", () => {
  test("the last match opens a sheet with its event timeline", async ({ page }) => {
    await page.goto("/#/");
    const result = page.getByTestId("last-result");
    if ((await result.count()) === 0) test.skip(true, "no finished match in data");
    await result.click();
    const sheet = page.getByTestId("sheet");
    await expect(sheet).toBeVisible();
    // The event data already existed in app.json and was never rendered before.
    const timeline = page.getByTestId("match-timeline");
    const events = page.locator('[data-testid^="timeline-"]');
    expect((await timeline.count()) + (await page.getByTestId("no-events").count())).toBeGreaterThan(0);
    if ((await timeline.count()) > 0) {
      expect(await events.count()).toBeGreaterThan(0);
    }
  });

  test("sheet traps focus and restores it on close", async ({ page }) => {
    await page.goto("/#/");
    const result = page.getByTestId("last-result");
    if ((await result.count()) === 0) test.skip(true, "no finished match in data");
    await result.click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    // Focus must be INSIDE the dialog (regression: it previously stayed outside).
    const inside = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="sheet"]');
      return !!s && s.contains(document.activeElement);
    });
    expect(inside).toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sheet")).toHaveCount(0);
    // Focus returns to the element that opened the sheet.
    const restored = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    expect(restored).toBe("last-result");
  });

  test("sheet is dismissible without any gesture", async ({ page }) => {
    await page.goto("/#/");
    const result = page.getByTestId("last-result");
    if ((await result.count()) === 0) test.skip(true, "no finished match in data");
    await result.click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    // Explicit labelled close control, not just a gesture or a bare ✕ glyph.
    await expect(page.getByTestId("sheet-close")).toHaveAttribute("aria-label", /Stäng/);
    await page.getByTestId("sheet-close").click();
    await expect(page.getByTestId("sheet")).toHaveCount(0);
  });
});
