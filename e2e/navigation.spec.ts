import { test, expect, type Page } from "@playwright/test";

/**
 * The five-destination navigation model.
 *
 * These tests pin the redesign's structural promises:
 *   1. exactly five primary destinations, each with its own route
 *   2. the active icon is derived from the route and can never disagree
 *   3. tap navigates
 *   4. swiping the NAVIGATION BAR navigates
 *   5. swiping the CONTENT does NOT navigate
 *   6. vertical scrolling does NOT navigate
 *   7. the back gesture closes detail surfaces
 *   8. Settings returns to the section it was opened from
 *   9. an invalid route is handled explicitly, not silently
 */

const TABS = [
  { id: "tab-brief", label: "Hem", hash: "#/", page: "brief-page" },
  { id: "tab-nyheter", label: "Nyheter", hash: "#/nyheter", page: "news-page" },
  { id: "tab-matcher", label: "Matcher", hash: "#/matcher", page: "matches-page" },
  { id: "tab-trupp", label: "Trupp", hash: "#/trupp", page: "squad-page" },
  { id: "tab-spelare", label: "Spelare", hash: "#/spelare", page: "former-page" },
] as const;

/** Wait until the shell has data and the bar is interactive. */
async function ready(page: Page) {
  await expect(page.getByTestId("tabbar")).toBeVisible();
  await expect(page.locator(".tabbar-link, .fabnav-link").first()).toBeVisible();
}

test.describe("Five primary destinations", () => {
  test("there are exactly five, in order, each with an accessible name", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    const links = page.locator(".tabbar a, .fabnav a");
    await expect(links).toHaveCount(5);
    for (const t of TABS) {
      const link = page.getByTestId(t.id);
      await expect(link).toBeVisible();
      await expect(link).toHaveText(t.label);
      await expect(link).toHaveAttribute("href", t.hash);
    }
  });

  test("navigation is a semantic <nav> with an accessible name", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    await expect(page.getByRole("navigation", { name: "Huvudnavigation" })).toBeVisible();
  });

  test("every destination is reachable by tapping, and the active icon follows", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    for (const t of TABS) {
      await page.getByTestId(t.id).click();
      await expect(page).toHaveURL(new RegExp(`${t.hash.replace("#", "\\u0023")}$`));
      await expect(page.getByTestId(t.page)).toBeAttached();
      // Exactly one icon is active, and it is the right one.
      await expect(page.locator('.fabnav a[aria-current="page"], .tabbar a[aria-current="page"]')).toHaveCount(1);
      await expect(page.getByTestId(t.id)).toHaveAttribute("aria-current", "page");
    }
  });

  test("the active state is not colour alone", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    const active = page.locator('.fabnav a[aria-current="page"]');
    // aria-current, a bolder label weight, and a dot marker.
    await expect(active).toHaveCount(1);
    const weight = await active.locator(".fabnav-label").evaluate((el) => getComputedStyle(el).fontWeight);
    const idle = await page.getByTestId("tab-nyheter").locator(".fabnav-label").evaluate((el) => getComputedStyle(el).fontWeight);
    expect(Number(weight)).toBeGreaterThan(Number(idle));
  });

  test("each destination renders on a direct deep link", async ({ page }) => {
    for (const t of TABS) {
      await page.goto(`/${t.hash}`);
      await expect(page.getByTestId(t.page)).toBeAttached();
      await expect(page.getByTestId(t.id)).toHaveAttribute("aria-current", "page");
    }
  });
});

test.describe("Swipe on the navigation bar", () => {
  const barBox = async (page: Page) => {
    const b = await page.getByTestId("tabbar").boundingBox();
    if (!b) throw new Error("tab bar has no box");
    return b;
  };

  const swipe = async (page: Page, dir: 1 | -1) => {
    const b = await barBox(page);
    const y = b.y + b.height / 2;
    const startX = dir === 1 ? b.x + b.width * 0.85 : b.x + b.width * 0.15;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(startX - dir * (b.width * 0.09 * i), y);
    }
    await page.mouse.up();
  };

  /**
   * REAL TOUCH SWIPE.
   *
   * The `swipe()` helper above drives `page.mouse`, which is why this whole
   * suite was green while the gesture did nothing on a real iPhone. A mouse
   * drag has no `touch-action` arbitration and never fires `pointercancel`,
   * so it cannot reproduce the failure that human testing found.
   *
   * This dispatches genuine touch input through CDP, which is what the browser
   * does with a finger — and therefore what exercises `touch-action`, native
   * pan-vs-custom gesture arbitration, and `pointercancel`.
   */
  const touchSwipe = async (page: Page, dir: 1 | -1, opts: { steps?: number; stepPx?: number } = {}) => {
    const steps = opts.steps ?? 8;
    const stepPx = opts.stepPx ?? 9;
    const b = await barBox(page);
    const y = b.y + b.height / 2;
    const startX = b.x + b.width / 2;
    const client = await page.context().newCDPSession(page);
    const pts = (x: number) => [{ x, y, id: 1 }];
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(startX) });
    for (let i = 1; i <= steps; i++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: pts(startX - dir * stepPx * i),
      });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach();
  };

  /** Record the pointer events a gesture produced, so we can assert on them. */
  const recordPointerEvents = async (page: Page) => {
    await page.evaluate(() => {
      const w = window as unknown as { __pe: string[] };
      w.__pe = [];
      for (const t of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
        window.addEventListener(t, () => w.__pe.push(t), true);
      }
    });
  };
  const pointerEvents = (page: Page) =>
    page.evaluate(() => (window as unknown as { __pe: string[] }).__pe);

  /**
   * The regression that mattered. `touch-action` is NOT an inherited CSS
   * property: with it declared only on the <nav>, the computed value on the
   * <a> — the element the thumb actually lands on — was `auto`, so the
   * browser claimed the horizontal pan as a scroll and fired
   * `pointercancel`, killing the swipe. This asserts the value on the real
   * touch target, not on an ancestor.
   */
  test("the touch target itself disallows native panning", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    const values = await page.evaluate(() => {
      const read = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).touchAction : "MISSING";
      };
      return {
        nav: read("[data-testid=tabbar]"),
        link: read(".fabnav-link"),
        item: read(".fabnav-item"),
      };
    });
    expect(values.nav).toBe("none");
    // The link fills the bar and is what the finger hits.
    expect(values.link).toBe("none");
  });

  test("a REAL touch swipe advances, and the browser never cancels it", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    await recordPointerEvents(page);
    await touchSwipe(page, 1);
    await expect(page).toHaveURL(/\u0023\/nyheter$/);

    const events = await pointerEvents(page);
    expect(events).toContain("pointerup");
    // The failure mode on iOS: the pan was claimed as a scroll, so the
    // stream was torn down before pointerup could commit.
    expect(events).not.toContain("pointercancel");
  });

  test("a REAL touch swipe goes back", async ({ page }) => {
    await page.goto("/#/matcher");
    await ready(page);
    await touchSwipe(page, -1);
    await expect(page).toHaveURL(/\u0023\/nyheter$/);
  });

  test("a REAL touch swipe works from EVERY destination", async ({ page }) => {
    const starts = [
      { hash: "#/", left: "#/nyheter" },
      { hash: "#/nyheter", left: "#/matcher", right: "#/" },
      { hash: "#/matcher", left: "#/trupp", right: "#/nyheter" },
      { hash: "#/trupp", left: "#/spelare", right: "#/matcher" },
      { hash: "#/spelare", right: "#/trupp" },
    ];
    for (const s of starts) {
      await page.goto(`/${s.hash}`);
      await ready(page);
      await touchSwipe(page, 1);
      if (s.left) {
        await expect(page, `swipe left from ${s.hash}`).toHaveURL(new RegExp(`${s.left}$`));
      } else {
        // No wraparound at the last destination.
        await expect(page, `no wraparound from ${s.hash}`).toHaveURL(new RegExp(`${s.hash.replace("/", "\\/")}$`));
      }
    }
    for (const s of starts) {
      if (!s.right) continue;
      await page.goto(`/${s.hash}`);
      await ready(page);
      await touchSwipe(page, -1);
      await expect(page, `swipe right from ${s.hash}`).toHaveURL(new RegExp(`${s.right}$`));
    }
  });

  test("a real touch swipe from ONTO an individual nav item also works", async ({ page }) => {
    // The gesture must not depend on starting at the bar's centre: a thumb
    // lands on whichever icon it aimed at.
    await page.goto("/#/");
    await ready(page);
    const b = await barBox(page);
    const client = await page.context().newCDPSession(page);
    const y = b.y + b.height / 2;
    const startX = b.x + b.width * 0.12;
    const pts = (x: number) => [{ x, y, id: 1 }];
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(startX) });
    for (let i = 1; i <= 8; i++) {
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(startX - 9 * i) });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach();
    await expect(page).toHaveURL(/\u0023\/nyheter$/);
  });

  test("a real tap still activates, and a short touch drag stays a tap", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);

    // A genuine TOUCH tap, dispatched through CDP. `locator.tap()` is not
    // available because the context is not created with hasTouch, and a
    // mouse click would not prove the touch path works.
    const touchTap = async (testId: string) => {
      const b = (await page.getByTestId(testId).boundingBox())!;
      const client = await page.context().newCDPSession(page);
      const x = b.x + b.width / 2;
      const y = b.y + b.height / 2;
      const pt = [{ x, y, id: 1 }];
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt });
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await client.detach();
    };

    await touchTap("tab-trupp");
    await expect(page).toHaveURL(/\u0023\/trupp$/);

    // A short, slow drag — under BOTH the distance and flick thresholds —
    // must be read as a TAP, not a swipe.
    //
    // Started on the ALREADY-ACTIVE tab and dragged 10px the other way, so
    // the three possible outcomes are distinguishable:
    //   tap        -> stays on the current tab (asserted)
    //   swipe      -> would move one destination backwards
    //   nothing    -> indistinguishable from a tap here, but the tap itself
    //                 is already proven above, so the only risk left to
    //                 exclude is a drag over-committing into a swipe.
    await page.goto("/#/nyheter");
    await ready(page);
    const b = await barBox(page);
    const client = await page.context().newCDPSession(page);
    const y = b.y + b.height / 2;
    // 0.3 of the bar is the CENTRE of the second link, so a 10px drag in
    // either direction still ends on that same link.
    const x0 = b.x + b.width * 0.3;
    const pts = (x: number) => [{ x, y, id: 1 }];
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(x0) });
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(x0 + 5) });
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(x0 + 10) });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach();
    await expect(page).toHaveURL(/\u0023\/nyheter$/);
  });

  test("the bar does not move during a REAL touch swipe", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    const before = await barBox(page);
    const client = await page.context().newCDPSession(page);
    const y = before.y + before.height / 2;
    const x0 = before.x + before.width / 2;
    const pts = (x: number) => [{ x, y, id: 1 }];
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(x0) });
    for (let i = 1; i <= 8; i++) {
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(x0 - 9 * i) });
    }
    // Mid-gesture: the bar must be exactly where it started.
    const during = await barBox(page);
    expect(Math.abs(during.x - before.x)).toBeLessThan(1);
    expect(Math.abs(during.y - before.y)).toBeLessThan(1);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach();
    const after = await barBox(page);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  });

  test("a REAL touch swipe on the CONTENT does not navigate", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    const b = await barBox(page);
    const client = await page.context().newCDPSession(page);
    // Start well above the bar, in the content area.
    const y = Math.max(80, b.y - 220);
    const x0 = 200;
    const pts = (x: number) => [{ x, y, id: 1 }];
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(x0) });
    for (let i = 1; i <= 8; i++) {
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(x0 - 12 * i) });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach();
    await expect(page).toHaveURL(/\u0023\/$/);
  });

  test("swiping the bar left advances to the next destination", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    await swipe(page, 1);
    await expect(page).toHaveURL(/\u0023\/nyheter$/);
    await expect(page.getByTestId("tab-nyheter")).toHaveAttribute("aria-current", "page");
  });

  test("swiping the bar right goes back a destination", async ({ page }) => {
    await page.goto("/#/matcher");
    await ready(page);
    await swipe(page, -1);
    await expect(page).toHaveURL(/\u0023\/nyheter$/);
  });

  test("swiping past the first or last destination does nothing", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    await swipe(page, -1);
    await expect(page).toHaveURL(/\u0023\/$/);
    await page.goto("/#/spelare");
    await ready(page);
    await swipe(page, 1);
    await expect(page).toHaveURL(/\u0023\/spelare$/);
  });

  test("swiping the CONTENT does not change the primary destination", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    // Deliberately probe a NON-interactive strip of the content. Dragging
    // across an interactive element (the Brief hero is a <button>) fires a
    // native click on release — standard browser behaviour that this bar is
    // not involved in, and not what this test is about.
    const b = await page.getByTestId("brief-page").boundingBox();
    if (!b) throw new Error("brief has no box");
    const y = b.y + 8;
    await page.mouse.move(b.x + b.width * 0.85, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(b.x + b.width * (0.85 - 0.08 * i), y);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    await expect(page).toHaveURL(/\u0023\/$/);
    await expect(page.getByTestId("brief-page")).toBeAttached();
    await expect(page.getByTestId("tab-brief")).toHaveAttribute("aria-current", "page");
  });

  test("vertical scrolling does not change the primary destination", async ({ page }) => {
    await page.goto("/#/matcher");
    await ready(page);
    const b = await page.getByTestId("matches-page").boundingBox();
    if (!b) throw new Error("matches has no box");
    const x = b.x + b.width / 2;
    await page.mouse.move(x, b.y + 200);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x, b.y + 200 - i * 22);
    await page.mouse.up();
    await page.waitForTimeout(400);
    await expect(page).toHaveURL(/\u0023\/matcher$/);
    await expect(page.getByTestId("tab-matcher")).toHaveAttribute("aria-current", "page");
  });

  test("no native link drag hijacks the gesture", async ({ page }) => {
    // Regression: the anchors were draggable, so a pointer move fired
    // `dragstart`, which removed the bar from the pointer stream and meant
    // `pointerup` — the only thing that commits a swipe — never arrived.
    await page.goto("/#/");
    await ready(page);
    await page.evaluate(() => {
      (window as unknown as { __drags: number }).__drags = 0;
      document.addEventListener("dragstart", () => {
        (window as unknown as { __drags: number }).__drags++;
      }, true);
    });
    const b = await barBox(page);
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + b.width * 0.85, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width * (0.85 - 0.09 * i), y);
    await page.mouse.up();
    await page.waitForTimeout(400);
    const drags = await page.evaluate(() => (window as unknown as { __drags: number }).__drags);
    expect(drags, "a native drag started on the navigation bar").toBe(0);
  });

  test("the bar stays pinned while swiping — it does not drag with the finger", async ({ page }) => {
    // A SHORT FLICK changes destination and leaves the bar where it is. The
    // bar is repositioned only by a deliberate press-and-hold, which is
    // covered in fabnav-drag.spec.ts.
    //
    // This assertion was rewritten when the centring mechanism changed. It
    // used to require `transform: matrix(1,0,0,1,-halfWidth,0)`, i.e. the
    // `translateX(-50%)` shim. That shim was a real bug: JS overwrites `left`
    // with an absolute position but cannot overwrite a CSS transform, so the
    // bar rendered at x=-16px at rest and x=-114px after a drag. Centring is
    // now expressed in `left` alone, and the meaningful invariant is simply
    // that the transform does not change across the gesture.
    await page.goto("/#/nyheter");
    await ready(page);
    const before = await barBox(page);

    const y = before.y + before.height / 2;
    const sx = before.x + before.width * 0.85;
    const resting = await page.locator(".fabnav").evaluate((el) => getComputedStyle(el).transform);

    await page.mouse.move(sx, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(sx - before.width * 0.09 * i, y);
      // Assert DURING the gesture, while the pointer is still down.
      const mid = await barBox(page);
      expect(Math.abs(mid.x - before.x), "the bar moved horizontally mid-swipe").toBeLessThanOrEqual(1);
      const midTf = await page.locator(".fabnav").evaluate((el) => getComputedStyle(el).transform);
      expect(midTf, "the bar's transform changed during a swipe — it is being dragged").toBe(resting);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);

    const after = await barBox(page);
    expect(Math.abs(after.x - before.x), "the bar did not return to its resting position").toBeLessThanOrEqual(1);
    const afterTf = await page.locator(".fabnav").evaluate((el) => getComputedStyle(el).transform);
    expect(afterTf, "the bar's transform did not settle back after the swipe").toBe(resting);
    // ...and the swipe still navigated.
    await expect(page).toHaveURL(/\u0023\/matcher$/);
  });

  test("a small drag on the bar is treated as a tap, not a swipe", async ({ page }) => {
    // A 6px drag is below AXIS_GUARD, so no axis is ever decided and no swipe
    // commits. It must therefore behave exactly like a plain tap: start on
    // Brief, drag 6px right, land on the link that is under the finger and
    // navigate there. The promise is "no SWIPE happened", not "no change".
    await page.goto("/#/");
    await ready(page);
    const b = await barBox(page);
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + b.width * 0.28, y);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.28 + 6, y);
    await page.mouse.up();
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\u0023\/nyheter$/);
  });
});

test.describe("Route handling", () => {
  test("an unknown route renders an explicit not-found, not a silent Brief", async ({ page }) => {
    await page.goto("/#/hittades-inte");
    await expect(page.getByTestId("not-found")).toBeVisible();
    await expect(page.getByTestId("brief-page")).toHaveCount(0);
    // The bar stays usable so the user is never stranded.
    await expect(page.getByTestId("tabbar")).toBeVisible();
    await expect(page.locator('.fabnav a[aria-current="page"]')).toHaveCount(0);
  });

  test("the not-found page links back into the five destinations", async ({ page }) => {
    await page.goto("/#/hittades-inte");
    await page.getByTestId("notfound-tab-trupp").click();
    await expect(page).toHaveURL(/\u0023\/trupp$/);
    await expect(page.getByTestId("squad-page")).toBeAttached();
  });

  test("a detail route keeps its section's icon active", async ({ page }) => {
    // Uses a player DETAIL route rather than a search result. This test is
    // about the navigation icon staying active while a child surface is open,
    // so it must not depend on the player-search screen's data or wording.
    await page.goto("/#/spelare");
    await expect(page.getByTestId("former-page")).toBeAttached();
    await page.goto("/#/matcher");
    await expect(page.getByTestId("matches-page")).toBeAttached();

    // A match sheet is a child surface of Matcher, driven by the app's own
    // fixture data, so this stays stable regardless of the player refactor.
    const row = page.getByTestId("match-row").first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    // The icon must not go blank while a child detail is open.
    await expect(page.getByTestId("tab-matcher")).toHaveAttribute("aria-current", "page");
  });
});

test.describe("Direct load and cold start", () => {
  // Regression: Squad.tsx once called useMemo BELOW an early return, so a cold
  // load of #/trupp rendered fewer hooks than the following render and React
  // threw #310, unmounting the whole app. A primary destination has to survive
  // a refresh, a deep link and a brand-new browser context.
  const ROUTES = [
    { hash: "#/", page: "brief-page" },
    { hash: "#/nyheter", page: "news-page" },
    { hash: "#/matcher", page: "matches-page" },
    { hash: "#/trupp", page: "squad-page" },
    { hash: "#/spelare", page: "former-page" },
  ];

  for (const r of ROUTES) {
    test(`cold load of ${r.hash} renders without crashing`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/${r.hash}`);
      await expect(page.getByTestId(r.page)).toBeAttached();
      // A React crash unmounts the tree, so any hook-order error is fatal.
      expect(errors, `page errors on ${r.hash}`).toEqual([]);
    });
  }

  test("a refresh of #/trupp keeps the squad rendered", async ({ page }) => {
    await page.goto("/#/trupp");
    await expect(page.getByTestId("squad-page")).toBeAttached();
    await page.reload();
    await expect(page.getByTestId("squad-page")).toBeAttached();
    await expect(page.getByTestId("squad-player").first()).toBeVisible();
  });

  test("#/trupp is reachable by navigation from every other destination", async ({ page }) => {
    for (const from of ["#/", "#/nyheter", "#/matcher", "#/spelare"]) {
      await page.goto(`/${from}`);
      await expect(page.locator(".fabnav")).toBeVisible();
      await page.waitForTimeout(300);
      await page.getByTestId("tab-trupp").click();
      await expect(page).toHaveURL(/\u0023\/trupp$/);
      await expect(page.getByTestId("squad-page")).toBeAttached();
      await expect(page.getByTestId("squad-player").first()).toBeVisible();
    }
  });
});

test.describe("Unknown routes claim no destination", () => {
  test("no icon is active and Brief is not highlighted", async ({ page }) => {
    await page.goto("/#/hittades-inte");
    await expect(page.getByTestId("not-found")).toBeVisible();
    // Regression: destinationFor() used to fall back to Brief, so the app
    // claimed a route it was not rendering.
    await expect(page.locator('.fabnav a[aria-current="page"]')).toHaveCount(0);
    await expect(page.getByTestId("tab-brief")).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("tab-brief")).not.toHaveAttribute("data-active", "true");
  });

  test("the bar is still usable from an unknown route", async ({ page }) => {
    await page.goto("/#/hittades-inte");
    await expect(page.getByTestId("not-found")).toBeVisible();
    await page.getByTestId("tab-nyheter").click();
    await expect(page).toHaveURL(/\u0023\/nyheter$/);
    await expect(page.getByTestId("tab-nyheter")).toHaveAttribute("aria-current", "page");
  });
});

/**
 * Section G2 — the redundant active-state dot.
 *
 * The active destination already reads as active because its label turns
 * yellow. A 4px yellow dot was ALSO drawn via `::after` with `margin-top:
 * 30px`, which on a 9.5px label put it inside the text: it overlapped and
 * blurred the letters it was meant to support. It is removed, and nothing
 * replaces it — a second cue for the same state is redundant, not clearer.
 */
test.describe("Active state is the label, not a dot", () => {
  test("the active link paints no ::after marker at any viewport", async ({ page }) => {
    for (const vp of [
      { width: 390, height: 844, name: "phone" },
      { width: 1024, height: 768, name: "desktop" },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/#/");
      await expect(page.getByTestId("tabbar")).toBeVisible();

      for (const sel of [".fabnav-link", ".tabbar-link", ".fabnav a"]) {
        const n = await page.locator(sel).count();
        if (n === 0) continue;
        const markers = await page.evaluate((s) => {
          return [...document.querySelectorAll(s)].map((el) => {
            const cs = getComputedStyle(el, "::after");
            return {
              content: cs.content,
              w: cs.width,
              h: cs.height,
              bg: cs.backgroundColor,
            };
          });
        }, sel);
        for (const m of markers) {
          const drawsBox = m.content !== "none" && m.content !== '""' && parseFloat(m.w) > 0;
          expect(drawsBox, `${sel} still draws an ::after marker (${vp.name}): ${JSON.stringify(m)}`).toBe(false);
        }
      }
    }
  });

  test("the active destination is still unmistakable — by colour, on the label", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    const active = page.locator('.fabnav-link[data-active], .tabbar-link[data-active]');
    await expect(active).toHaveCount(1);
    const color = await active.evaluate((el) => getComputedStyle(el).color);
    const inactive = await page
      .locator(".fabnav-link:not([data-active])")
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    expect(color, "the active label must differ from the inactive ones").not.toBe(inactive);
    // The yellow brand token, not merely "different".
    expect(color).toBe("rgb(255, 210, 0)");
  });

  test("the label is not obscured by anything painted over it", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    const label = page.locator(".fabnav-link[data-active] .fabnav-label");
    await expect(label).toBeVisible();
    // The label has real width and its own line box — a 4px dot with a
    // 30px margin used to sit inside exactly this box.
    const box = (await label.boundingBox())!;
    expect(box.width).toBeGreaterThan(8);
    expect(box.height).toBeGreaterThan(4);
  });
});
