// https://vitejs.dev/config/

import { defineConfig, UserConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

const commonConfig: UserConfig = {
    root: resolve(import.meta.dirname, './frontend'),
    // URL prefix for assets, should be the same as DJANGO_VITE.static_url_prefix
    // in settings.py
    base: '/bundles/',
    // Env vars prefixed with TUUL_ will be available in the frontend
    envDir: process.cwd(),
    envPrefix: 'TUUL_',
    plugins: [vue(),
    // Custom plugin for loading jsmediatags (an old cjs script) correctly in esm
    {
        name: 'handle-jsmediatags',
        transform(code, id) {
            if (id.includes('jsmediatags.min.js')) {
                // Wrap the code in a module format Vite can understand
                return {
                    code: `
                    const module = { exports: {} };
                    const exports = module.exports;
                    const global = window;
                    ${code};
                    export default module.exports;
                  `,
                    map: null
                };
            }
        }
    }
    ],
    resolve: {
        alias: {
            '@': resolve(import.meta.dirname, './frontend'),
        },
    },
    build: {
        outDir: '../api/assets/bundles',
        emptyOutDir: true,
        manifest: true,
        sourcemap: false,
        rollupOptions: {
            input: resolve(import.meta.dirname, 'frontend/index.ts'),
        }
    }
}

export default commonConfig