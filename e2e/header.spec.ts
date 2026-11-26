import { test, expect } from "@playwright/test";

/**
 * The header — identity row, glass controls, and the scrolling wordmark.
 *
 * WHAT THESE TESTS ESTABLISH
 *   - The header is FIXED, so the controls stay on screen while the page
 *     scrolls. This is the whole point of the restructure: the app name
 *     scrolls away, the buttons do not.
 *   - The wordmark actually fades out on scroll and comes back at the top.
 *   - The app icon is a real button that opens the About sheet.
 *   - The build id is NOT in the header any more; it lives in About.
 *   - The three controls meet the 44px touch minimum and do not overlap.
 *
 * WHAT THEY DO NOT ESTABLISH
 *   The glass blur itself. `backdrop-filter` is a progressive enhancement and
 *   Chromium renders it, but whether it reads as "liquid" on a real iPhone is
 *   a hardware judgement, not an assertion.
 */

test.describe("Header", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/#/");
    await expect(page.getByTestId("brief-page")).toBeAttached({ timeout: 20_000 });
  });

  test("the controls stay put while the page scrolls", async ({ page }) => {
    const cog = page.getByTestId("open-settings");
    const before = await cog.boundingBox();

    await page.evaluate(() => {
      const layer = document.querySelector(".layer") as HTMLElement;
      layer.scrollTop = 300;
    });
    await page.waitForTimeout(300);

    const after = await cog.boundingBox();
    // A fixed header means the button's viewport position is unchanged.
    expect(after!.y).toBe(before!.y);
    // And the page really did scroll, or this proves nothing.
    const scrolled = await page.evaluate(
      () => (document.querySelector(".layer") as HTMLElement).scrollTop,
    );
    expect(scrolled).toBeGreaterThan(100);
  });

  test("the app name scrolls away and returns", async ({ page }) => {
    const brand = page.getByTestId("brand");
    await expect(brand).toBeVisible();

    await page.evaluate(() => {
      (document.querySelector(".layer") as HTMLElement).scrollTop = 300;
    });
    await page.waitForTimeout(300);
    // Fully faded AND out of the accessibility tree — a transparent element
    // that is still focusable is worse than one that is gone.
    await expect(brand).toHaveCSS("visibility", "hidden");

    await page.evaluate(() => {
      (document.querySelector(".layer") as HTMLElement).scrollTop = 0;
    });
    await page.waitForTimeout(300);
    await expect(brand).toHaveCSS("visibility", "visible");
  });

  test("the app icon opens the About sheet", async ({ page }) => {
    await page.getByTestId("open-about").click();
    const sheet = page.getByTestId("about-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Om appen");
    // The build id lives here now, not in the header.
    await expect(page.getByTestId("about-build")).toContainText("Version");
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });

  test("the build id is no longer supporter-facing chrome", async ({ page }) => {
    // It was 9px monospace under "Uppdaterad" in the header. It is a
    // diagnostic, so it belongs in About, not in the identity row.
    await expect(page.locator(".app-header .build-id")).toHaveCount(0);
    await expect(page.locator(".app-header .freshness")).toHaveCount(0);
  });

  test("all three header controls meet the touch minimum", async ({ page }) => {
    for (const id of ["open-about", "kit-toggle", "open-settings"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box!.width, `${id} width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${id} height`).toBeGreaterThanOrEqual(44);
    }
  });

  test("the header is an overlay, not a menu bar", async ({ page }) => {
    // The user's request: no permanent band at the top. The header must paint
    // no background and no border, and must not swallow taps meant for the
    // page — only its three controls are tappable.
    const header = page.locator(".app-header");
    await expect(header).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(header).toHaveCSS("border-bottom-width", "0px");
    await expect(header).toHaveCSS("pointer-events", "none");
    await expect(page.getByTestId("open-settings")).toHaveCSS("pointer-events", "auto");
  });

  test("content scrolls under the floating controls", async ({ page }) => {
    // The clearance for the buttons lives on the scroller's padding, so it
    // scrolls away with the content. After scrolling, content must be visible
    // in the band the header occupies — that is what "no menu bar" means.
    await page.evaluate(() => {
      (document.querySelector(".layer") as HTMLElement).scrollTop = 400;
    });
    await page.waitForTimeout(300);
    const covered = await page.evaluate(() => {
      const header = document.querySelector(".app-header")!.getBoundingClientRect();
      // Sample a point in the header band that is NOT one of the buttons.
      const x = window.innerWidth / 2;
      const y = header.top + header.height / 2;
      const el = document.elementFromPoint(x, y);
      return el?.closest(".app-header") !== null;
    });
    expect(covered).toBe(false);
  });

  test("the header does not overlap the first content", async ({ page }) => {
    // The header is an overlay, so the scroller's top padding must keep the
    // first module clear of the buttons at rest.
    const geo = await page.evaluate(() => {
      const header = document.querySelector(".app-header")!.getBoundingClientRect();
      const first = document.querySelector(".module")!.getBoundingClientRect();
      return { headerBottom: header.bottom, firstTop: first.top };
    });
    expect(geo.firstTop).toBeGreaterThanOrEqual(geo.headerBottom - 1);
  });
});
