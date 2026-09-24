import { test, expect } from "@playwright/test";

test.describe("Settings", () => {
  test("gear icon exists with accessible label", async ({ page }) => {
    await page.goto("/#/");
    const gear = page.getByRole("button", { name: "Inställningar" });
    await expect(gear).toBeVisible();
    const box = await gear.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(48);
    expect(box!.height).toBeGreaterThanOrEqual(48);
  });

  test("settings page shows app name, diagnostics and source list", async ({ page }) => {
    await page.goto("/#/installningar");
    await expect(page.getByRole("heading", { name: "Inställningar" })).toBeVisible();
    await expect(page.getByText("Min BKH-app").first()).toBeVisible();
    await expect(page.getByTestId("diagnostics")).toBeVisible();
    await expect(page.getByTestId("source-list")).toBeVisible();
  });

  test("source list shows sources with roles and links", async ({ page }) => {
    await page.goto("/#/installningar");
    const list = page.getByTestId("source-list");
    await expect(list).toBeVisible();
    // BK Häcken as primary source.
    await expect(list.getByRole("link", { name: "BK Häcken" })).toBeVisible();
    // Firecrawl explained as discovery tool, not a news publisher.
    await expect(list.locator(".source-row", { hasText: "Firecrawl" })).toBeVisible();
  });

  test("no secrets appear on the settings page", async ({ page }) => {
    await page.goto("/#/installningar");
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/API_FOOTBALL_KEY\s*[:=]\s*\S+/);
    expect(text).not.toMatch(/fc-[a-zA-Z0-9]{20,}/);
  });
});
