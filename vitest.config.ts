// vitest.config.ts
import { defineConfig } from 'vitest/config'
import vue2 from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
    plugins: [vue2()],
    resolve: {
        alias: {
            '@': path.resolve(import.meta.dirname, 'frontend'),
        },
    },
    test: {
        globals: true,
        environment: 'happy-dom',
        setupFiles: ['./vitest.setup.ts'],
        include: ['**/*.{test,spec}.{js,ts,jsx,tsx}'],
        // tests/e2e is Playwright's testDir; those specs import @playwright/test
        // and can't run under vitest.
        exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
        css: true, // Handle CSS imports
    },
})
