import { test, expect, type Page, type Browser } from "@playwright/test";
import { chromium, devices } from "@playwright/test";

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
  test("a SHORT thumb swipe still changes destination", async () => {
    // Regression: the old rule demanded 18% of the bar width (~62px), so
    // ordinary thumb swipes did nothing at all.
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);
    await page.goto("/#/nyheter");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    await page.waitForTimeout(1500);

    const bar = (await page.getByTestId("tabbar").boundingBox())!;
    const y = bar.y + bar.height / 2;
    const startX = bar.x + bar.width * 0.8;
    // 40px: well under the old 62px requirement, a natural thumb flick.
    await touch("touchStart", startX, y);
    for (let i = 1; i <= 6; i++) await touch("touchMove", startX - (40 * i) / 6, y);
    await touch("touchEnd", startX - 40, y);

    await expect(page).toHaveURL(/\u0023\/matcher$/);
    await expect(page.getByTestId("tab-matcher")).toHaveAttribute("aria-current", "page");
    await ctx.close();
    await browser.close();
  });

  test("swipe works from EVERY nav item, in both directions", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);

    const forward = [
      ["#/", "#/nyheter"],
      ["#/nyheter", "#/matcher"],
      ["#/matcher", "#/trupp"],
      ["#/trupp", "#/spelare"],
    ] as const;
    for (const [from, to] of forward) {
      await page.goto(`/${from}`);
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(1200);
      const bar = (await page.getByTestId("tabbar").boundingBox())!;
      const y = bar.y + bar.height / 2;
      const x = bar.x + bar.width * 0.8;
      await touch("touchStart", x, y);
      for (let i = 1; i <= 6; i++) await touch("touchMove", x - (120 * i) / 6, y);
      await touch("touchEnd", x - 120, y);
      await expect(page, `swipe left from ${from}`).toHaveURL(new RegExp(`${to.replace("#", "\\u0023")}$`));
    }

    const back = [
      ["#/spelare", "#/trupp"],
      ["#/trupp", "#/matcher"],
      ["#/matcher", "#/nyheter"],
      ["#/nyheter", "#/"],
    ] as const;
    for (const [from, to] of back) {
      await page.goto(`/${from}`);
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(1200);
      const bar = (await page.getByTestId("tabbar").boundingBox())!;
      const y = bar.y + bar.height / 2;
      const x = bar.x + bar.width * 0.2;
      await touch("touchStart", x, y);
      for (let i = 1; i <= 6; i++) await touch("touchMove", x + (120 * i) / 6, y);
      await touch("touchEnd", x + 120, y);
      await expect(page, `swipe right from ${from}`).toHaveURL(new RegExp(`${to.replace("#", "\\u0023")}$`));
    }
    await ctx.close();
    await browser.close();
  });

  test("the bar does not move during a touch swipe, and the page does not scroll sideways", async () => {
    // The old suite only checked the URL changed. It must also check the
    // nav container stayed put and the content never shifted horizontally.
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);
    await page.goto("/#/nyheter");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    await page.waitForTimeout(1500);

    const bar = (await page.getByTestId("tabbar").boundingBox())!;
    const restX = bar.x;
    const y = bar.y + bar.height / 2;
    const x = bar.x + bar.width * 0.8;

    await touch("touchStart", x, y);
    for (let i = 1; i <= 8; i++) {
      await touch("touchMove", x - (160 * i) / 8, y);
      const mid = (await page.getByTestId("tabbar").boundingBox())!;
      expect(Math.abs(mid.x - restX), "the nav bar moved sideways mid-swipe").toBeLessThanOrEqual(1);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the page scrolled horizontally during a nav swipe").toBeLessThanOrEqual(1);
    }
    await touch("touchEnd", x - 160, y);
    await expect(page).toHaveURL(/\u0023\/matcher$/);
    await ctx.close();
    await browser.close();
  });

  test("a tap still navigates, and a swipe does not also fire the link underneath", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);
    await page.goto("/#/");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    await page.waitForTimeout(1500);

    // Plain tap.
    await page.getByTestId("tab-trupp").tap();
    await expect(page).toHaveURL(/\u0023\/trupp$/);

    // A swipe starting on Spelare must move to Trupp and must NOT open a
    // player sheet by activating whatever lay under the release point.
    await page.goto("/#/spelare");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    await page.waitForTimeout(1800);
    const bar = (await page.getByTestId("tabbar").boundingBox())!;
    const y = bar.y + bar.height / 2;
    const x = bar.x + bar.width * 0.2;
    await touch("touchStart", x, y);
    for (let i = 1; i <= 6; i++) await touch("touchMove", x + (120 * i) / 6, y);
    await touch("touchEnd", x + 120, y);
    await page.waitForTimeout(600);
    await expect(page).toHaveURL(/\u0023\/trupp$/);
    expect(await page.locator(".sheet, [role=dialog]").count(), "a swipe opened a detail sheet").toBe(0);
    await ctx.close();
    await browser.close();
  });

  test("no wrapping at either end", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);
    for (const [from, dir, frac] of [
      ["#/", "right", 0.2],
      ["#/spelare", "left", 0.8],
    ] as const) {
      await page.goto(`/${from}`);
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(1200);
      const bar = (await page.getByTestId("tabbar").boundingBox())!;
      const y = bar.y + bar.height / 2;
      const x = bar.x + bar.width * frac;
      const sign = dir === "left" ? -1 : 1;
      await touch("touchStart", x, y);
      for (let i = 1; i <= 6; i++) await touch("touchMove", x + sign * (120 * i) / 6, y);
      await touch("touchEnd", x + sign * 120, y);
      await page.waitForTimeout(500);
      await expect(page, `swipe ${dir} at ${from} must not wrap`).toHaveURL(
        new RegExp(`${from.replace("#", "\\u0023")}$`),
      );
    }
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
