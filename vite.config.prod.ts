// vite.config.prod.ts
import { defineConfig, mergeConfig } from 'vite'
import commonConfig from './vite.config.common.ts'

export default mergeConfig(
    commonConfig,
    defineConfig({
        // Production-specific settings
        // Built bundles are served by FastAPI's /static mount (see api/main.py and
        // api/vite_assets.py). Vite builds some asset URLs from this, such as
        // preload hints, so it must match or those requests 404.
        base: '/static/bundles/',
        build: {
            minify: true,
        }
    })
)