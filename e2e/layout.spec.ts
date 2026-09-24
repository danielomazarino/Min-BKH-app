import { test, expect } from "@playwright/test";

const PAGES = [
  { hash: "#/", name: "Hem" },
  { hash: "#/matcher", name: "Matcher" },
  { hash: "#/nyheter", name: "Nyheter" },
  { hash: "#/spelare", name: "Spelare" },
];

test.describe("Layout", () => {
  for (const vp of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    test(`no horizontal overflow at ${vp.width}px on all pages`, async ({ page }) => {
      await page.setViewportSize(vp);
      for (const p of PAGES) {
        await page.goto(`/${p.hash}`);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${p.name} overflows horizontally at ${vp.width}px`).toBeLessThanOrEqual(0);
      }
    });
  }

  test("bottom navigation has 48px+ touch targets", async ({ page }) => {
    await page.goto("/#/");
    const links = page.locator(".bottom-nav a");
    const count = await links.count();
    expect(count).toBe(4);
    for (let i = 0; i < count; i++) {
      const box = await links.nth(i).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(48);
      expect(box!.width).toBeGreaterThanOrEqual(48);
    }
  });
});
