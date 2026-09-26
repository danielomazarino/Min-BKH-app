import { test, expect, type Page } from "@playwright/test";

/**
 * PWA installability and Home Screen launch.
 *
 * PRODUCTION BLOCKER THIS SUITE EXISTS TO PREVENT
 * ----------------------------------------------
 * The app is deployed to a GitHub Pages PROJECT sub-path
 * (https://<user>.github.io/Min-BKH-app/), NOT a domain root.
 *
 * The manifest shipped `start_url: "/"` and icon `src: "/icons/...png"`.
 * Those are ORIGIN-ABSOLUTE, so they resolved to
 * https://danielomazarino.github.io/ and https://danielomazarino.github.io/icons/...
 * GitHub Pages serves neither (both 404) because the real files live under the
 * project prefix. "Add to Home Screen" therefore SUCCEEDED — Safari found the
 * manifest and the icon — but launching the installed app resolved start_url
 * and showed a 404 page.
 *
 * These assertions read the manifest the BUILD actually emitted, not the
 * source config, so the same class of bug cannot come back through a
 * differently-spelled value.
 */

/** Read the manifest the way the browser does: from the linked href. */
async function readManifest(page: Page) {
  const href = await page
    .locator('link[rel="manifest"]')
    .evaluate((el) => (el as HTMLLinkElement).href);
  const res = await page.request.get(href);
  expect(res.status(), `manifest at ${href} must be served`).toBe(200);
  return { href, json: (await res.json()) as Record<string, unknown> };
}

test.describe("PWA manifest", () => {
  test("is linked from the document and is served", async ({ page }) => {
    await page.goto("/#/");
    const m = await readManifest(page);
    expect(new URL(m.href).pathname).toBe("/Min-BKH-app/manifest.webmanifest");
  });

  test("start_url resolves INSIDE the app directory, not the domain root", async ({ page }) => {
    await page.goto("/#/");
    const { json } = await readManifest(page);
    const start = new URL(String(json.start_url), page.url());

    // The defect: an origin-absolute "/" lands on https://<user>.github.io/,
    // which GitHub Pages does not serve.
    expect(start.origin).toBe(new URL(page.url()).origin);
    expect(start.pathname, "start_url escaped the app directory").toBe("/Min-BKH-app/");

    // The URL the Home Screen icon launches must actually serve the app.
    const res = await page.request.get(start.href);
    expect(res.status(), `start_url ${start.href} 404s — Home Screen launch would fail`).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  test("scope covers the app directory", async ({ page }) => {
    await page.goto("/#/");
    const { json } = await readManifest(page);
    expect(new URL(String(json.scope), page.url()).pathname).toBe("/Min-BKH-app/");
  });

  test("every icon is reachable and none is origin-absolute", async ({ page }) => {
    await page.goto("/#/");
    const { json } = await readManifest(page);
    const icons = json.icons as { src: string; sizes: string }[];
    expect(icons.length, "manifest declares no icons").toBeGreaterThan(0);

    for (const icon of icons) {
      expect(icon.src.startsWith("/"), `icon "${icon.src}" is origin-absolute and will 404 on GitHub Pages`).toBe(
        false,
      );
      const url = new URL(icon.src, page.url());
      expect(url.pathname.startsWith("/Min-BKH-app/"), `icon "${icon.src}" escapes the app directory`).toBe(true);

      const res = await page.request.get(url.href);
      expect(res.status(), `icon ${url.href} 404s — the Home Screen icon is broken`).toBe(200);
    }
  });

  test("the apple-touch-icon the iOS Home Screen uses is reachable", async ({ page }) => {
    // Safari on iOS uses this <link>, NOT the manifest icons, to draw the
    // Home Screen icon. It was "/icons/apple-touch-icon.png" and 404'd.
    await page.goto("/#/");
    const href = await page
      .locator('link[rel="apple-touch-icon"]')
      .evaluate((el) => (el as HTMLLinkElement).href);
    expect(href.startsWith(new URL(page.url()).origin)).toBe(true);
    const res = await page.request.get(href);
    expect(res.status(), `apple-touch-icon ${href} 404s`).toBe(200);
  });
});

test.describe("Service worker", () => {
  test("does not claim the domain root and loads without error", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto("/#/");
    // Give the generated worker time to install and settle.
    await page.waitForTimeout(4000);

    const regs = await page.evaluate(async () => {
      const rs = await navigator.serviceWorker.getRegistrations();
      return rs.map((r) => ({ scope: r.scope, active: r.active?.state ?? null }));
    });
    for (const r of regs) {
      // r.scope is an absolute URL, so compare its path, not the raw string.
      expect(new URL(r.scope).pathname, "service worker scope escaped the app directory").toBe("/Min-BKH-app/");
    }

    // A 404 on the worker script or the manifest surfaces here.
    expect(errors.filter((e) => /sw\.js|service ?worker|manifest/i.test(e))).toEqual([]);
  });
});

test.describe("Home Screen launch simulation", () => {
  test("the document at start_url boots the app into Brief", async ({ page, baseURL }) => {
    // As close as a browser can get to tapping the Home Screen icon: load
    // exactly the URL the installed app launches, in a clean context, and
    // assert the React app renders.
    await page.goto("/#/");
    const { json } = await readManifest(page);
    const start = new URL(String(json.start_url), `${baseURL}/`).href;

    const browser = page.context().browser();
    expect(browser, "no browser available to open a clean context").not.toBeNull();
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 } });
    const fresh = await ctx.newPage();
    const bad: string[] = [];
    fresh.on("response", (r) => {
      if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
    });
    fresh.on("pageerror", (e) => bad.push(`pageerror: ${e.message}`));

    const res = await fresh.goto(start);
    expect(res?.status(), `Home Screen launch URL ${start} 404s`).toBe(200);
    await fresh.waitForSelector(".fabnav", { timeout: 15000 });
    await expect(fresh.getByTestId("brief-page")).toBeAttached();
    await expect(fresh.getByTestId("tab-brief")).toHaveAttribute("aria-current", "page");
    expect(bad, "the launch document reported failures").toEqual([]);
    await ctx.close();
  });
});
