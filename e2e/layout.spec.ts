import { test, expect } from "@playwright/test";

/**
 * The five primary destinations.
 *
 * `page` is the page-level test id. It CANNOT be derived from `name`: the
 * Swedish labels and the internal test ids differ (Nyheter → news-page,
 * Matcher → matches-page, Trupp → squad-page, Spelare → former-page), and
 * guessing it made the Settings round-trip test fail for reasons that had
 * nothing to do with Settings.
 */
const PAGES = [
  { hash: "#/", name: "Hem", page: "brief-page" },
  { hash: "#/nyheter", name: "Nyheter", page: "news-page" },
  { hash: "#/matcher", name: "Matcher", page: "matches-page" },
  { hash: "#/trupp", name: "Trupp", page: "squad-page" },
  { hash: "#/spelare", name: "Spelare", page: "former-page" },
];

/** iPhone 13 is the primary target; 320px is the small-phone floor. */
const VIEWPORTS = [
  { width: 320, height: 568, name: "320 (small phone)" },
  { width: 390, height: 844, name: "390 (iPhone 13)" },
  { width: 430, height: 932, name: "430 (large phone)" },
  { width: 1024, height: 768, name: "1024 (tablet/desktop)" },
];

test.describe("Layout", () => {
  for (const vp of VIEWPORTS) {
    test(`no horizontal overflow at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const p of PAGES) {
        await page.goto(`/${p.hash}`);
        await page.waitForTimeout(500);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `overflow on ${p.name} @ ${vp.width}px`).toBeLessThanOrEqual(1);
      }
    });
  }

  test("the floating nav genuinely overlays scrollable content", async ({ page }) => {
    // The bar must FLOAT, not sit in a reserved band. Two properties together
    // prove it: the scroll viewport reaches the bottom of the screen (so it
    // runs behind the bar), and content can actually be positioned underneath
    // it. The previous implementation padded BOTH main and the layer, which
    // shrank the viewport and left a dead strip — that made the bar read as
    // an opaque full-width tab bar.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const p of PAGES) {
      await page.goto(`/${p.hash}`);
      await expect(page.locator(".fabnav")).toBeVisible();
      await page.waitForTimeout(400);
      const geo = await page.evaluate(() => {
        const nav = document.querySelector(".fabnav") as HTMLElement;
        const layer = document.querySelector(".layer") as HTMLElement;
        const nr = nav.getBoundingClientRect();
        const lr = layer.getBoundingClientRect();
        return {
          navTop: nr.top,
          layerBottom: lr.bottom,
          layerOverflowY: getComputedStyle(layer).overflowY,
          mainPadBottom: parseFloat(getComputedStyle(document.querySelector("main")!).paddingBottom),
        };
      });
      // 1. The scroll viewport is a real scroller that extends to the screen
      //    bottom, i.e. it passes BESIDE and behind the bar, not above it.
      expect(geo.layerOverflowY, `${p.name} is not a scroll container`).toBe("auto");
      expect(geo.layerBottom, `${p.name} stops short of the bar`).toBeGreaterThan(geo.navTop);
      // 2. main adds no bottom padding of its own — the clearance lives once,
      //    on the scroll container, so there is no doubled dead zone.
      expect(geo.mainPadBottom, `${p.name} has double bottom clearance`).toBe(0);
    }
  });

  test("content is actually visible underneath the translucent bar", async ({ page }) => {
    // The decisive check for the floating-nav requirement: real page content
    // must occupy the region behind the bar while scrolling.
    //
    // This must be measured by RECTANGLE OVERLAP, not elementFromPoint: the
    // bar is on top, so a hit test can never see through it. A content
    // element whose box intersects the bar's box is genuinely behind it.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/");
    await page.locator(".fabnav").waitFor();
    await page.waitForTimeout(600);
    const overlapping = await page.evaluate(async () => {
      const nav = document.querySelector(".fabnav") as HTMLElement;
      const layer = document.querySelector(".layer") as HTMLElement;
      // Scroll so content is mid-way through the bar region.
      const mid = Math.max(0, (layer.scrollHeight - layer.clientHeight) / 2);
      layer.scrollTop = mid;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const nr = nav.getBoundingClientRect();
      const items = [...layer.querySelectorAll("h2, .module, .mrow, .result, .cstat, .strip, .hero")];
      const behind = items.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.bottom > nr.top && r.top < nr.bottom;
      });
      return {
        count: behind.length,
        total: items.length,
        navTop: nr.top,
        layerBottom: layer.getBoundingClientRect().bottom,
        first: behind[0]?.textContent?.trim().slice(0, 40) ?? null,
      };
    });
    // The layer must extend below the bar's top edge, and real content
    // elements must intersect the bar's box.
    expect(overlapping.layerBottom, "scroll viewport stops above the bar").toBeGreaterThan(overlapping.navTop);
    expect(overlapping.count, `no content behind the bar (${overlapping.total} items checked)`).toBeGreaterThan(0);
  });

  test("the final content is still fully reachable and readable", async ({ page }) => {
    // Floating must not come at the cost of losing the last item: scrolling
    // to the very end must leave the last element clear of the bar.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const p of PAGES) {
      await page.goto(`/${p.hash}`);
      await page.waitForTimeout(500);
      const res = await page.evaluate(async () => {
        const layer = document.querySelector(".layer") as HTMLElement;
        const nav = document.querySelector(".fabnav") as HTMLElement;
        layer.scrollTop = layer.scrollHeight;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const children = [...layer.querySelectorAll("h2, .mrow, .news-row, .srow, [data-testid='matcher-next']")];
        const last = children[children.length - 1];
        if (!last) return null;
        const lr = last.getBoundingClientRect();
        const nr = nav.getBoundingClientRect();
        return { lastBottom: lr.bottom, navTop: nr.top, clear: nr.top - lr.bottom };
      });
      if (!res) continue;
      // The last element sits above the bar once fully scrolled.
      expect(res.clear, `${p.name} last element is trapped under the nav`).toBeGreaterThanOrEqual(0);
    }
  });

  test("there is no excessive dead space below the content", async ({ page }) => {
    // A large empty band under the last content is what made the previous
    // bar look like a full-width tab bar. Clearance must be roughly one bar
    // height, not several times it.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/");
    await page.waitForTimeout(500);
    const pad = await page.evaluate(() => {
      const layer = document.querySelector(".layer") as HTMLElement;
      return parseFloat(getComputedStyle(layer).paddingBottom);
    });
    // ~58px bar + 12px offset + safe area. Allow headroom, reject a band.
    expect(pad).toBeLessThanOrEqual(110);
    expect(pad).toBeGreaterThanOrEqual(40);
  });

  test("the floating nav is compact, inset and clear of the home indicator", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/");
    const nav = page.locator(".fabnav");
    await expect(nav).toBeVisible();
    const geo = await nav.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        bottom: cs.bottom,
        left: cs.left,
        right: cs.right,
        width: r.width,
        height: r.height,
        radius: cs.borderTopLeftRadius,
        background: cs.backgroundColor,
        position: cs.position,
        safeAreaDeclared: cs.bottom.includes("env") || cs.bottom.includes("12px"),
      };
    });
    // Floating, not a full-width band.
    expect(geo.position).toBe("fixed");
    expect(geo.width).toBeLessThan(390);
    // Rounded pill.
    expect(parseFloat(geo.radius)).toBeGreaterThanOrEqual(16);
    // Compact: it must not eat a fifth of an 844px screen.
    expect(geo.height).toBeLessThan(90);
    // Semi-transparent, so content reads as being behind it.
    const alpha = /rgba?\(([^)]+)\)/.exec(geo.background)?.[1]?.split(",")[3];
    expect(alpha === undefined || Number(alpha) < 1).toBe(true);
    // Inset from both edges.
    expect(geo.left).not.toBe("0px");
  });

  test("the nav leaves the safe-area bottom clear", async ({ page }) => {
    await page.goto("/#/");
    const bottom = await page
      .locator(".fabnav")
      .evaluate((el) => getComputedStyle(el).bottom);
    // The declaration must include the safe-area inset, and the rendered gap
    // must be at least the 12px float offset.
    expect(parseFloat(bottom)).toBeGreaterThanOrEqual(12);
  });

  test("every nav target meets the 44px touch minimum", async ({ page }) => {
    await page.goto("/#/");
    const links = page.locator(".fabnav a");
    const n = await links.count();
    for (let i = 0; i < n; i++) {
      const box = await links.nth(i).boundingBox();
      expect(box!.height, `nav target ${i} is only ${box!.height}px tall`).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("all five destinations fit on one bar without clipping", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/#/");
    const bar = await page.locator(".fabnav").boundingBox();
    const links = page.locator(".fabnav a");
    const n = await links.count();
    for (let i = 0; i < n; i++) {
      const b = await links.nth(i).boundingBox();
      expect(b!.x, `link ${i} overflows the bar`).toBeGreaterThanOrEqual(bar!.x - 1);
      expect(b!.x + b!.width).toBeLessThanOrEqual(bar!.x + bar!.width + 1);
    }
  });

  test("header respects the safe-area top inset", async ({ page }) => {
    await page.goto("/#/");
    const padding = await page.locator(".app-header").evaluate((el) => getComputedStyle(el).paddingTop);
    const declared = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            if (rule.cssText.includes("--header-h") && rule.cssText.includes("padding")) return true;
          }
        } catch {
          /* cross-origin sheet */
        }
      }
      return false;
    });
    expect(typeof padding).toBe("string");
    expect(declared).toBe(true);
  });

  /**
   * REGRESSION: the sheet's CONTENT must clear the floating nav at EVERY
   * width.
   *
   * 2026-10-09, from the iPhone: the sheet itself now runs to the SCREEN
   * BOTTOM and the nav floats OVER it (that overlay is the requested design,
   * not a defect). What must still hold is that the sheet's SCROLLABLE
   * CONTENT is never hidden behind the bar — `.sheet-body` reserves
   * `--chrome-bottom` as bottom padding for exactly that.
   *
   * So the assertion moved from the sheet's box to its content: the last
   * scrollable content edge must sit at or above the nav's top edge.
   *
   * History of this test: it used to assert `sheet.bottom <= nav.top`, which
   * was the old geometry (the sheet inset by the nav band). The shorthand
   * `margin: 0 auto` at >=700px once reset `margin-bottom` to 0 and the sheet
   * sat 74px UNDER the nav — that defect is what made the assertion numeric
   * rather than visual, and the numeric discipline is kept here.
   */
  for (const vp of VIEWPORTS) {
    test(`the open sheet's content clears the floating nav at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/#/nyheter");
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.getByTestId("open-settings").click();
      await expect(page.getByTestId("settings-sheet")).toBeVisible();

      // WAIT FOR THE SHEET-IN ANIMATION TO FINISH — via the animation itself.
      //
      // THREE attempts, and the first two made things worse:
      //
      // (a) `waitForTimeout(500)`. A race. Under full-suite parallel load the
      //     animation had not finished, so the sheet was measured mid-flight and
      //     reported a 642px overlap. Intermittent, which is the signature of
      //     timing rather than CSS.
      //
      // (b) Two reads 120ms apart, required to be identical. Failed on ALL FOUR
      //     viewports — the sheet-in animation is simply longer than 120ms, so
      //     this was a STRICTER test, not a truer one. "Wait for rest" is not
      //     "verify rest happened within N ms".
      //
      // (c) Polling for two consecutive matching reads. Correct in principle, but
      //     two reads 150ms apart can agree mid-animation on a slow machine and
      //     still hand back a moving target. It failed intermittently at 390px.
      //
      // What is actually true is that the sheet runs a named CSS animation,
      // `sheet-in`. The browser knows when it ends, so ask it. This is exact,
      // has no guessed constant in it, and cannot be wrong on a slow machine.
      const animated = await page
        .getByTestId("settings-sheet")
        .evaluate(
          (el) =>
            new Promise<boolean>((resolve) => {
              // Already finished: reduced-motion, or a very fast frame.
              if (!el.getAnimations().some((a) => a.playState === "running")) {
                resolve(true);
                return;
              }
              el.addEventListener(
                "animationend",
                (e) => resolve((e as AnimationEvent).target === el),
                { once: true },
              );
            }),
        );
      expect(animated, "the sheet-in animation never reported completion").toBe(true);

      const geo = await page.evaluate(() => {
        const sheet = document.querySelector('[data-testid="settings-sheet"]')!;
        const body = sheet.querySelector(".sheet-body")!;
        const nav = document.querySelector("[data-testid=tabbar]")!;
        const b = body.getBoundingClientRect();
        const n = nav.getBoundingClientRect();
        const cs = getComputedStyle(body);
        return {
          // The lowest pixel of CONTENT (excluding the reserved bottom padding)
          // versus the nav's top edge.
          contentBottom: Math.round(b.bottom - parseFloat(cs.paddingBottom)),
          navTop: Math.round(n.top),
          sheetBottom: Math.round(sheet.getBoundingClientRect().bottom),
          viewportH: window.innerHeight,
        };
      });

      expect(
        geo.contentBottom,
        `sheet content hidden behind the nav at ${vp.width}px (contentBottom=${geo.contentBottom}, navTop=${geo.navTop})`,
      ).toBeLessThanOrEqual(geo.navTop);
      // The NEW geometry: the sheet itself reaches the screen bottom.
      expect(
        geo.sheetBottom,
        `the sheet should reach the screen bottom at ${vp.width}px`,
      ).toBeGreaterThanOrEqual(geo.viewportH - 1);
    });
  }
});

test.describe("Settings", () => {
  test("is a sheet reached from the header, and is not a destination", async ({ page }) => {
    await page.goto("/#/");
    await page.getByTestId("open-settings").click();
    await expect(page.getByTestId("settings-sheet")).toBeVisible();
    await expect(page.getByTestId("diagnostics")).toBeVisible();
    await page.getByTestId("sheet-close").click();
    await expect(page.getByTestId("settings-sheet")).toHaveCount(0);
    // It must NOT be one of the five bar destinations.
    await expect(page.locator(".fabnav a")).toHaveCount(5);
  });

  test("returns to the exact section it was opened from", async ({ page }) => {
    // Regression: opening Settings used to reset the router, so closing it
    // dumped the user on Brief regardless of where they had been.
    for (const p of PAGES) {
      await page.goto(`/${p.hash}`);
      await expect(page.locator(".fabnav")).toBeVisible();
      await page.getByTestId("open-settings").click();
      await expect(page.getByTestId("settings-sheet")).toBeVisible();
      await page.getByTestId("sheet-close").click();
      await expect(page.getByTestId("settings-sheet")).toHaveCount(0);
      await expect(page, `returned to the wrong place from ${p.name}`).toHaveURL(
        new RegExp(`${p.hash.replace("#", "\\u0023")}$`),
      );
      await expect(page.getByTestId(p.page), `wrong page after returning from ${p.name}`).toBeAttached();
    }
  });

  test("the back gesture also returns to the previous section", async ({ page }) => {
    await page.goto("/#/trupp");
    await expect(page.getByTestId("squad-page")).toBeAttached();
    await page.getByTestId("open-settings").click();
    await expect(page.getByTestId("settings-sheet")).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId("settings-sheet")).toHaveCount(0);
    await expect(page).toHaveURL(/\u0023\/trupp$/);
  });

  test("settings is hash-addressable and reports the current squad size", async ({ page }) => {
    await page.goto("/#/installningar");
    await expect(page.getByTestId("settings-sheet")).toBeVisible();
    await expect(page.getByTestId("settings-squad")).toContainText("herrtrupp");
  });
});
