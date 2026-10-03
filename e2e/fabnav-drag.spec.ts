import { test, expect, type Page, type Browser } from "@playwright/test";
import { chromium, devices } from "@playwright/test";

/**
 * DRAGGING the floating navigation bar.
 *
 * THE BAR IS ALWAYS HORIZONTALLY CENTRED
 * It can only be dragged UP and DOWN. There is no left/right dock: that was
 * removed rather than left dormant, because one stray `x` in the dock is all it
 * takes for the bar to start docking to the edges again. `leftFor` takes only
 * a width, so there is no code path that could produce a horizontal position.
 *
 * THE THREE GESTURES
 * `touch.spec.ts` and `navigation.spec.ts` assert that a SHORT HORIZONTAL
 * FLICK changes destination and that the bar stays pinned during it. Both
 * still hold. Together with this file the contract is:
 *
 *   horizontal flick -> navigate, bar does not move
 *   vertical drag    -> move the bar up or down, no navigation
 *   tap              -> navigate
 *
 * The axis is what separates them, and it is decided by movement rather than
 * by a timer. That replaced a press-and-hold trigger which could never be
 * trusted: see the WebKit note on `holdMsFor`.
 *
 * ALL GESTURES USE REAL CDP TOUCH, NOT page.mouse
 * `touch-action` is only consulted for touch input, and a touch gesture
 * synthesises `click` under different conditions than a mouse one. A mouse
 * drag therefore cannot exercise the arbitration that actually broke on a
 * real phone — that mistake previously made the whole suite report the
 * gesture as working while human testing found it dead.
 */

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
   * Start from a KNOWN vertical position.
   *
   * The position is persisted in localStorage, so without this a test that
   * moves the bar changes the starting point for every test after it. That is
   * not theoretical: an earlier version of this file had a "flick navigates"
   * test fail because a previous test had left the bar on `#/nyheter` and a
   * left flick correctly went backwards.
   */
  const reset = async () => {
    await page.goto("/#/");
    await page.evaluate(() => {
      try {
        localStorage.removeItem("bkh.fabnav.dock.v1");
      } catch {
        /* storage unavailable; the default position applies anyway */
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
 * Drag the bar VERTICALLY.
 *
 * Slow and steady on purpose: a fast vertical move is not the drag gesture, and
 * the horizontal axis is left completely still so the axis test is unambiguous.
 */
async function dragVertical(
  touch: (t: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) => Promise<unknown>,
  from: { x: number; y: number },
  dy: number,
  steps = 12,
) {
  await touch("touchStart", from.x, from.y);
  for (let i = 1; i <= steps; i++) {
    // A 12ms pause per step keeps the speed well under any flick threshold.
    await new Promise((r) => setTimeout(r, 12));
    await touch("touchMove", from.x, Math.round(from.y + (dy * i) / steps));
  }
  await touch("touchEnd", 0, 0);
  await new Promise((r) => setTimeout(r, 350));
}

/** A short HORIZONTAL flick — the navigation gesture, which must be untouched. */
async function flickHorizontal(
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

/** Centre the bar in the viewport, to within a pixel. */
const centredness = async (page: Page) => {
  const b = await barBox(page);
  const vw = page.viewportSize()!.width;
  return Math.abs(b.x - (vw - b.x - b.width));
};

test.describe("Touch: dragging the floating nav", () => {
  test("a vertical drag MOVES the bar up", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch, reset } = await touchPage(browser);
    try {
      await reset();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      const before = await barBox(page);
      const from = { x: Math.round(before.x + before.width / 2), y: Math.round(before.y + before.height / 2) };
      await dragVertical(touch, from, -160);

      const after = await barBox(page);
      expect(after.y, "the bar did not move up").toBeLessThan(before.y - 40);
      expect(after.y, "the bar went off the top").toBeGreaterThanOrEqual(0);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("the bar is HORIZONTALLY CENTRED at rest and after a drag", async () => {
    // The requirement this whole file now exists to protect.
    const browser = await chromium.launch();
    const { ctx, page, touch, reset } = await touchPage(browser);
    try {
      await reset();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      expect(await centredness(page), "not centred at rest").toBeLessThanOrEqual(1);

      const before = await barBox(page);
      const from = { x: Math.round(before.x + before.width / 2), y: Math.round(before.y + before.height / 2) };
      // Drag up AND sideways at once: a naive implementation would take the x.
      await dragVertical(touch, from, -150);
      expect(await centredness(page), "not centred after a drag").toBeLessThanOrEqual(1);

      // And at several widths, including after a resize.
      for (const width of [320, 390, 430, 844]) {
        await page.setViewportSize({ width, height: 844 });
        await page.waitForTimeout(400);
        expect(await centredness(page), `not centred at ${width}px`).toBeLessThanOrEqual(1);
      }
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("a diagonal drag does NOT move the bar sideways", async () => {
    // Even with real horizontal travel in the gesture, `left` must not change.
    const browser = await chromium.launch();
    const { ctx, page, touch, reset } = await touchPage(browser);
    try {
      await reset();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      const before = await barBox(page);
      const from = { x: Math.round(before.x + before.width / 2), y: Math.round(before.y + before.height / 2) };
      await touch("touchStart", from.x, from.y);
      for (let i = 1; i <= 12; i++) {
        await new Promise((r) => setTimeout(r, 12));
        // Move up and to the left together.
        await touch("touchMove", Math.round(from.x - i * 10), Math.round(from.y - i * 12));
      }
      await touch("touchEnd", 0, 0);
      await page.waitForTimeout(350);

      const after = await barBox(page);
      expect(after.x, "the bar moved horizontally").toBe(before.x);
      expect(await centredness(page), "not centred after a diagonal drag").toBeLessThanOrEqual(1);
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
      await dragVertical(touch, from, -900);

      const after = await barBox(page);
      const vh = page.viewportSize()!.height;
      const header = await page.locator(".app-header").boundingBox();
      expect(after.y, "the bar went off the top").toBeGreaterThanOrEqual(0);
      expect(after.y + after.height, "the bar went off the bottom").toBeLessThanOrEqual(vh);
      // The band starts below the header so a dragged bar never covers it.
      if (header) expect(after.y, "the bar covers the header").toBeGreaterThanOrEqual(header.y);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("a drag does NOT navigate", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch, reset } = await touchPage(browser);
    try {
      await reset();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      const urlBefore = page.url();
      const before = await barBox(page);
      const from = { x: Math.round(before.x + before.width / 2), y: Math.round(before.y + before.height / 2) };
      await dragVertical(touch, from, -170);

      expect(page.url(), "a drag navigated the app").toBe(urlBefore);
      await expect(page.locator('.fabnav a[aria-current="page"]')).toHaveCount(1);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("a SHORT horizontal flick still navigates and the bar does NOT move", async () => {
    // The counterpart: the existing navigation gesture must survive untouched.
    const browser = await chromium.launch();
    const { ctx, page, touch, reset } = await touchPage(browser);
    try {
      await reset();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      const before = await barBox(page);
      // Captured BEFORE the gesture; comparing after would compare it with itself.
      const urlBefore = page.url();
      const from = { x: Math.round(before.x + before.width / 2), y: Math.round(before.y + before.height / 2) };
      await flickHorizontal(touch, from, -60);

      expect(page.url(), "the flick did not navigate").not.toBe(urlBefore);
      const after = await barBox(page);
      expect(after.y, "the bar moved vertically during a horizontal flick").toBe(before.y);
      expect(after.x, "the bar moved horizontally during a flick").toBe(before.x);
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
      await dragVertical(touch, from, -170);
      const dragged = await barBox(page);
      expect(dragged.y).toBeLessThan(before.y - 40);

      await page.reload();
      await page.locator(".fabnav").waitFor();
      await page.waitForTimeout(700);
      const after = await barBox(page);
      expect(Math.abs(after.y - dragged.y), "the saved position was not restored").toBeLessThanOrEqual(3);
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

      const before = await barBox(page);
      const from = { x: Math.round(before.x + before.width / 2), y: Math.round(before.y + before.height / 2) };
      await dragVertical(touch, from, -170);

      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(700);
      const landscape = await barBox(page);
      expect(landscape.y).toBeGreaterThanOrEqual(0);
      expect(landscape.y + landscape.height).toBeLessThanOrEqual(390);
      expect(await centredness(page), "not centred in landscape").toBeLessThanOrEqual(1);
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
      const link = await page.getByTestId("tab-matcher").boundingBox();
      await touch("touchStart", Math.round(link!.x + link!.width / 2), Math.round(link!.y + link!.height / 2));
      await new Promise((r) => setTimeout(r, 60));
      await touch("touchEnd", 0, 0);
      await page.waitForTimeout(400);

      await expect(page).toHaveURL(/#\/matcher$/);
      const after = await barBox(page);
      expect(after.y, "a tap moved the bar").toBe(before.y);
      expect(after.x, "a tap moved the bar sideways").toBe(before.x);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("a DELAYED horizontal flick is not stolen by the stationary-press hold", async () => {
    // THE RACE THIS PINS.
    //
    // The stationary-press hold is a fallback for a finger that never moves.
    // But the first touchmove can arrive LATE — under CPU load, 8 undelayed
    // moves put it past the 90ms touch hold. The hold then promoted the gesture
    // to a drag before the axis had ever been evaluated, so a horizontal flick
    // that should have navigated did not.
    //
    // The signature was genuinely confusing: this test PASSED when run alone
    // and FAILED inside the full suite, which is exactly what a timing race
    // looks like and the reason it is worth pinning deterministically.
    //
    // Here the race is forced rather than hoped for: hold still for longer than
    // the hold, THEN travel sideways. The hold will have promoted the gesture,
    // and the bar must still recognise this as the navigation swipe.
    const browser = await chromium.launch();
    const { ctx, page, touch, reset } = await touchPage(browser);
    try {
      await reset();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      const before = await barBox(page);
      const urlBefore = page.url();
      const from = { x: Math.round(before.x + before.width / 2), y: Math.round(before.y + before.height / 2) };

      await touch("touchStart", from.x, from.y);
      // Longer than HOLD_MS_IOS (90ms), so the hold definitely fires.
      await page.waitForTimeout(400);
      const lifted = await page.locator(".fabnav").getAttribute("data-lifted");
      expect(lifted, "the hold should have picked the bar up before the move").not.toBeNull();
      // Now travel sideways, as the delayed flick does.
      for (let i = 1; i <= 8; i++) {
        await touch("touchMove", Math.round(from.x - i * 8), from.y);
      }
      await touch("touchEnd", 0, 0);
      await page.waitForTimeout(400);

      expect(page.url(), "the delayed flick did not navigate").not.toBe(urlBefore);
      const after = await barBox(page);
      expect(after.y, "a horizontal flick moved the bar vertically").toBe(before.y);
      expect(after.x, "a horizontal flick moved the bar horizontally").toBe(before.x);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("a jittery touch stays a tap, not a drag", async () => {
    // Below DRAG_THRESHOLD_PX: must navigate, must not move.
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
      await touch("touchMove", from.x, from.y + 4);
      await touch("touchEnd", 0, 0);
      await page.waitForTimeout(400);

      const after = await barBox(page);
      expect(after.y, "a jittery tap moved the bar").toBe(before.y);
      await expect(page).toHaveURL(/#\/nyheter$/);
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
      // This context is its own, so the persisted position is cleared inline.
      await page.goto("/#/");
      await page.evaluate(() => {
        try {
          localStorage.removeItem("bkh.fabnav.dock.v1");
        } catch {
          /* storage unavailable; the default position applies anyway */
        }
      });
      await page.reload();
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(500);

      const before = await barBox(page);
      const from = { x: Math.round(before.x + before.width / 2), y: Math.round(before.y + before.height / 2) };
      await dragVertical(touch, from, -170);

      const after = await barBox(page);
      // Reduced motion must suppress the ANIMATION, never the interaction.
      expect(after.y, "reduced motion disabled dragging").toBeLessThan(before.y - 40);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("iOS is not made to wait past its own link-callout threshold", async () => {
    // WebKit raises an "Open in New Tab / Add to Home Screen" callout after a
    // stationary press on a LINK, at roughly 500ms. The bar is five real
    // <a href> elements, so a press-and-hold lands on one by construction. The
    // callout fires `pointercancel`, killing the gesture: the bar never moved
    // and the user saw a menu instead.
    //
    // Chromium has no such callout, so this CANNOT be asserted by emulating a
    // touch event. What is assertable is the contract that prevents it — the
    // callout is suppressed in the shipped CSS — which is what this pins. The
    // hardware behaviour is recorded as unverified in docs/ENHANCEMENTS.md.
    const browser = await chromium.launch();
    const { ctx, page, reset } = await touchPage(browser);
    try {
      await reset();
      const callouts = await page.evaluate(async () => {
        /**
         * Read the raw stylesheet TEXT, not the CSSOM.
         *
         * Chromium does not implement `-webkit-touch-callout`, so it is parsed
         * as an unknown property and dropped — `rule.cssText` never contains
         * it, and scanning `document.styleSheets` finds nothing even though
         * the declaration ships correctly. Fetching the stylesheet and
         * matching the text is the only way to assert a Safari-only property
         * from Chromium.
         */
        const href = [...document.querySelectorAll("link[rel=stylesheet]")]
          .map((l) => (l as HTMLLinkElement).href)
          .find(Boolean);
        let text = "";
        if (href) text = await (await fetch(href)).text();
        const hits = text.match(/-webkit-touch-callout\s*:\s*none/g) ?? [];
        return {
          hits: hits.length,
          linkCount: document.querySelectorAll(".fabnav-link").length,
        };
      });
      expect(callouts.linkCount, "the bar should be real links, which is why the callout matters").toBe(5);
      // Must appear on BOTH the nav and the link: the property is not
      // inherited, and the link is what the thumb lands on.
      expect(callouts.hits, "no -webkit-touch-callout: none in the served CSS").toBeGreaterThanOrEqual(2);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("a cancelled drag settles somewhere legal instead of stranding the bar", async () => {
    // `pointercancel` is how iOS ends a gesture it takes over. An earlier
    // version returned early on cancel, leaving a stale translate3d with no
    // `top` to fall back on — the "it half-moved then stopped" symptom.
    const browser = await chromium.launch();
    const { ctx, page, reset } = await touchPage(browser);
    try {
      await reset();
      const before = await barBox(page);
      const cx = Math.round(before.x + before.width / 2);
      const cy = Math.round(before.y + before.height / 2);

      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) {
        await page.waitForTimeout(12);
        await page.mouse.move(cx, cy - i * 20);
      }
      // Simulate WebKit taking the gesture over mid-drag.
      await page.evaluate(() => {
        window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: false }));
      });
      await page.mouse.up();
      await page.waitForTimeout(300);

      const after = await barBox(page);
      const vh = page.viewportSize()!.height;
      const transform = await page.evaluate(
        () => (document.querySelector(".fabnav") as HTMLElement).style.transform,
      );
      expect(after.y, "the bar was stranded off-screen by a cancel").toBeGreaterThanOrEqual(0);
      expect(after.y + after.height).toBeLessThanOrEqual(vh);
      expect(transform, "a stale drag transform was left behind").toBe("");
      expect(await centredness(page), "not centred after a cancel").toBeLessThanOrEqual(1);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("the bar is keyboard reachable and shows a focus ring", async () => {
    const browser = await chromium.launch();
    // No `reset` needed: this test never moves the bar, so the persisted
    // position from earlier tests cannot affect it.
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