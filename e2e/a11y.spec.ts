import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PAGES = [
  { hash: "#/", name: "Hem" },
  { hash: "#/matcher", name: "Matcher" },
  { hash: "#/nyheter", name: "Nyheter" },
  { hash: "#/spelare", name: "Spelare" },
];

test.describe("Accessibility (axe-core)", () => {
  for (const p of PAGES) {
    test(`no critical violations on ${p.name}`, async ({ page }) => {
      await page.goto(`/${p.hash}`);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const critical = results.violations.filter((v) =>
        ["critical", "serious"].includes(v.impact ?? ""),
      );
      expect(
        critical.map((v) => `${v.id}: ${v.nodes.length} nodes`),
        `Accessibility violations on ${p.name}`,
      ).toEqual([]);
    });
  }
});
