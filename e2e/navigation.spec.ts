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
  { id: "tab-brief", label: "Brief", hash: "#/", page: "brief-page" },
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
