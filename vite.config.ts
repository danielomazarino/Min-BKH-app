import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * BUILD IDENTIFICATION — two separate concerns, deliberately kept apart.
 *
 * WHY THIS EXISTS AT ALL
 * A service worker with `registerType: "autoUpdate"` precaches the bundle, so
 * a stale worker can keep serving an OLD build after a new one is deployed. The
 * symptom is maddening: change the code, rebuild, reload, and the old behaviour
 * persists — which looks exactly like "my fix did not work".
 *
 * That trap has already cost real time in this repo. Without an identifier
 * there is no way to tell, from the running app, WHICH build is on screen, so
 * two people can look at the same URL and disagree about behaviour because they
 * are running different builds.
 *
 * ------------------------------------------------------------------
 * DEV (`buildBadge` below) — full detail, and the SW escape hatch
 * ------------------------------------------------------------------
 * Shows: the full git SHA, the build time, and the live service-worker state,
 * with a click-to-unregister control that also clears every cache.
 *
 * This is the answer to "how do I avoid a stale precached service worker
 * during development". Vite's dev server serves modules from disk, so an SW
 * in development can only cause harm — it has no precache to be useful for.
 *
 * PRODUCTION IS NOT WEAKENED BY ANY OF THIS. `registerType: "autoUpdate"` and
 * the full precache are untouched. The unregister control does not exist in a
 * production build, and no supporter can reach a devtools button.
 *
 * ------------------------------------------------------------------
 * PRODUCTION (`versionLabel` below) — a version, and nothing sensitive
 * ------------------------------------------------------------------
 * The dev badge is useless for the one case that matters most here: verifying
 * on a real iPhone, where the build being served is invisible. So a production
 * build gets an unobtrusive label too, findable in Safari AND in the installed
 * PWA.
 *
 * WHAT IT SHOWS, AND WHY IT IS SAFE
 *   - a short SHA and a build timestamp: these identify a build, and a git
 *     short hash is not a secret. The repository is public.
 *   - it is rendered from `index.html` as plain text, so it works with the SW
 *     caching the precache, in Safari and standalone alike.
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW
 *   - no unregister button, no cache controls, nothing interactive
 *   - no branch name, no commit message, no author, no environment secrets
 *
 * It is styled to sit quietly in the corner and is marked aria-hidden, because
 * a build stamp is not something a screen-reader user needs announced.
 *
 * TO HIDE IT ENTIRELY once testing is done: set `SHOW_VERSION_LABEL = false`
 * below. One flag, no code changes elsewhere.
 */
function buildBadge(): Plugin {
  const sha = (() => {
    try {
      return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      return "nogit";
    }
  })();
  const builtAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  return {
    name: "dev-build-badge",
    // DEV ONLY. In a production build this returns an empty string and no
    // badge is rendered at all.
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") return html;
      const badge = `
<div id="__build_badge" data-build-sha="${sha}" data-build-at="${builtAt}" style="position:fixed;top:0;left:0;z-index:2147483647;background:#000;color:#0f0;font:11px/1.4 ui-monospace,monospace;padding:3px 6px;border-bottom-right-radius:6px;opacity:.85;pointer-events:auto">dev ${sha} ${builtAt}</div>
<script>
(function(){
  var el = document.getElementById('__build_badge');
  function txt(s){ el.textContent = 'dev ${sha} ' + s; }
  if (!('serviceWorker' in navigator)) { txt('(no SW API)'); return; }
  navigator.serviceWorker.getRegistrations().then(function(rs){
    if (!rs.length) { txt('(no SW registered)'); return; }
    txt('(SW active - click to unregister)');
    el.style.cursor = 'pointer';
    el.addEventListener('click', function(){
      Promise.all(rs.map(function(r){ return r.unregister(); }))
        .then(function(){ return caches.keys(); })
        .then(function(ks){ return Promise.all(ks.map(function(k){ return caches.delete(k); })); })
        .then(function(){ txt('SW unregistered - hard reload'); });
    });
  });
})();
</script>`;
      return html.replace("</body>", badge + "\n</body>");
    },
  };
}

/**
 * Set to false to remove the version label from production builds entirely.
 * Kept as a single named flag so the decision is reversible and visible.
 */
const SHOW_VERSION_LABEL = true;

function shortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "nogit";
  }
}

/**
 * The build id itself, printed in the header.
 *
 * WHY IT IS NOT ONLY THE GIT SHA
 * `git rev-parse --short HEAD` alone cannot answer the question this exists to
 * answer, for two independent reasons:
 *
 *   1. UNCOMMITTED WORK IS INVISIBLE. The SHA names a COMMIT. If the working
 *      tree is dirty — which it is whenever a feature is mid-build — every
 *      rebuild reports the same id, so two genuinely different builds look
 *      identical on screen. The nav rewrite in this repo sat behind an
 *      unchanged SHA for a whole day while uncommitted.
 *   2. IT SAYS NOTHING ABOUT THE OUTPUT. Two builds of the same commit can
 *      differ (different toolchain, changed dependency, different env), and the
 *      SHA cannot tell you that they did.
 *
 * SO IT IS DERIVED FROM WHAT IS ACTUALLY SHIPPED: a short hash of the built
 * bundle's real content. It therefore changes for every build whose OUTPUT
 * differs, whether or not anything was committed, and is stable for a rebuild
 * whose output is genuinely identical.
 *
 * Deliberately NOT included: branch name, commit message, author, or any
 * environment value. A short git hash is not a secret — the repo is public —
 * but nothing beyond hash + timestamp is worth publishing.
 */
function contentId(): string {
  try {
    // NOTE: these are imported at the TOP of this file, not `require`d here.
    // vite.config.ts is loaded as ESM, where `require` is not in scope — the
    // first version of this function called it and silently degraded every
    // build to the `.local` fallback, which would have produced a label that
    // never changes and so could not do the one job it exists for.
    const dir = path.resolve(process.cwd(), "dist");
    const entries: string[] = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }) : [];

    // ONLY THE EMITTED ASSETS. Deliberately NOT index.html: index.html is the
    // file this id is written INTO, so hashing it makes the value
    // self-referential — each build hashes the PREVIOUS build's label, and the
    // id freezes at whatever the first run produced. That bug shipped a build
    // reporting `1eb0429` while the true content digest was `acb9c4c`.
    //
    // Excluding sw.js/workbox/manifest for the same class of reason: their
    // filenames already embed their own hashes, so including them would make
    // the id unstable for no informational gain.
    const parts = entries
      .filter((f) => /\.(js|css)$/.test(f) && !/sw\.js|workbox|manifest/i.test(f))
      .sort()
      .map((f) => {
        const abs = path.join(dir, f);
        if (!fs.statSync(abs).isFile()) return "";
        return `${f}:${createHash("sha256").update(fs.readFileSync(abs)).digest("hex")}`;
      })
      .filter(Boolean);

    if (parts.length === 0) return `${shortSha()}.nodist`;

    return `${shortSha()}.${createHash("sha256").update(parts.join("\n") + shortSha()).digest("hex").slice(0, 7)}`;
  } catch (err) {
    // A label must never be able to fail a build — but a SILENT fallback
    // defeats the label's entire purpose, so the reason is logged.
    console.warn(`[version-label] content hash failed, id will not change per build: ${String(err)}`);
    return `${shortSha()}.local`;
  }
}

/**
 * The production version label.
 *
 * Written as STATIC HTML so it needs no JavaScript: a label that depends on a
 * script is a label that can fail to appear, and its whole purpose is to be
 * found. Readable in Safari and in the installed PWA alike, because it ships
 * in the precached document itself.
 *
 * WHY IT IS STAMPED IN `closeBundle` AND NOT IN `transformIndexHtml`
 * The id is a hash of the emitted bundle, so it is not knowable until the
 * bundle exists on disk. `transformIndexHtml` runs BEFORE emit, and hashing
 * there either finds nothing (first build) or the PREVIOUS build's files — in
 * both cases reporting an id that does not describe the build being shipped.
 * `closeBundle` runs after the bundle is written, which is the first moment
 * the hash is both available and meaningful.
 *
 * The value is also read back by App.tsx into the header, directly UNDER the
 * "Uppdaterad" freshness label, which is the copy intended for reading on a
 * real iPhone. This injected div remains as a zero-JS fallback for the
 * installed PWA, where the React tree can be served from a precache older than
 * the document.
 */
function versionLabel(): Plugin {
  let outDir = "dist";
  return {
    name: "version-label",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      if (!SHOW_VERSION_LABEL) return;
      const id = contentId();
      const at = new Date().toISOString().replace("T", " ").slice(0, 16);
      const file = path.resolve(process.cwd(), outDir, "index.html");
      if (!fs.existsSync(file)) {
        console.warn(`[version-label] ${file} not found; build id not stamped.`);
        return;
      }
      let html = fs.readFileSync(file, "utf8");

      // Remove the old VISIBLE overlay if a previous build left one. It was a
      // fixed-position green label stamped over the top-left of the screen; it
      // was never sanctioned and is gone now. The id itself is preserved — it
      // now lives on <html> as a data attribute instead, which is invisible.
      html = html.replace(/\s*<div id="__build_label"[\s\S]*?<\/div>/g, "");

      // The id goes on <html data-build>. Invisible, present in the precached
      // document (so the installed PWA has it without JS), and read by App.tsx
      // to render the label IN the header, under the freshness line, where it
      // was actually asked for.
      if (/<html\b/.test(html)) {
        html = html.replace(/<html\b([^>]*)>/, (m, attrs: string) => {
          const cleaned = attrs
            .replace(/\s*data-build="[^"]*"/g, "")
            .replace(/\s*data-build-at="[^"]*"/g, "");
          return `<html${cleaned} data-build="${id}" data-build-at="${at}">`;
        });
      }

      fs.writeFileSync(file, html, "utf8");
      console.log(`\n  version-label: stamped build id ${id} (${at})\n`);
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    buildBadge(),
    versionLabel(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png", "icons/maskable-192.png", "icons/maskable-512.png"],
      manifest: {
        name: "Min BKH-app",
        short_name: "Min BKH-app",
        description: "Supporterapp för BK Häckens herrlag",
        lang: "sv-SE",
        theme_color: "#000000",
        background_color: "#000000",
        display: "standalone",
        // PRODUCTION BLOCKER FIX.
        //
        // This app is served from a GitHub Pages PROJECT sub-path
        // (https://<user>.github.io/Min-BKH-app/), not a domain root.
        // An origin-absolute start_url of "/" therefore resolves to
        // https://<user>.github.io/ — which GitHub Pages does not serve, and
        // which returns 404. Adding to the Home Screen worked (the manifest,
        // the icons and the scope were all found) but LAUNCHING the installed
        // app hit that 404 and showed nothing.
        //
        // "./" keeps the launch URL inside the app's own directory, so the
        // installed PWA resolves exactly the same document as the Safari URL.
        // The same reasoning applies to every icon `src`: "/icons/icon-512.png"
        // pointed at the domain root and 404'd too, even though the file is
        // present under the project path.
        start_url: "./",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        runtimeCaching: [
          {
            // Static generated data files: network-first with cache fallback so
            // the app shows last cached data when offline.
            urlPattern: /\/data\/.+\.json$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "bkh-data",
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // News thumbnails and article images, served from the publishers'
            // CDNs (bkhacken.se DigitalOcean Spaces, fotbolltransfers CDN).
            //
            // CacheFirst, not NetworkFirst: these are immutable per URL and
            // re-fetching them on every open wastes the reader's data. Without
            // this rule the images were not cached at all, so a story opened
            // offline showed an empty thumbnail box.
            //
            // `statuses: [0, 200]` includes opaque cross-origin responses
            // (status 0), which is what a no-cors <img> yields — without it the
            // rule would silently cache nothing.
            urlPattern: /^https:\/\/[^/]*(digitaloceanspaces\.com|bonniernews\.se)\/.*\.(?:png|jpe?g|webp|gif|avif)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "bkh-news-images",
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  base: "/Min-BKH-app/",
  test: {
    environment: "jsdom",
    globals: true,
    include: ["app/**/*.test.ts", "app/**/*.test.tsx", "pipeline/src/**/*.test.ts"],
  } as never,
});
