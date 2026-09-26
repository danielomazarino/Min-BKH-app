import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
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
