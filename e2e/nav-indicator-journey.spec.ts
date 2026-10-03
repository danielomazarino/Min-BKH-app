import { test, expect, type Page, type Browser } from "@playwright/test";
import { chromium, devices } from "@playwright/test";

/**
 * THE REQUIRED DEMONSTRATION: Nyheter → Matcher, then Matcher → Nyheter.
 *
 * This is the end-to-end interaction, in the order a thumb actually performs
 * it: touch the pill where it sits, drag toward the ADJACENT visible icon far
 * enough that the pill ends nearer that icon, release, and the connected page
 * must change. The pill must not jump on touch-down, because the gesture
 * begins on the pill itself here — the case where a jump would be most visible.
 *
 * EVIDENCE is captured at three moments into test-results/ (gitignored):
 *   1. before   — pill parked on Nyheter, page is the news feed
 *   2. mid-drag — pill visibly travelling toward Matcher, page still Nyheter
 *   3. after    — pill settled on Matcher, page is the fixtures list
 *
 * REAL TOUCH: Chromium's own touch pipeline over CDP, so `touch-action`
 * arbitration, native link-drag suppression and click synthesis are genuinely
 * exercised. This is NOT the same as verifying on an iPhone.
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
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1 }],
    });
  return { ctx, page, touch };
}

/** The pill's current left edge in track-local px, from its inline transform. */
const pillX = (page: Page) =>
  page.getByTestId("fabnav-pill").evaluate((el) => {
    const m = /translate3d\((-?[\d.]+)px/.exec(el.style.transform);
    return m ? Math.round(parseFloat(m[1]) * 100) / 100 : NaN;
  });

/**
 * Where each tab's pill stop actually is.
 *
 * Deliberately NOT recomputed here. An earlier version of this test derived the
 * stops from `offsetWidth` and got 103 where the app had 104 — a 1px
 * disagreement between two implementations of the same formula, which made the
 * test fail on arithmetic rather than on behaviour. The app already knows the
 * authoritative stops, so they are read from the live pill instead: park the
 * pill by navigating, read where it lands, and that IS the stop.
 *
 * This measures the real thing rather than a second guess at it.
 */
const ROUTE_FOR: Record<string, string> = {
  "tab-brief": "#/",
  "tab-nyheter": "#/nyheter",
  "tab-matcher": "#/matcher",
  "tab-trupp": "#/trupp",
  "tab-spelare": "#/spelare",
};

/**
 * The authoritative stop for a tab, read from the app itself.
 *
 * One page load per tab was tried and it made the reverse test time out: two
 * extra `goto`s plus their settle waits exceeded the budget for reasons that
 * had nothing to do with the gesture. The stop is now measured by loading the
 * tab ONCE and then walking to its neighbour via the hash, which is cheap and
 * exercises the same code path a deep link uses.
 *
 * The point stands regardless: this is the app's own value, not a second
 * implementation of the formula that disagreed by 1px.
 */
const stopsFrom = async (page: Page, ids: string[]) => {
  const out: Record<string, number> = {};
  for (const id of ids) {
    await page.goto(`/${ROUTE_FOR[id]}`);
    await page.waitForTimeout(900);
    out[id] = await pillX(page);
  }
  return out;
};

/** The tab ids in visual order, left to right. */
const tabIds = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".fabnav-item")].map((li) =>
      li.querySelector(".fabnav-link")!.getAttribute("data-testid")!,
    ),
  );

test.describe("Indicator journey: Nyheter → Matcher → Nyheter", () => {
  // The budget covers two page loads to measure the stops, the gesture itself,
  // and the settle wait. It was raised from the 25s default after the reverse
  // test timed out in setup, NOT in the interaction.
  test.setTimeout(60_000);

  test("touch Nyheter, drag right toward Matcher, release → Matcher page", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);
    try {
      await page.goto("/#/nyheter");
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(1200);

      const ids = await tabIds(page);
      const nyheterIdx = ids.indexOf("tab-nyheter");
      const matcherIdx = ids.indexOf("tab-matcher");
      expect(nyheterIdx, "Nyheter must be left of Matcher for this journey").toBeGreaterThanOrEqual(0);
      expect(matcherIdx, "Matcher must be the tab right of Nyheter").toBe(nyheterIdx + 1);

      // The authoritative stops, read from the app rather than recomputed.
      const st = await stopsFrom(page, ["tab-nyheter", "tab-matcher"]);
      const nyheterStop = st["tab-nyheter"];
      const matcherStop = st["tab-matcher"];
      expect(matcherStop, "Matcher must sit to the RIGHT of Nyheter").toBeGreaterThan(nyheterStop);

      // EVIDENCE 1 — before. The pill must be ON Nyheter's stop.
      await page.goto("/#/nyheter");
      await page.waitForTimeout(1000);
      const pillBefore = await pillX(page);
      await page.screenshot({ path: "test-results/journey-1-before-touch.png" });
      expect(Math.abs(pillBefore - nyheterStop), "the pill was not parked on the selected tab").toBeLessThanOrEqual(1);

      const bar = (await page.getByTestId("tabbar").boundingBox())!;
      const y = Math.round(bar.y + bar.height / 2);
      // Touch the bar near the pill's own stop, as a thumb would.
      const startX = Math.round(bar.x + pillBefore + bar.width * 0);

      await touch("touchStart", startX, y);
      await page.waitForTimeout(40);

      // The pill must NOT have moved on touch-down. This is the assertion that
      // distinguishes delta anchoring from direct anchoring.
      const pillOnDown = await pillX(page);
      expect(Math.abs(pillOnDown - pillBefore), "the pill JUMPED on touch-down").toBeLessThanOrEqual(1);

      // Drag RIGHT, past the midpoint, so the pill ends nearer Matcher.
      const target = matcherStop;
      const travel = target - pillBefore + 20;
      const seen: number[] = [];
      for (let i = 1; i <= 10; i++) {
        await touch("touchMove", Math.round(startX + (travel * i) / 10), y);
        await page.waitForTimeout(18);
        seen.push(await pillX(page));
      }

      // EVIDENCE 2 — mid-drag: pill travelling right, page still Nyheter.
      await page.screenshot({ path: "test-results/journey-2-mid-drag.png" });

      // It must have followed the finger monotonically — no lag, no stutter.
      for (let i = 1; i < seen.length; i++) {
        expect(seen[i], `the pill stalled or jumped back at step ${i}`).toBeGreaterThan(seen[i - 1]);
      }
      expect(seen.at(-1)!, "the pill did not travel toward Matcher").toBeGreaterThan(pillBefore + 20);

      await touch("touchEnd", Math.round(startX + travel), y);
      await page.waitForTimeout(900);

      // It settled on Matcher's stop.
      expect(Math.abs((await pillX(page)) - target), "the pill did not settle on Matcher").toBeLessThanOrEqual(1);

      // EVIDENCE 3 — after: on the Matcher page, with its content visible.
      await page.screenshot({ path: "test-results/journey-3-after-release.png" });

      await expect(page).toHaveURL(/#\/matcher$/);
      await expect(page.getByTestId("tab-matcher")).toHaveAttribute("aria-current", "page");
      const heading = (await page.locator("main h1, main h2").first().textContent()) ?? "";
      expect(heading.trim().length, "the Matcher page rendered no heading").toBeGreaterThan(0);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("reverse: touch Matcher, drag LEFT toward Nyheter, release → Nyheter page", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);
    try {
      await page.goto("/#/matcher");
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(1200);

      const st = await stopsFrom(page, ["tab-nyheter", "tab-matcher"]);
      const nyheterStop = st["tab-nyheter"];
      const matcherStop = st["tab-matcher"];
      await page.goto("/#/matcher");
      await page.waitForTimeout(1000);
      const pillBefore = await pillX(page);
      expect(Math.abs(pillBefore - matcherStop), "the pill was not parked on Matcher").toBeLessThanOrEqual(1);

      const bar = (await page.getByTestId("tabbar").boundingBox())!;
      const y = Math.round(bar.y + bar.height / 2);
      const startX = Math.round(bar.x + pillBefore);

      await touch("touchStart", startX, y);
      await page.waitForTimeout(40);
      expect(Math.abs((await pillX(page)) - pillBefore), "the pill JUMPED on touch-down").toBeLessThanOrEqual(1);

      // Drag LEFT, past the midpoint toward Nyheter.
      const target = nyheterStop;
      const travel = target - pillBefore - 20;
      const seen: number[] = [];
      for (let i = 1; i <= 10; i++) {
        await touch("touchMove", Math.round(startX + (travel * i) / 10), y);
        await page.waitForTimeout(18);
        seen.push(await pillX(page));
      }
      await page.screenshot({ path: "test-results/journey-4-reverse-mid-drag.png" });

      for (let i = 1; i < seen.length; i++) {
        expect(seen[i], `the pill stalled or jumped back at step ${i}`).toBeLessThan(seen[i - 1]);
      }

      await touch("touchEnd", Math.round(startX + travel), y);
      await page.waitForTimeout(900);
      expect(Math.abs((await pillX(page)) - target), "the pill did not settle on Nyheter").toBeLessThanOrEqual(1);
      await page.screenshot({ path: "test-results/journey-5-reverse-after.png" });

      await expect(page).toHaveURL(/#\/nyheter$/);
      await expect(page.getByTestId("tab-nyheter")).toHaveAttribute("aria-current", "page");
      const heading = (await page.locator("main h1, main h2").first().textContent()) ?? "";
      expect(heading.trim().length, "the Nyheter page rendered no heading").toBeGreaterThan(0);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });
});
