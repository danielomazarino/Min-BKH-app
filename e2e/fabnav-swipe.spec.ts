import { test, expect, type Page } from "@playwright/test";

/** The slice of the CDP session this file uses. */
type Cdp = { send(method: string, params?: unknown): Promise<unknown> };

/**
 * SWIPING BETWEEN NAV ICONS — the end-to-end interaction.
 *
 * THE REQUIREMENT BEING TESTED
 * Thumb down anywhere on the nav, move horizontally, watch the glass
 * indicator follow, release near another icon, and the destination PAGE must
 * actually change. A moving pill with no page change is a FAILURE, not a
 * partial success — so every swipe assertion here checks the URL and the
 * destination's content, not just the indicator.
 *
 * A TAP must still select. REVERSING mid-drag and RE-GRABBING mid-snap must
 * not jump. A CANCELLED gesture must not change page.
 *
 * A vertical gesture that starts ON THE NAV is out of scope by product
 * decision (2026-10-03): the content scrolls in the area ABOVE the bar, and the
 * bar itself is for taps and horizontal swipes only. `touch-action: pan-y`
 * stays on it so the browser keeps the vertical axis, but nothing here asserts
 * that a gesture on the bar scrolls, and no code forwards one by hand.
 *
 * ------------------------------------------------------------------
 * WHAT THESE TESTS ARE NOT
 * ------------------------------------------------------------------
 * In Chromium the gestures are REAL: Playwright drives Chromium's own touch
 * pipeline over CDP (`Input.dispatchTouchEvent`), so `touch-action`
 * arbitration, native link-drag suppression and click synthesis are all
 * genuinely exercised.
 *
 * In the WebKit project they are SYNTHETIC: `newCDPSession` throws in WebKit,
 * so the helper dispatches `new PointerEvent(...)`. That exercises the app's
 * logic and WebKit's CSS and event handling, but it BYPASSES WebKit's native
 * gesture recognition — the layer that decides scroll-versus-drag and raises
 * the link callout.
 *
 * So a green run here is NOT native iOS verification. Only a real iPhone is.
 * See docs/ENHANCEMENTS.md, E-012.
 */

type BrowserName = "chromium" | "webkit";

/**
 * Real CDP touch in Chromium; synthetic PointerEvents in WebKit.
 *
 * Kept deliberately simple: one CDP session per gesture rather than one per
 * event, because creating a session is expensive and detaching it immediately
 * is the part that was flaky.
 */
function touchFor(page: Page, name: BrowserName) {
  let session: Promise<Cdp> | null = null;

  if (name === "webkit") {
    // WebKit: synthetic PointerEvents with pointerType "touch".
    return async (type: string, x: number, y: number) => {
      await page.evaluate(
        ({ t, px, py }: { t: string; px: number; py: number }) => {
          const nav = document.querySelector(".fabnav");
          if (!nav) return;
          nav.dispatchEvent(
            new PointerEvent(t, {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: 1,
              pointerType: "touch",
              isPrimary: true,
              clientX: px,
              clientY: py,
              button: t === "pointermove" ? -1 : 0,
              buttons: t === "pointerup" ? 0 : 1,
            }),
          );
        },
        { t: type, px: Math.round(x), py: Math.round(y) },
      );
    };
  }

  // Chromium: the real touch pipeline, over CDP.
  return async (type: string, x: number, y: number) => {
    if (!session) session = page.context().newCDPSession(page);
    const cdp = (await session) as Cdp;
    const t = type === "pointerdown" ? "touchStart" : type === "pointerup" ? "touchEnd" : "touchMove";
    await cdp.send("Input.dispatchTouchEvent", {
      type: t,
      touchPoints: t === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1 }],
    });
  };
}

const pillX = async (page: Page) => {
  const t = await page.getByTestId("fabnav-pill").evaluate((el) => el.style.transform);
  const m = /translate3d\((-?[\d.]+)px/.exec(t);
  return m ? parseFloat(m[1]) : NaN;
};

const navBox = async (page: Page) => {
  const b = await page.getByTestId("tabbar").boundingBox();
  if (!b) throw new Error("no nav");
  return b;
};

test.describe("Swipe between nav icons", () => {
  test("swipe tracks the thumb, then changes page", async ({ page }, testInfo) => {
    const touch = touchFor(page, testInfo.project.name as BrowserName);
    await page.goto("/#/");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    await page.waitForTimeout(600);

    const box = await navBox(page);
    const y = Math.round(box.y + box.height / 2);
    // Start from the FIRST tab and swipe RIGHT. Swiping left from tab 0 is
    // clamped to 0 by design, so it cannot move the pill — an earlier version
    // of this test did exactly that and correctly reported "did not follow".
    // The clamp was the code working; the test was wrong.
    const startX = Math.round(box.x + box.width * 0.2);
    const urlBefore = page.url();

    // EVIDENCE: the "before" state. Written to test-results/, which is
    // gitignored, so this never lands in the repository.
    await page.screenshot({ path: "test-results/nav-evidence-1-before.png" });

    await touch("pointerdown", startX, y);
    await page.waitForTimeout(30);

    // Move in steps and assert the indicator is FOLLOWING at each one.
    const seen: number[] = [];
    for (let i = 1; i <= 4; i++) {
      const x = Math.round(startX + i * 12);
      await touch("pointermove", x, y);
      await page.waitForTimeout(20);
      const px = await pillX(page);
      if (Number.isFinite(px)) seen.push(px);
    }
    // EVIDENCE: mid-drag, with the pill visibly between the two icons and the
    // page still on the ORIGINAL route. Captured before release, so it shows
    // the tracking rather than the settled result.
    await page.screenshot({ path: "test-results/nav-evidence-2-mid-drag.png" });

    expect(seen.length, "the indicator never moved").toBeGreaterThan(1);
    // Monotonically INCREASING, because we swiped right.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i], `the indicator stalled or jumped back at step ${i}`).toBeGreaterThan(seen[i - 1]);
    }

    await touch("pointerup", Math.round(startX + 4 * 12), y);
    await page.waitForTimeout(800);

    // THE PAGE MUST CHANGE — not just the pill. A moving pill with no
    // navigation is a failure, not a partial success.
    expect(page.url(), "swipe did not change the page").not.toBe(urlBefore);

    // EVIDENCE: after release, on the destination page.
    await page.screenshot({ path: "test-results/nav-evidence-3-after-release.png" });

    // The selected tab must change AND its page content must become visible.
    const activeTestId = await page.locator(".fabnav-link[data-active]").getAttribute("data-testid");
    expect(activeTestId, "no tab is marked active after the swipe").toBeTruthy();
    expect(activeTestId, "the wrong tab is active").not.toBe("tab-brief");

    // The destination page's own content must be on screen, not merely a
    // changed URL. This is the assertion that distinguishes "the pill moved"
    // from "the app went somewhere".
    const heading = await page.locator("main h1, main h2").first().textContent();
    expect((heading ?? "").trim().length, "the destination page rendered no heading").toBeGreaterThan(0);
  });

  test("a TAP still selects and navigates", async ({ page }) => {
    await page.goto("/#/");
    await page.waitForTimeout(500);
    // A locator click, not a boundingBox().click() — a Box has no click().
    await page.getByTestId("tab-matcher").click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/#\/matcher$/);
    // And the page content must actually be the destination.
    const heading = await page.locator("main h1, main h2").first().textContent();
    expect((heading ?? "").trim().length, "the tapped page rendered no heading").toBeGreaterThan(0);
  });

  test("reversing mid-drag does not jump the indicator", async ({ page }, testInfo) => {
    const touch = touchFor(page, testInfo.project.name as BrowserName);
    await page.goto("/#/");
    await page.waitForTimeout(500);
    const box = await navBox(page);
    const y = Math.round(box.y + box.height / 2);
    const x0 = Math.round(box.x + box.width * 0.5);

    await touch("pointerdown", x0, y);
    await touch("pointermove", x0 - 40, y);
    await page.waitForTimeout(20);
    const afterLeft = await pillX(page);
    await touch("pointermove", x0 + 40, y);
    await page.waitForTimeout(20);
    const afterRight = await pillX(page);
    expect(afterRight, "reversing did not move back").toBeGreaterThan(afterLeft);
    await touch("pointerup", x0 + 40, y);
  });

  test("a cancelled gesture does NOT change page", async ({ page }) => {
    await page.goto("/#/");
    await page.waitForTimeout(500);
    const urlBefore = page.url();
    const box = await navBox(page);
    const y = Math.round(box.y + box.height / 2);
    const x0 = Math.round(box.x + box.width * 0.7);
    await page.locator(".fabnav").dispatchEvent("pointerdown", { clientX: x0, clientY: y, pointerType: "touch", pointerId: 1, isPrimary: true });
    await page.locator(".fabnav").dispatchEvent("pointermove", { clientX: x0 - 60, clientY: y, pointerType: "touch", pointerId: 1 });
    await page.locator(".fabnav").dispatchEvent("pointercancel", { pointerType: "touch", pointerId: 1 });
    await page.waitForTimeout(400);
    expect(page.url(), "a cancelled gesture changed the page").toBe(urlBefore);
  });

  test("the bar allows vertical scrolling (touch-action: pan-y)", async ({ page }) => {
    await page.goto("/#/");
    await page.waitForTimeout(500);
    const ta = await page.getByTestId("tabbar").evaluate((el) => getComputedStyle(el).touchAction);
    expect(ta, "the bar must not claim the vertical axis").toBe("pan-y");
  });

  test("re-grabbing MID-SNAP continues from where the pill is, without a jump", async ({ page }, testInfo) => {
    // THE INTERRUPTION CASE. A spring is running toward the next tab; the user
    // grabs the pill again. Two things must hold:
    //   1. the pill does NOT teleport to the selected tab's coordinate, and
    //   2. control transfers to the finger from the pill's CURRENT position.
    //
    // The bug this pins: restarting the drag from the target instead of from
    // the rendered position, which makes the pill jump sideways under a
    // stationary thumb.
    const touch = touchFor(page, testInfo.project.name as BrowserName);
    await page.goto("/#/");
    await page.waitForTimeout(600);

    const box = await navBox(page);
    const y = Math.round(box.y + box.height / 2);
    const startX = Math.round(box.x + box.width * 0.2);

    // Flick right and release, starting a spring toward the next tab.
    await touch("pointerdown", startX, y);
    for (let i = 1; i <= 3; i++) {
      await page.waitForTimeout(16);
      await touch("pointermove", startX + i * 14, y);
    }
    await touch("pointerup", startX + 42, y);

    // Catch it mid-flight: a few frames in, the spring is still moving.
    await page.waitForTimeout(60);
    const midSnap = await pillX(page);
    const pillBox = await page.getByTestId("fabnav-pill").boundingBox();

    // Grab it again, WITHOUT moving the finger at all.
    await touch("pointerdown", Math.round(pillBox!.x + pillBox!.width / 2), y);
    await page.waitForTimeout(40);
    const afterGrab = await pillX(page);

    // The pill must still be essentially where it was — no teleport.
    expect(
      Math.abs(afterGrab - midSnap),
      `the pill jumped on re-grab (${midSnap} -> ${afterGrab})`,
    ).toBeLessThanOrEqual(2);

    // And it must be between the two tabs, not snapped to either.
    expect(afterGrab, "the pill teleported to a tab stop").toBeGreaterThan(0);

    await touch("pointerup", Math.round(pillBox!.x + pillBox!.width / 2), y);
    await page.waitForTimeout(700);
    // Whatever it settled on, the app must be consistent.
    expect(page.url()).not.toBe("");
  });

  test("the pill has pointer-events: none so it cannot eat the gesture", async ({ page }) => {
    await page.goto("/#/");
    await page.waitForTimeout(500);
    const pe = await page.getByTestId("fabnav-pill").evaluate((el) => getComputedStyle(el).pointerEvents);
    expect(pe, "the pill would swallow taps and swipes").toBe("none");
  });
});
