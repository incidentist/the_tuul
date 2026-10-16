// https://vitejs.dev/config/

import { readFileSync } from "fs";
import { loadEnv, Plugin, UserConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";
import { renderCustomIntro } from "./frontend/lib/customIntro";

const CUSTOM_INTRO_ID = "virtual:custom-intro";
const RESOLVED_CUSTOM_INTRO_ID = `\0${CUSTOM_INTRO_ID}`;

/**
 * Bake the Intro tab's custom Markdown into the bundle, from INTRO_FILE or else INTRO_MARKDOWN.
 * The dev server watches the file.
 */
function customIntroPlugin(): Plugin {
  let file = "";
  let markdown = "";
  return {
    name: "custom-intro",
    configResolved(config) {
      // config.env holds only TUUL_ variables.
      const env = loadEnv(config.mode, config.envDir, "");
      file = env.INTRO_FILE ? resolve(env.INTRO_FILE) : "";
      markdown = env.INTRO_MARKDOWN ?? "";
    },
    resolveId(id) {
      return id === CUSTOM_INTRO_ID ? RESOLVED_CUSTOM_INTRO_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_CUSTOM_INTRO_ID) {
        return undefined;
      }
      if (file) {
        this.addWatchFile(file);
      }
      const source = file ? readFileSync(file, "utf-8") : markdown;
      return `export default ${JSON.stringify(renderCustomIntro(source))};`;
    },
    /**
     * Refresh the module when the file changes.
     * Vite doesn't tie a watched file to the virtual module that read it, so the module would stay stale.
     */
    hotUpdate({ file: changed }) {
      if (!file || changed !== file) {
        return undefined;
      }
      const module = this.environment.moduleGraph.getModuleById(RESOLVED_CUSTOM_INTRO_ID);
      return module ? [module] : [];
    },
  };
}

const commonConfig: UserConfig = {
  root: resolve(__dirname, "./frontend"),
  // URL prefix for assets, should be the same as DJANGO_VITE.static_url_prefix
  // in settings.py
  base: "/bundles/",
  // Env vars prefixed with TUUL_ will be available in the frontend
  envDir: process.cwd(),
  envPrefix: "TUUL_",
  plugins: [
    vue(),
    customIntroPlugin(),
    // Custom plugin for loading jsmediatags (an old cjs script) correctly in esm
    {
      name: "handle-jsmediatags",
      transform(code, id) {
        if (id.includes("jsmediatags.min.js")) {
          // Wrap the code in a module format Vite can understand
          return {
            code: `
                    const module = { exports: {} };
                    const exports = module.exports;
                    const global = window;
                    ${code};
                    export default module.exports;
                  `,
            map: null,
          };
        }
      },
    },
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./frontend"),
      // rvfc-polyfill is GPL-3.0. JASSUB imports it only for its video element mode,
      // which the app doesn't use.
      "rvfc-polyfill": resolve(__dirname, "./frontend/stubs/empty.ts"),
    },
  },
  optimizeDeps: {
    // JASSUB loads its workers and wasm by URLs relative to its own files,
    // which pre-bundling would break.
    exclude: ["jassub"],
    // Its CommonJS dependency is then left unconverted unless named here.
    include: ["jassub > throughput"],
  },
  build: {
    outDir: "../api/assets/bundles",
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, "frontend/index.ts"),
    },
  },
};

export default commonConfig;
