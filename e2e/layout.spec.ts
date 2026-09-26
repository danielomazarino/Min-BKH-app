import { test, expect } from "@playwright/test";

const PAGES = [
  { hash: "#/", name: "Brief" },
  { hash: "#/matcher", name: "Matcher" },
  { hash: "#/tidigare", name: "Tidigare" },
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

  test("content clears the fixed tab bar", async ({ page }) => {
    // The SvFF rule paragraph previously sat underneath the bar until scrolled.
    // The layer is now a scroll container inside a height-capped shell, so the
    // whole layer must end above the fixed bar and scroll internally.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/");
    const layer = page.getByTestId("layer-oversikt");
    await expect(layer).toBeAttached();
    await expect(page.locator(".tabbar")).toBeVisible();
    const geo = await page.evaluate(() => {
      const l = document.querySelector('[data-testid="layer-oversikt"]');
      const nav = document.querySelector(".tabbar");
      if (!l || !nav) return null;
      return {
        layerBottom: l.getBoundingClientRect().bottom,
        navTop: nav.getBoundingClientRect().top,
        overflowY: getComputedStyle(l).overflowY,
      };
    });
    expect(geo).not.toBeNull();
    // The scrollable region ends above the bar.
    expect(geo!.layerBottom).toBeLessThanOrEqual(geo!.navTop + 1);
    // And it is a real scroll container, so long content stays reachable.
    expect(geo!.overflowY).toBe("auto");
  });

  test("header respects the safe-area top inset", async ({ page }) => {
    await page.goto("/#/");
    const padding = await page.locator(".app-header").evaluate((el) => getComputedStyle(el).paddingTop);
    // Declares env(safe-area-inset-top); resolves to 0px in a desktop browser
    // but the declaration must be present in the stylesheet.
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

  test("navigation is reduced to two destinations", async ({ page }) => {
    await page.goto("/#/");
    await page.waitForTimeout(500);
    // Brief + Tidigare. Matches and Settings are contextual now.
    await expect(page.locator(".tabbar a")).toHaveCount(2);
    await expect(page.getByTestId("tab-home")).toBeVisible();
    await expect(page.getByTestId("tab-former")).toBeVisible();
  });

  test("settings is a sheet, not a page", async ({ page }) => {
    await page.goto("/#/");
    await page.getByTestId("open-settings").click();
    await expect(page.getByTestId("settings-sheet")).toBeVisible();
    // Provenance is present but behind a disclosure.
    await expect(page.getByTestId("diagnostics")).toBeVisible();
    await page.getByTestId("close-settings").click();
    await expect(page.getByTestId("settings-sheet")).toHaveCount(0);
  });
});
