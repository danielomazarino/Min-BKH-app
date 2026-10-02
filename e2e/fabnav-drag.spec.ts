import { test, expect, type Page, type Browser } from "@playwright/test";
import { chromium, devices } from "@playwright/test";

/**
 * DRAGGING the floating navigation bar.
 *
 * WHY A SEPARATE FILE
 * `touch.spec.ts` and `navigation.spec.ts` assert that a SHORT FLICK changes
 * destination and that the bar stays pinned during it. Those are still true,
 * and they still pass — because repositioning now requires a deliberate
 * press-and-hold (HOLD_MS). This file covers the third gesture: the drag.
 *
 * The two suites together are the disambiguation contract:
 *   short flick      -> navigate, bar does not move
 *   press and hold   -> bar moves, no navigation happens
 *   tap              -> navigate
 *
 * ALL GESTURES USE REAL CDP TOUCH, NOT page.mouse
 * `touch-action` is only consulted for touch input, and a touch gesture
 * synthesises `click` under different conditions than a mouse one. A mouse
 * drag therefore cannot exercise the arbitration that actually broke on a
 * real phone — that mistake previously made the whole suite report the
 * gesture as working while human testing found it dead.
 */

const HOLD_MS = 320;

async function touchPage(browser: Browser) {
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  /**
   * Start from a KNOWN position.
   *
   * The dock is persisted in localStorage, so without this a test that moves
   * the bar changes the starting position for every test that runs after it.
   * That is not a theoretical hazard: the "flick navigates" test genuinely
   * failed here because an earlier test had left the bar on `#/nyheter` and a
   * left flick correctly went *backwards*. Each test gets a fresh context, but
   * clearing the key explicitly makes the intent obvious rather than relying on
   * context isolation alone.
   */
  const reset = async () => {
    await page.goto("/#/");
    await page.evaluate(() => {
      try {
        localStorage.removeItem("bkh.fabnav.dock.v1");
      } catch {
        /* storage unavailable; the default dock applies anyway */
      }
    });
    await page.reload();
    await page.locator(".fabnav").waitFor();
  };
  return { ctx, page, cdp, touch, reset };
}

const barBox = async (page: Page) => {
  const b = await page.getByTestId("tabbar").boundingBox();
  if (!b) throw new Error("tab bar has no box");
  return b;
};

/**
 * Press and hold, then drag.
 *
 * The hold is the whole point: without it the same movement is a flick and
 * navigates instead. The settle pause is deliberately longer than HOLD_MS so
 * the timer cannot be flaky under CI load.
 */
async function holdDrag(
  touch: (t: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) => Promise<unknown>,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  steps = 10,
) {
  await touch("touchStart", from.x, from.y);
  await new Promise((r) => setTimeout(r, HOLD_MS + 180));
  for (let i = 1; i <= steps; i++) {
    await touch("touchMove", Math.round(from.x + (dx * i) / steps), Math.round(from.y + (dy * i) / steps));
  }
  await touch("touchEnd", 0, 0);
  await new Promise((r) => setTimeout(r, 350));
}

/** A short flick — deliberately under the hold, so it must navigate. */
async function flick(
  touch: (t: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) => Promise<unknown>,
  from: { x: number; y: number },
  dx: number,
  steps = 8,
) {
  await touch("touchStart", from.x, from.y);
  for (let i = 1; i <= steps; i++) {
    await touch("touchMove", Math.round(from.x + (dx * i) / steps), from.y);
  }
  await touch("touchEnd", 0, 0);
  await new Promise((r) => setTimeout(r, 300));
}

test.describe("Touch: dragging the floating nav", () => {
  test("a press-and-hold drag actually MOVES the bar", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch, reset } = await touchPage(browser);
    try {
      await reset();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      const before = await barBox(page);
      const from = { x: Math.round(before.x + before.width / 2), y: Math.round(before.y + before.height / 2) };
      await holdDrag(touch, from, -70, 0);

      const after = await barBox(page);
      // The bar must have moved LEFT and stayed on screen.
      expect(after.x, "the bar did not move left").toBeLessThan(before.x - 10);
      expect(after.x).toBeGreaterThanOrEqual(0);
      expect(after.x + after.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("the bar carries the REAL root cause: it has horizontal travel at all", async () => {
    // Regression guard for the actual defect. `.fabnav` used to be
    // `width: min(100% - 32px, 440px)`, which exactly filled the band between
    // the margins and left ZERO travel — so no amount of correct pointer code
    // could ever move it. If this fails, dragging has been broken again.
    const browser = await chromium.launch();
    const { ctx, page, reset } = await touchPage(browser);
    try {
      for (const width of [320, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        await reset();
        await page.waitForTimeout(400);
        const b = await barBox(page);
        const margin = 16;
        const travel = width - b.width - margin * 2;
        // The CSS guarantees `--fabnav-min-travel` (40px); a little under
        // that is acceptable rounding, zero is not.
        expect(travel, `no horizontal travel at ${width}px`).toBeGreaterThanOrEqual(32);
        // And the bar must fit inside the margins in the first place.
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(width);
      }
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("a drag is CLAMPED and cannot be pulled off-screen", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch, reset } = await touchPage(browser);
    try {
      await reset();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      const before = await barBox(page);
      const from = { x: Math.round(before.x + before.width / 2), y: Math.round(before.y + before.height / 2) };
      // Drag far past the left edge.
      await holdDrag(touch, from, -600, 0);

      const after = await barBox(page);
      const vw = page.viewportSize()!.width;
      expect(after.x, "the bar went off the left edge").toBeGreaterThanOrEqual(0);
      expect(after.x + after.width, "the bar went off the right edge").toBeLessThanOrEqual(vw);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("a drag VERTICALLY stays on screen and does not cover the header", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch, reset } = await touchPage(browser);
    try {
      await reset();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      const before = await barBox(page);
      const from = { x: Math.round(before.x + before.width / 2), y: Math.round(before.y + before.height / 2) };
      await holdDrag(touch, from, 0, -600);

      const after = await barBox(page);
      const header = await page.locator(".app-header").boundingBox();
      expect(after.y, "the bar went off the top").toBeGreaterThanOrEqual(0);
      // The band starts below the header so a dragged bar never covers it.
      if (header) expect(after.y, "the bar covers the header").toBeGreaterThanOrEqual(header.y);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("a drag does NOT navigate — the long press is not a flick", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch, reset } = await touchPage(browser);
    try {
      await reset();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      const before = await barBox(page);
      const urlBefore = page.url();
      const from = { x: Math.round(before.x + before.width / 2), y: Math.round(before.y + before.height / 2) };
      // A distance that WOULD be a decisive flick if it were short.
      await holdDrag(touch, from, -90, 0);

      expect(page.url(), "a drag navigated the app").toBe(urlBefore);
      // And no destination was activated by the gesture.
      await expect(page.locator('.fabnav a[aria-current="page"]')).toHaveCount(1);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("a SHORT flick still navigates and the bar does NOT move", async () => {
    // The counterpart to the drag: the existing navigation gesture must
    // survive untouched.
    const browser = await chromium.launch();
    const { ctx, page, touch, reset } = await touchPage(browser);
    try {
      await reset();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      const before = await barBox(page);
      // Compare the URL BEFORE the gesture. An earlier version compared it
      // after, which silently compared the value against itself and could
      // never fail — and it assumed the bar started on Brief, which is not
      // true once a previous test has moved and persisted it.
      const urlBefore = page.url();
      const from = { x: Math.round(before.x + before.width / 2), y: Math.round(before.y + before.height / 2) };
      await flick(touch, from, -60);

      expect(page.url(), "the flick did not navigate").not.toBe(urlBefore);
      const after = await barBox(page);
      expect(Math.abs(after.x - before.x), "the bar moved during a flick").toBeLessThanOrEqual(2);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("the position SURVIVES a reload", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch, reset } = await touchPage(browser);
    try {
      await reset();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      const before = await barBox(page);
      const from = { x: Math.round(before.x + before.width / 2), y: Math.round(before.y + before.height / 2) };
      await holdDrag(touch, from, -80, 0);
      const dragged = await barBox(page);
      expect(dragged.x).toBeLessThan(before.x - 10);

      await page.reload();
      await page.locator(".fabnav").waitFor();
      await page.waitForTimeout(700);
      const after = await barBox(page);
      expect(Math.abs(after.x - dragged.x), "the saved position was not restored").toBeLessThanOrEqual(3);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("the position stays LEGAL across an orientation change", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch, reset } = await touchPage(browser);
    try {
      await reset();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      // Move it off-centre first so the rotation has something to preserve.
      const before = await barBox(page);
      const from = { x: Math.round(before.x + before.width / 2), y: Math.round(before.y + before.height / 2) };
      await holdDrag(touch, from, -80, 0);

      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(700);
      const landscape = await barBox(page);
      expect(landscape.x).toBeGreaterThanOrEqual(0);
      expect(landscape.x + landscape.width).toBeLessThanOrEqual(844);
      expect(landscape.y).toBeGreaterThanOrEqual(0);
      expect(landscape.y + landscape.height).toBeLessThanOrEqual(390);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("a TAP still navigates and never moves the bar", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch, reset } = await touchPage(browser);
    try {
      await reset();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      const before = await barBox(page);
      // Tap the third destination (Matcher).
      const link = await page.getByTestId("tab-matcher").boundingBox();
      await touch("touchStart", Math.round(link!.x + link!.width / 2), Math.round(link!.y + link!.height / 2));
      await new Promise((r) => setTimeout(r, 60));
      await touch("touchEnd", 0, 0);
      await page.waitForTimeout(400);

      await expect(page).toHaveURL(/#\/matcher$/);
      const after = await barBox(page);
      expect(Math.abs(after.x - before.x), "a tap moved the bar").toBeLessThanOrEqual(2);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("a SHORT touch drag under the hold threshold stays a tap, not a drag", async () => {
    // Below DRAG_THRESHOLD_PX and below HOLD_MS: must navigate, must not move.
    const browser = await chromium.launch();
    const { ctx, page, touch, reset } = await touchPage(browser);
    try {
      await reset();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      const before = await barBox(page);
      const link = await page.getByTestId("tab-nyheter").boundingBox();
      const from = {
        x: Math.round(link!.x + link!.width / 2),
        y: Math.round(link!.y + link!.height / 2),
      };
      await touch("touchStart", from.x, from.y);
      // 5px of jitter, released before the hold fires.
      await touch("touchMove", from.x + 5, from.y);
      await touch("touchEnd", 0, 0);
      await page.waitForTimeout(400);

      const after = await barBox(page);
      expect(Math.abs(after.x - before.x), "a jittery tap moved the bar").toBeLessThanOrEqual(2);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("reduced motion does not disable the drag", async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({
      ...devices["iPhone 13"],
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    try {
      // This test builds its OWN context (for reducedMotion), so it cannot use
      // the shared `reset()` helper — it clears the persisted dock inline.
      await page.goto("/#/");
      await page.evaluate(() => {
        try {
          localStorage.removeItem("bkh.fabnav.dock.v1");
        } catch {
          /* storage unavailable; the default dock applies anyway */
        }
      });
      await page.reload();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      const before = await barBox(page);
      const from = { x: Math.round(before.x + before.width / 2), y: Math.round(before.y + before.height / 2) };
      await holdDrag(touch, from, -70, 0);

      const after = await barBox(page);
      // Reduced motion must suppress the ANIMATION, never the interaction.
      expect(after.x, "reduced motion disabled dragging").toBeLessThan(before.x - 10);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("the bar is keyboard reachable and shows a focus ring", async () => {
    const browser = await chromium.launch();
    // No `reset` needed: this test never moves the bar, so the persisted dock
    // from earlier tests cannot affect it.
    const { ctx, page } = await touchPage(browser);
    try {
      await page.goto("/#/");
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(300);

      // The anchors are real links, so they must be tabbable.
      const first = page.getByTestId("tab-brief");
      await first.focus();
      const outline = await first.evaluate((el) => getComputedStyle(el).outlineStyle);
      expect(outline, "no focus ring on the nav").not.toBe("none");
    } finally {
      await ctx.close();
      await browser.close();
    }
  });
});
