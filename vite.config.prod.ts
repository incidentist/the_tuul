// vite.config.prod.ts
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import { defineConfig, mergeConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import commonConfig from "./vite.config.common";

// The files under /static/ that the page needs to start, outside the Vite build.
const STATIC_PRECACHE = [
  "favicon.ico",
  // The preview's default font, so that it can draw offline. Keep in sync with DEFAULT_FONT in
  // SubtitleDisplay.vue.
  "fonts/LiberationSans.ttf",
  "ffmpeg/worker.js",
  "ffmpeg/const.js",
  "ffmpeg/errors.js",
];

/**
 * Hash a file's content, so its precache entry changes exactly when the file does.
 */
function fileRevision(path: string): string {
  return createHash("md5").update(readFileSync(path)).digest("hex");
}

type ManifestEntry = { url: string; revision: string | null; size: number };

/**
 * Point the build's entries at /static/bundles/, where FastAPI serves them, and add the static
 * files and the page.
 * The page's revision covers the bundle and the template,
 * so a new deployment of either refetches it at install.
 */
function precacheEntries(entries: ManifestEntry[]) {
  const bundle = entries.map((entry) => ({ ...entry, url: `/static/bundles/${entry.url}` }));
  const statics = STATIC_PRECACHE.map((file) => {
    const path = resolve(__dirname, "api/assets", file);
    return { url: `/static/${file}`, revision: fileRevision(path), size: 0 };
  });
  const pageRevision = createHash("md5")
    .update(bundle.map((entry) => `${entry.url} ${entry.revision}`).join("\n"))
    .update(readFileSync(resolve(__dirname, "api/templates/index.html")))
    .digest("hex");
  const page = { url: "/", revision: pageRevision, size: 0 };
  return { manifest: [...bundle, ...statics, page], warnings: [] };
}

export default mergeConfig(
  commonConfig,
  defineConfig({
    // FastAPI serves the build here, and URLs baked into the bundle, such as a worker's, must
    // point to it.
    base: "/static/bundles/",
    build: {
      minify: true,
    },
    plugins: [
      VitePWA({
        strategies: "injectManifest",
        srcDir: ".",
        filename: "sw.ts",
        injectRegister: false,
        manifest: false,
        injectManifest: {
          // JASSUB's two wasm builds are both precached, since the browser's SIMD support picks one.
          // Each is over Workbox's 2 MiB default.
          globPatterns: ["**/*.{js,css,wasm}"],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          manifestTransforms: [precacheEntries],
          rollupFormat: "iife",
        },
      }),
    ],
  }),
);
