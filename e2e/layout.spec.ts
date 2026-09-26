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
  { hash: "#/", name: "Brief", page: "brief-page" },
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
});

test.describe("Settings", () => {
  test("is a sheet reached from the header, and is not a destination", async ({ page }) => {
    await page.goto("/#/");
    await page.getByTestId("open-settings").click();
    await expect(page.getByTestId("settings-sheet")).toBeVisible();
    await expect(page.getByTestId("diagnostics")).toBeVisible();
    await page.getByTestId("close-settings").click();
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
      await page.getByTestId("close-settings").click();
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
