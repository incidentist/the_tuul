// vite.config.dev.ts
import fs from 'fs';
import path from 'path';
import { defineConfig, mergeConfig, Plugin } from 'vite'

import commonConfig from './vite.config.common.ts'


interface MoveSourcemapsOptions {
    targetDir?: string;
}

// Plugin to move source maps to a flat destination directory
function moveSourcemapsPlugin(options: MoveSourcemapsOptions = {}): Plugin {
    const targetDir = options.targetDir || 'sourcemaps';

    return {
        name: 'move-sourcemaps',
        enforce: 'post',

        writeBundle(outputOptions, bundle) {
            // Get the full target directory path
            const fullTargetDir = path.resolve(targetDir);

            // Return early if target directory doesn't exist
            if (!fs.existsSync(fullTargetDir)) {
                console.warn(`Target directory ${fullTargetDir} does not exist. Skipping source map movement.`);
                return;
            }

            // Clear the target directory first
            try {
                const existingFiles = fs.readdirSync(fullTargetDir);
                for (const file of existingFiles) {
                    const filePath = path.join(fullTargetDir, file);
                    // Check if it's a file (not a directory)
                    if (fs.statSync(filePath).isFile()) {
                        fs.unlinkSync(filePath);
                    }
                }
            } catch (err) {
                console.error(`Failed to clear directory ${fullTargetDir}:`, err);
                return; // Return early if clearing fails
            }

            // Get the output directory
            const outDir = outputOptions.dir || 'dist';

            // Check if output directory exists
            if (!fs.existsSync(outDir)) {
                console.warn(`Output directory ${outDir} does not exist. No source maps to copy.`);
                return; // Return early if output directory doesn't exist
            }

            // Move each map file
            let movedCount = 0;
            Object.keys(bundle).forEach((fileName) => {
                if (fileName.endsWith('.map')) {
                    const sourcemapPath = path.join(outDir, fileName);

                    // Skip if source map doesn't exist
                    if (!fs.existsSync(sourcemapPath)) {
                        console.warn(`Source map file ${sourcemapPath} not found, skipping.`);
                        return;
                    }

                    // Extract just the filename without the path
                    const baseFileName = path.basename(fileName);
                    const targetPath = path.join(fullTargetDir, baseFileName);

                    try {
                        // Copy the source map to the target directory
                        fs.copyFileSync(sourcemapPath, targetPath);
                        movedCount++;
                    } catch (err) {
                        console.error(`Failed to copy source map ${fileName}:`, err);
                    }
                }
            });

            if (movedCount > 0) {
                console.log(`Copied ${movedCount} source maps to ${fullTargetDir}`);
            } else {
                console.log(`No source maps were copied to ${fullTargetDir}`);
            }
        }
    };
}

export default mergeConfig(
    commonConfig,
    defineConfig({
        // Development-specific settings
        build: {
            minify: true,
            sourcemap: true,
        },
        plugins: [
            moveSourcemapsPlugin({
                targetDir: 'dist/sourceMaps' // Specify your target directory here
            })
        ],
        server: {
            port: 5173,
            fs: {
                // Allow serving files from one level up to include node_modules
                allow: ['..']
            },
            headers: {
                'Cross-Origin-Opener-Policy': 'same-site',
                'Cross-Origin-Embedder-Policy': 'require-corp'
            }
        }
    })
);