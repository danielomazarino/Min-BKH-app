import { expect, type Page } from "@playwright/test";

/**
 * REAL TOUCH DRAG HELPERS for the navigation indicator.
 *
 * WHY THESE EXIST AS NAMED HELPERS
 * Every swipe test needs the same three things: start the drag on or near the
 * pill, travel far enough to actually reach the neighbouring stop, and observe
 * what the pill did. Written inline, each test re-derived those numbers by hand
 * and they drifted apart — which is how a test came to assert "swiping left
 * advances" while its own coordinates swiped right.
 *
 * Each helper names the INTENT, not the mechanics:
 *   dragIndicatorToAdjacentTab()  - move to the neighbour in a given direction
 *   dragIndicatorBeyondFirstStop() - push against the first tab's clamp
 *   dragIndicatorBeyondLastStop()  - push against the last tab's clamp
 *
 * THE GEOMETRY IS READ FROM THE APP, NEVER RECOMPUTED
 * `renderedStops()` navigates to each tab and reads where the pill actually
 * rests. An earlier version derived the stops from `offsetWidth` and disagreed
 * with the app by 1px (103 vs 104) — two implementations of one formula. The
 * app already knows the authoritative value, so it is read rather than guessed.
 *
 * The GESTURE is always real touch dispatched over CDP. These helpers never
 * call the app's geometry functions to simulate a success; they move a finger
 * and then read the DOM.
 */

/** The slice of the CDP session these helpers use. */
type Cdp = { send(method: string, params?: unknown): Promise<unknown> };

export type Direction = "left" | "right";

const ROUTE_FOR: Record<string, string> = {
  "tab-brief": "#/",
  "tab-nyheter": "#/nyheter",
  "tab-matcher": "#/matcher",
  "tab-trupp": "#/trupp",
  "tab-spelare": "#/spelare",
};

/** Ordered tab test ids, left to right. Fixed by contract. */
export const TAB_IDS = [
  "tab-brief",
  "tab-nyheter",
  "tab-matcher",
  "tab-trupp",
  "tab-spelare",
] as const;

/**
 * One real-touch driver bound to a page.
 *
 * A single CDP session is created lazily and reused: creating one per gesture
 * was measurably slower and, on a memory-starved machine, contributed to
 * timeouts that had nothing to do with the code under test.
 *
 * WEBKIT HAS NO CDP. `newCDPSession` throws "CDP session is only available in
 * Chromium" there, which is why this helper now detects the engine and falls
 * back to synthetic PointerEvents with pointerType "touch". Before this, every
 * touch test that used `touchDriver` failed in webkit with a launcher error —
 * the assertions never ran. `fabnav-swipe.spec.ts` already had such a fallback;
 * this puts the same behaviour in the shared helper so no caller can forget it.
 *
 * WHAT THE FALLBACK IS NOT: native gesture verification. Synthetic events
 * exercise our own logic and WebKit's CSS/event handling, but they bypass
 * WebKit's NATIVE gesture recognition — the layer that arbitrates
 * scroll-versus-drag and raises the link callout on a real iPhone. A green
 * webkit run is evidence about OUR LOGIC, not about iOS. See
 * docs/ENHANCEMENTS.md.
 */
export function touchDriver(page: Page) {
  let session: Promise<Cdp> | null = null;

  return async (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) => {
    // Engine detection is by capability, not by name: asking the browser
    // avoids a hardcoded list that drifts when a project is added.
    const isChromium = page.context().browser()?.browserType().name() === "chromium";
    if (!isChromium) {
      await dispatchSyntheticTouch(page, type, x, y);
      return;
    }
    if (!session) session = page.context().newCDPSession(page);
    const cdp = (await session) as Cdp;
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1 }],
    });
  };
}

/**
 * Dispatch a touch as PointerEvents, for engines without CDP (WebKit).
 *
 * The element under the finger is resolved with `document.elementFromPoint`, so
 * the gesture lands on whatever the user would actually touch. `touchEnd` is
 * dispatched with an empty point list and a zero coordinate, matching the CDP
 * shape the app's handlers already expect.
 */
async function dispatchSyntheticTouch(
  page: Page,
  type: "touchStart" | "touchMove" | "touchEnd",
  x: number,
  y: number,
): Promise<void> {
  await page.evaluate(
    ({ t, px, py }: { t: string; px: number; py: number }) => {
      const target = document.elementFromPoint(px, py) as HTMLElement | null;
      if (!target) return;
      const base = {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
        clientX: px,
        clientY: py,
      };
      if (t === "touchEnd") {
        target.dispatchEvent(new PointerEvent("pointerup", { ...base, clientX: 0, clientY: 0 }));
        return;
      }
      const name = t === "touchStart" ? "pointerdown" : "pointermove";
      target.dispatchEvent(new PointerEvent(name, base));
    },
    { t: type, px: Math.round(x), py: Math.round(y) },
  );
}

/** The pill's rendered left edge, from its inline transform. */
export const renderedPillX = (page: Page) =>
  page.getByTestId("fabnav-pill").evaluate((el) => {
    const m = /translate3d\((-?[\d.]+)px/.exec(el.style.transform);
    return m ? Math.round(parseFloat(m[1]) * 100) / 100 : NaN;
  });

/**
 * The authoritative stop for each tab, read from the running app.
 *
 * Navigating to each tab and reading where the pill rests measures the real
 * thing. One page load per tab, which on a loaded machine made tests time out
 * in setup for reasons unrelated to behaviour — so the caller passes the tabs
 * it actually needs.
 */
export async function renderedStops(page: Page, ids: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of ids) {
    await page.goto(`/${ROUTE_FOR[id]}`);
    await expect(page.getByTestId("tabbar")).toBeVisible();
    // The pill is parked by an effect after the route renders; wait for the
    // value to settle rather than sleeping a guessed interval.
    await expect
      .poll(() => renderedPillX(page), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(0);
    out[id] = await renderedPillX(page);
  }
  return out;
}

/**
 * The measured spacing between adjacent stops.
 *
 * Derived from the app's own rendered stops, never from a hardcoded 51.5. The
 * bar has a CSS max-width, so its geometry is identical at every viewport and a
 * literal copied from one measurement would be an assumption wearing a number's
 * clothes. Two stops 51.5px apart on a 390px screen says nothing about a
 * resized window.
 */
export function tabSpacing(stops: Record<string, number>, ids: readonly string[]): number {
  for (let i = 1; i < ids.length; i++) {
    const a = stops[ids[i - 1]];
    const b = stops[ids[i]];
    if (a !== undefined && b !== undefined) return b - a;
  }
  throw new Error("cannot derive tab spacing: fewer than two stops were measured");
}

type DragOpts = {
  /** Extra travel past the target stop, in px. 20 clears the dead zone. */
  overshoot?: number;
  /** Record the pill's position after each move. */
  sample?: boolean;
};

/**
 * Drag the indicator from its current stop toward a neighbour.
 *
 * `direction` is PHYSICAL and matches the contract: "right" means the finger
 * moves toward increasing viewport X, which moves the pill toward the tabs
 * visually to the right.
 *
 * The finger starts ON the pill, which is the case where a jump on touch-down
 * would be most visible — so every caller gets that check for free.
 */
export async function dragIndicatorToAdjacentTab(
  page: Page,
  touch: ReturnType<typeof touchDriver>,
  direction: Direction,
  /** Spacing between two adjacent stops, in px, measured by `tabSpacing`. */
  spacing: number,
  opts: DragOpts = {},
) {
  const overshoot = opts.overshoot ?? 20;
  const bar = (await page.getByTestId("tabbar").boundingBox())!;
  const y = Math.round(bar.y + bar.height / 2);
  const before = await renderedPillX(page);

  // Start on the pill's own left edge: a thumb lands on the glass.
  const startX = Math.round(bar.x + before);
  await touch("touchStart", startX, y);

  // The pill must not move on touch-down.
  expect(Math.abs((await renderedPillX(page)) - before), "the pill jumped on touch-down").toBeLessThanOrEqual(1);

  // One tab of travel, in the requested physical direction, plus overshoot so
  // the release lands clear of the dead zone around the midpoint.
  const sign = direction === "right" ? 1 : -1;
  const travel = sign * (spacing + overshoot);
  const samples: number[] = [];
  for (let i = 1; i <= 10; i++) {
    await touch("touchMove", startX + Math.round((travel * i) / 10), y);
    if (opts.sample) samples.push(await renderedPillX(page));
  }
  return { before, samples, y, startX, travel };
}

/** Push the indicator against the FIRST tab's clamp. */
export async function dragIndicatorBeyondFirstStop(
  page: Page,
  touch: ReturnType<typeof touchDriver>,
) {
  const bar = (await page.getByTestId("tabbar").boundingBox())!;
  const y = Math.round(bar.y + bar.height / 2);
  const before = await renderedPillX(page);
  const startX = Math.round(bar.x + before);
  await touch("touchStart", startX, y);
  // A large leftward travel: well past the clamp.
  for (let i = 1; i <= 10; i++) await touch("touchMove", startX - i * 30, y);
  return { before, atRelease: await renderedPillX(page), y, startX };
}

/**
 * The furthest RIGHT the pill may legitimately sit, in track-local px.
 *
 * Read from the rendered bar rather than hardcoded. These assertions used to
 * carry a literal `206`, which was only correct for the previous 260px bar
 * with no inset — widening the bar or insetting the pill silently turned a
 * real clamp check into a false failure (or worse, a false pass).
 *
 * The bound is derived from what the pill is actually allowed to occupy: the
 * bar's content box, inset by the same amount the stops use.
 */
export async function maxPillX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const nav = document.querySelector(".fabnav") as HTMLElement;
    const pill = document.querySelector('[data-testid="fabnav-pill"]') as HTMLElement;
    const cs = getComputedStyle(nav);
    const border = parseFloat(cs.borderLeftWidth) || 0;
    const inset = parseFloat(getComputedStyle(pill).top) || 0;
    const track = nav.clientWidth - border;
    const pillW = pill.offsetWidth;
    return inset + Math.max(0, track - pillW - inset * 2);
  });
}

/** Push the indicator against the LAST tab's clamp. */
export async function dragIndicatorBeyondLastStop(
  page: Page,
  touch: ReturnType<typeof touchDriver>,
) {
  const bar = (await page.getByTestId("tabbar").boundingBox())!;
  const y = Math.round(bar.y + bar.height / 2);
  const before = await renderedPillX(page);
  const startX = Math.round(bar.x + before);
  await touch("touchStart", startX, y);
  for (let i = 1; i <= 10; i++) await touch("touchMove", startX + i * 30, y);
  return { before, atRelease: await renderedPillX(page), y, startX };
}
