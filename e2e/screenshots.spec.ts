import { test } from "@playwright/test";

const SHOTS = [
  { hash: "#/", name: "home" },
  { hash: "#/matcher", name: "matches" },
  { hash: "#/nyheter", name: "news" },
  { hash: "#/spelare", name: "players" },
];

test.describe("Visual regression screenshots", () => {
  for (const s of SHOTS) {
    test(`screenshot ${s.name}`, async ({ page }) => {
      await page.goto(`/${s.hash}`);
      // Mask dynamic timestamps for stable screenshots.
      await page.getByTestId("stale-note").evaluate((el) => (el.textContent = "Senast uppdaterad 24 sep 12:00")).catch(() => {});
      await page.waitForTimeout(300);
      await page.screenshot({ path: `test-results/screens/${s.name}.png`, fullPage: true });
    });
  }

  test("screenshot player detail", async ({ page }) => {
    await page.goto("/#/spelare");
    await page.getByRole("button", { name: /Nuvarande klubb|·/ }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: "test-results/screens/player-detail.png", fullPage: true });
  });
});
