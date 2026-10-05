// https://vitejs.dev/config/

import { defineConfig, UserConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

const commonConfig: UserConfig = {
    root: resolve(import.meta.dirname, './frontend'),
    // URL prefix for assets. This is where the Vite dev server serves them;
    // vite.config.prod.ts overrides it for built bundles.
    base: '/bundles/',
    // Env vars prefixed with TUUL_ will be available in the frontend
    envDir: process.cwd(),
    envPrefix: 'TUUL_',
    plugins: [vue()],
    resolve: {
        alias: {
            '@': resolve(import.meta.dirname, './frontend'),
        },
        // onnxruntime-web (pulled in by web-audio-separation) defaults to bundling a 27MB binary as an
        // asset. web-audio-separation fetches the bundle from a CDN at runtime, so that asset is never
        // fetched. Tell it to not bundle the binary.
        conditions: ['module', 'browser', 'development|production', 'onnxruntime-web-use-extern-wasm'],
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