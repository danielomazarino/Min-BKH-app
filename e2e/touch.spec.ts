import { test, expect, type Page, type Browser } from "@playwright/test";
import { chromium, devices } from "@playwright/test";
import {
  TAB_IDS,
  dragIndicatorBeyondFirstStop,
  dragIndicatorBeyondLastStop,
  dragIndicatorToAdjacentTab,
  renderedPillX,
  renderedStops,
  tabSpacing,
  touchDriver,
} from "./navIndicatorDrag";

/**
 * TOUCH-DRIVEN regression tests.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The previous suite drove the UI with `page.mouse`, which emits synthetic
 * MOUSE pointer events. A phone emits TOUCH pointer events, and the two are
 * treated very differently by a browser:
 *
 *   - `touch-action` is only consulted for touch input, so a `pan-y`/`pan-x`
 *     value that a mouse gesture sails straight past will make a real finger
 *     scroll the page instead of reaching the handler;
 *   - a touch gesture synthesises a `click` under different conditions;
 *   - momentum scrolling and pointer cancellation behave differently.
 *
 * So the mouse-based suite reported the nav swipe and the sheet drag as
 * working, and human testing on a real device found both broken. These tests
 * dispatch genuine touch events through CDP and additionally assert the thing
 * the old suite never checked: that the correct ELEMENT actually moved, and
 * that the background stayed still.
 */


/** A real iPhone-sized touch context against the preview server. */
async function touchPage(browser: Browser) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  return { ctx, page, touch };
}

test.describe("Touch: floating nav swipe", () => {
  test("a SHORT thumb drag still changes destination", async () => {
    // CORRECTED 2026-10-03. The old version asserted that a 40px LEFT flick
    // from Nyheter landed on Matcher. That is PHYSICALLY INVERTED: Matcher sits
    // to the RIGHT of Nyheter, and the indicator now travels toward the icon the
    // finger approaches. The test's own coordinates contradicted its name.
    //
    // The intent being preserved is that ordinary thumb travel is enough. It is
    // now expressed geometrically: one tab step plus a 4px overshoot, with the
    // step measured from the app rather than guessed.
    const browser = await chromium.launch();
    const { ctx, page } = await touchPage(browser);
    const stops = await renderedStops(page, ["tab-nyheter", "tab-matcher"]);
    await page.goto("/#/nyheter");
    await expect(page.getByTestId("tabbar")).toBeVisible();

    const touch = touchDriver(page);
    // Overshoot 4px: enough to clear the 9.3px dead zone around the midpoint,
    // and well under the 62px the old rule demanded.
    await dragIndicatorToAdjacentTab(page, touch, "right", tabSpacing(stops, TAB_IDS), {
      overshoot: 4,
    });
    await touch("touchEnd", 0, 0);

    await expect(page).toHaveURL(/#\/matcher$/);
    await expect(page.getByTestId("tab-matcher")).toHaveAttribute("aria-current", "page");
    await ctx.close();
    await browser.close();
  });

  test("a drag works from EVERY nav item, in the PHYSICAL direction", async () => {
    // CORRECTED 2026-10-03. The old test was named "in both directions" and its
    // "forward" block moved the finger LEFT 120px, which under the indicator
    // model moves BACKWARD. Both loops now drag in the direction the finger
    // actually travels, and each start point is derived from the app's own
    // rendered stops instead of a hardcoded 0.8 / 0.2 of the bar.
    const browser = await chromium.launch();
    const { ctx, page } = await touchPage(browser);
    const stops = await renderedStops(page, TAB_IDS);
    const spacing = tabSpacing(stops, TAB_IDS);
    const touch = touchDriver(page);

    const routes = ["#/", "#/nyheter", "#/matcher", "#/trupp", "#/spelare"] as const;
    const expectations = [
      ["tab-brief", "#/"],
      ["tab-nyheter", "#/nyheter"],
      ["tab-matcher", "#/matcher"],
      ["tab-trupp", "#/trupp"],
      ["tab-spelare", "#/spelare"],
    ] as const;

    for (let i = 0; i < routes.length; i++) {
      // Rightward, whenever there is a destination to the right.
      if (i + 1 < routes.length) {
        await page.goto(`/${routes[i]}`);
        await expect(page.getByTestId("tabbar")).toBeVisible();
        await dragIndicatorToAdjacentTab(page, touch, "right", spacing);
        await touch("touchEnd", 0, 0);
        await expect(page, `dragging RIGHT from ${routes[i]}`).toHaveURL(
          new RegExp(`${expectations[i + 1][1].replace("#", "\\u0023")}$`),
        );
      }
      // Leftward, whenever there is one to the left.
      if (i - 1 >= 0) {
        await page.goto(`/${routes[i]}`);
        await expect(page.getByTestId("tabbar")).toBeVisible();
        await dragIndicatorToAdjacentTab(page, touch, "left", spacing);
        await touch("touchEnd", 0, 0);
        await expect(page, `dragging LEFT from ${routes[i]}`).toHaveURL(
          new RegExp(`${expectations[i - 1][1].replace("#", "\\u0023")}$`),
        );
      }
    }
    await ctx.close();
    await browser.close();
  });

  test("the OUTER BAR stays put during a drag, the page does not scroll sideways, and the INDICATOR moves", async () => {
    // CORRECTED 2026-10-03. Two separate defects were living in this one test.
    //
    // DEFECT 1 — a conflation. It asserted the bar did not move, which was
    //   meant to catch the nav container being shoved around, but the indicator
    //   lives INSIDE that bar and is now required to move. Under the indicator
    //   model the old assertion would have failed on correct code.
    // FIX: split the two nouns. The OUTER BAR's box is checked on every frame
    //   for horizontal drift; the INDICATOR is checked to have travelled.
    //
    // DEFECT 2 — coordinates that could not reach anything. It started at 0.8 of
    //   the bar and dragged 160px left. One tab is ~51.5px, so that overshot
    //   three stops and crossed a dead zone, and the expected destination of
    //   Matcher was simply the nearest tab, not a choice the test made.
    // FIX: one tab of travel, measured from the app.
    const browser = await chromium.launch();
    const { ctx, page } = await touchPage(browser);
    const stops = await renderedStops(page, ["tab-nyheter", "tab-matcher"]);
    await page.goto("/#/nyheter");
    await expect(page.getByTestId("tabbar")).toBeVisible();

    const touch = touchDriver(page);
    const bar = (await page.getByTestId("tabbar").boundingBox())!;
    const restX = bar.x;
    const before = await renderedPillX(page);
    const startX = Math.round(bar.x + before);
    const y = Math.round(bar.y + bar.height / 2);
    const travel = tabSpacing(stops, TAB_IDS) + 20;

    await touch("touchStart", startX, y);
    for (let i = 1; i <= 8; i++) {
      await touch("touchMove", startX + Math.round((travel * i) / 8), y);
      const mid = (await page.getByTestId("tabbar").boundingBox())!;
      // The OUTER BAR has not drifted...
      expect(Math.abs(mid.x - restX), "the outer bar moved sideways mid-drag").toBeLessThanOrEqual(1);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the page scrolled horizontally during a nav drag").toBeLessThanOrEqual(1);
      // ...while the INDICATOR has.
      expect(
        await renderedPillX(page),
        `the indicator did not follow the finger at step ${i}`,
      ).toBeGreaterThan(before);
    }
    await touch("touchEnd", 0, 0);

    await expect(page).toHaveURL(/#\/matcher$/);
    // And it settled exactly on the destination's stop.
    await expect
      .poll(() => renderedPillX(page), { timeout: 5_000 })
      .toBeCloseTo(stops["tab-matcher"], 0);
    await ctx.close();
    await browser.close();
  });

  test("a tap still navigates, and a drag does not also fire the link underneath", async () => {
    // CORRECTED 2026-10-03. The name said "swipe" and described a swipe; only
    // the direction was wrong. It started at 0.2 of the bar and dragged right,
    // so under the indicator model it moved to the tab on the RIGHT, not back
    // to Trupp. Fixed to drag LEFT, toward Trupp, which is what the assertion
    // always meant.
    const browser = await chromium.launch();
    const { ctx, page } = await touchPage(browser);
    await page.goto("/#/");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    await page.waitForTimeout(1500);

    // Plain tap.
    await page.getByTestId("tab-trupp").tap();
    await expect(page).toHaveURL(/#\/trupp$/);

    // A drag starting on Spelare must move to Trupp and must NOT open a
    // player sheet by activating whatever lay under the release point.
    const stops = await renderedStops(page, ["tab-trupp", "tab-spelare"]);
    await page.goto("/#/spelare");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    const touch = touchDriver(page);
    await dragIndicatorToAdjacentTab(page, touch, "left", tabSpacing(stops, TAB_IDS));
    await touch("touchEnd", 0, 0);
    await page.waitForTimeout(600);
    await expect(page).toHaveURL(/#\/trupp$/);
    expect(await page.locator(".sheet, [role=dialog]").count(), "a drag opened a detail sheet").toBe(0);
    await ctx.close();
    await browser.close();
  });

  test("no wrapping at either end", async () => {
    // CORRECTED 2026-10-03. The direction table was inverted in the same way:
    // from Brief it dragged RIGHT 120px and expected to stay on Brief. Under the
    // indicator model dragging right from Brief legitimately reaches Nyheter,
    // so that case was asserting the opposite of the clamp. Each end is now
    // pushed AGAINST its own clamp with real overshoot.
    const browser = await chromium.launch();
    const { ctx, page } = await touchPage(browser);
    const stops = await renderedStops(page, ["tab-brief", "tab-spelare"]);
    const touch = touchDriver(page);

    // FIRST stop: push hard LEFT from Brief. It must not wrap to the last tab.
    await page.goto("/#/");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    const first = await dragIndicatorBeyondFirstStop(page, touch);
    expect(first.atRelease, "the indicator left the track at the first stop").toBeGreaterThanOrEqual(0);
    await touch("touchEnd", 0, 0);
    await page.waitForTimeout(700);
    await expect(page, "dragging left at the first tab must not wrap").toHaveURL(/#\/$/);
    await expect.poll(() => renderedPillX(page)).toBeCloseTo(stops["tab-brief"], 0);

    // LAST stop: push hard RIGHT from Spelare. It must not wrap to the first.
    await page.goto("/#/spelare");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    const last = await dragIndicatorBeyondLastStop(page, touch);
    expect(last.atRelease, "the indicator left the track at the last stop").toBeLessThanOrEqual(206);
    await touch("touchEnd", 0, 0);
    await page.waitForTimeout(700);
    await expect(page, "dragging right at the last tab must not wrap").toHaveURL(/#\/spelare$/);
    await expect.poll(() => renderedPillX(page)).toBeCloseTo(stops["tab-spelare"], 0);

    await ctx.close();
    await browser.close();
  });
});

test.describe("Touch: bottom sheet drag", () => {
  /** Open the match sheet, which is driven by the app's own fixture data. */
  async function openSheet(page: Page) {
    await page.goto("/#/matcher");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    await page.waitForTimeout(1800);
    await page.getByTestId("match-row").first().tap();
    await expect(page.getByTestId("sheet")).toBeVisible();
    await page.waitForTimeout(500);
  }

  test("dragging on the SHEET BODY moves the sheet, and the background stays put", async () => {
    // The old implementation bound the drag to a 22px grabber only, so a
    // finger landing on the title or the body did nothing at all.
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);
    await openSheet(page);

    const geo = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="sheet"]')!.getBoundingClientRect();
      const b = document.querySelector(".sheet-body")!.getBoundingClientRect();
      const l = document.querySelector(".layer") as HTMLElement;
      return { sheetY: s.y, bodyX: b.x, bodyW: b.width, bodyY: b.y, layerTop: l.scrollTop };
    });

    const startX = geo.bodyX + geo.bodyW / 2;
    const startY = geo.bodyY + 40;
    await touch("touchStart", startX, startY);
    let moved = 0;
    for (let i = 1; i <= 8; i++) {
      await touch("touchMove", startX, startY + i * 18);
      const y = (await page.getByTestId("sheet").boundingBox())!.y;
      moved = Math.max(moved, y - geo.sheetY);
      const layerTop = await page.evaluate(
        () => (document.querySelector(".layer") as HTMLElement).scrollTop,
      );
      expect(layerTop, "the background page scrolled while the sheet was dragged").toBe(geo.layerTop);
    }
    expect(moved, "the sheet did not follow the finger at all").toBeGreaterThan(40);
    await touch("touchEnd", startX, startY + 144);
    await ctx.close();
    await browser.close();
  });

  test("dragging on the grabber and the title both move the sheet", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);
    for (const where of ["grab", "head"]) {
      await openSheet(page);
      const rest = (await page.getByTestId("sheet").boundingBox())!.y;
      const start = await page.evaluate((w) => {
        const s = document.querySelector('[data-testid="sheet"]')!.getBoundingClientRect();
        const g = document.querySelector(".sheet-grab")!.getBoundingClientRect();
        return { x: s.x + s.width / 2, y: w === "grab" ? g.y + g.height / 2 : s.y + 40 };
      }, where);
      await touch("touchStart", start.x, start.y);
      for (let i = 1; i <= 6; i++) await touch("touchMove", start.x, start.y + i * 18);
      const mid = (await page.getByTestId("sheet").boundingBox())!.y;
      expect(mid - rest, `dragging the ${where} did not move the sheet`).toBeGreaterThan(30);
      await touch("touchEnd", start.x, start.y + 108);
      await page.waitForTimeout(300);
    }
    await ctx.close();
    await browser.close();
  });

  test("released below the threshold the sheet returns; beyond it, the sheet dismisses", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);

    // Short drag: comes back, stays open.
    await openSheet(page);
    let start = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="sheet"]')!.getBoundingClientRect();
      const g = document.querySelector(".sheet-grab")!.getBoundingClientRect();
      return { x: s.x + s.width / 2, y: g.y + g.height / 2 };
    });
    await touch("touchStart", start.x, start.y);
    for (let i = 1; i <= 6; i++) await touch("touchMove", start.x, start.y + i * 9);
    await touch("touchEnd", start.x, start.y + 54);
    await page.waitForTimeout(600);
    await expect(page.getByTestId("sheet"), "a short drag must not dismiss the sheet").toBeVisible();
    const back = (await page.getByTestId("sheet").boundingBox())!.y;
    const rest = await page.evaluate(
      () => document.querySelector('[data-testid="sheet"]')!.getBoundingClientRect().y,
    );
    expect(Math.abs(back - rest)).toBeLessThanOrEqual(2);

    // Long drag: dismisses.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await openSheet(page);
    start = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="sheet"]')!.getBoundingClientRect();
      const g = document.querySelector(".sheet-grab")!.getBoundingClientRect();
      return { x: s.x + s.width / 2, y: g.y + g.height / 2 };
    });
    await touch("touchStart", start.x, start.y);
    for (let i = 1; i <= 8; i++) await touch("touchMove", start.x, start.y + i * 26);
    await touch("touchEnd", start.x, start.y + 208);
    await page.waitForTimeout(700);
    await expect(page.getByTestId("sheet"), "a long drag must dismiss the sheet").toHaveCount(0);
    await ctx.close();
    await browser.close();
  });

  test("the sheet's own content still scrolls, and a drag while scrolled does not move the sheet", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);
    await openSheet(page);

    const geo = await page.evaluate(() => {
      const b = document.querySelector(".sheet-body") as HTMLElement;
      const r = b.getBoundingClientRect();
      return { x: r.x, w: r.width, y: r.y, scrollable: b.scrollHeight > b.clientHeight };
    });
    expect(geo.scrollable, "fixture sheet content should be scrollable for this test to mean anything").toBe(
      true,
    );

    // Swipe UP: the content scrolls, the sheet stays.
    const rest = (await page.getByTestId("sheet").boundingBox())!.y;
    await touch("touchStart", geo.x + geo.w / 2, geo.y + 40);
    for (let i = 1; i <= 8; i++) await touch("touchMove", geo.x + geo.w / 2, geo.y + 40 - i * 18);
    const duringUp = (await page.getByTestId("sheet").boundingBox())!.y;
    expect(Math.abs(duringUp - rest), "an upward scroll moved the sheet").toBeLessThanOrEqual(2);
    await touch("touchEnd", geo.x + geo.w / 2, geo.y - 104);
    await page.waitForTimeout(500);
    const scrolled = await page.evaluate(
      () => (document.querySelector(".sheet-body") as HTMLElement).scrollTop,
    );
    expect(scrolled, "the sheet body did not scroll on an upward swipe").toBeGreaterThan(0);

    // Now drag DOWN while scrolled: the content must scroll back, not the sheet.
    const startY = geo.y + 40;
    await touch("touchStart", geo.x + geo.w / 2, startY);
    let midSheet = rest;
    for (let i = 1; i <= 6; i++) {
      await touch("touchMove", geo.x + geo.w / 2, startY + i * 20);
      midSheet = (await page.getByTestId("sheet").boundingBox())!.y;
    }
    const midScroll = await page.evaluate(
      () => (document.querySelector(".sheet-body") as HTMLElement).scrollTop,
    );
    expect(Math.abs(midSheet - rest), "a downward drag moved the sheet while its content was scrolled").toBeLessThanOrEqual(2);
    expect(midScroll, "content did not scroll back toward the top").toBeLessThan(scrolled);
    await touch("touchEnd", geo.x + geo.w / 2, startY + 120);
    await ctx.close();
    await browser.close();
  });

  test("close button, Escape and focus restoration still work", async () => {
    const browser = await chromium.launch();
    const { ctx, page } = await touchPage(browser);
    await openSheet(page);
    await page.getByTestId("sheet-close").tap();
    await expect(page.getByTestId("sheet")).toHaveCount(0);

    await openSheet(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sheet")).toHaveCount(0);
    const focused = await page.evaluate(() => document.activeElement?.tagName ?? "");
    expect(focused, "focus was left nowhere after Escape").not.toBe("BODY");
    await ctx.close();
    await browser.close();
  });
});
