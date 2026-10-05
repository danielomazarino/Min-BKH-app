import { test, expect } from "@playwright/test";

/**
 * The kit toggle — the jersey button that switches the app between the HOME
 * kit (black, the default) and the AWAY kit (white with black and yellow).
 *
 * WHAT THESE TESTS ESTABLISH
 *   - The toggle exists, sits left of the cog wheel, and is a real button.
 *   - Tapping it flips the document's data-theme attribute BOTH ways.
 *   - The choice survives a reload (localStorage).
 *   - The icon shows the kit you would switch TO, not the one you are in —
 *     the accessible name is the assertion for that.
 *   - The light theme actually changes the page background, so a regression
 *     that redefined tokens but left the body black would fail here.
 *
 * WHAT THEY DO NOT ESTABLISH
 *   Contrast ratios are asserted in the CSS comments and verified by the axe
 *   a11y suite, not here. And a real iPhone's status-bar tint (theme-color
 *   meta) is only verifiable on hardware.
 */

test.describe("Kit toggle", () => {
  test.beforeEach(async ({ page }) => {
    // Playwright's DEFAULT colorScheme is "light" — which the app correctly
    // follows into the away kit. These tests assert the DARK default, so they
    // must emulate a dark-preference device explicitly. The system-follow path
    // gets its own test below.
    await page.emulateMedia({ colorScheme: "dark" });
    // Clear storage ONCE, on the app's own origin, NOT via addInitScript:
    // that runs on EVERY navigation, so it would wipe the stored choice on
    // the reload in the persistence test and that test would exercise the
    // harness, not the app. (Found exactly that way.)
    await page.goto("/#/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId("kit-toggle")).toBeVisible();
  });

  test("starts in the home kit (dark) on a dark-preference device", async ({ page }) => {
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
    // The user-visible fact, not just the attribute.
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  });

  test("tapping the jersey switches to the away kit and back", async ({ page }) => {
    const toggle = page.getByTestId("kit-toggle");

    // TO AWAY. The accessible name must describe what a tap WILL do.
    await expect(toggle).toHaveAttribute("aria-label", /borta-tema/i);
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    // The user-visible fact, not just the attribute: the page is now white.
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    // And the icon now offers the way back.
    await expect(toggle).toHaveAttribute("aria-label", /hemmatema/i);
    // aria-pressed reflects away mode. (toBeChecked is for checkboxes; this
    // is an aria-pressed BUTTON, so the attribute is the assertion.)
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // BACK TO HOME.
    await toggle.click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  test("the choice survives a reload", async ({ page }) => {
    await page.getByTestId("kit-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    // Still away after a full reload — the whole point of persisting.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByTestId("kit-toggle")).toHaveAttribute("aria-pressed", "true");
  });

  test("the toggle sits left of the settings button", async ({ page }) => {
    const kit = await page.getByTestId("kit-toggle").boundingBox();
    const cog = await page.getByTestId("open-settings").boundingBox();
    expect(kit!.x).toBeLessThan(cog!.x);
    // And both are in the header, so neither is pushed off-screen.
    expect(kit!.y).toBe(cog!.y);
  });

  test("the header follows the theme", async ({ page }) => {
    // The header was the one element with a hardcoded dark background. If it
    // stayed black in the away kit, the toggle would look broken at first
    // glance — so this is the regression that matters most.
    const header = page.locator(".app-header");
    await page.getByTestId("kit-toggle").click();
    await expect(header).not.toHaveCSS("background-color", "rgb(0, 0, 0)");
  });

  test("follows a light system preference until the user chooses", async ({ browser }) => {
    // A NEW context, because this test needs the OPPOSITE system preference
    // from the describe-level emulation.
    const page = await browser.newPage({ colorScheme: "light" });
    // NOT addInitScript here: that runs on EVERY navigation, so it would wipe
    // the stored choice on the reload below and the persistence assertion
    // would test the harness, not the app. Clear once, on the app's own
    // origin (about:blank has no localStorage at all).
    await page.goto("/#/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    // No stored choice + light system preference = away kit, without the
    // user ever finding the toggle.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    // Now choose home explicitly. The stored choice must WIN over the system
    // from here on — that is what a toggle means.
    await page.getByTestId("kit-toggle").click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
    await page.close();
  });
});
