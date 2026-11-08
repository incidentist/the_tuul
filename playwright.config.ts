// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  /* Maximum time one test can run for */
  timeout: 20000,
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* The ffmpeg WASM specs are heavy enough that more concurrent browsers get one killed at launch. */
  workers: 2,
  /* Reporter to use */
  reporter: [["html", { host: "0.0.0.0", port: 9323 }]],
  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: process.env.BASE_URL || "http://localhost:8000",
    /* Collect trace when retrying the failed test */
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    /* Viewport size optimized for the app */
    viewport: { width: 1280, height: 720 },
  },

  /* Configure projects for different browsers */
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Without this, phone specs keep the device's 1920px screen, which isMobile() reads.
        screen: undefined,
        /* Clipboard permissions are Chromium-only; Firefox relies on
                   the in-memory clipboard stub from setupHelpers. */
        permissions: ["clipboard-read", "clipboard-write"],
      },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      /* Firefox handles media element sources differently from Chromium
               (e.g. it aborts in-flight fetches of revoked object URLs), so
               run the audio playback specs there too. The rest of the suite
               is Chromium-only. */
      testMatch: /preview-track-switching\.spec\.ts/,
    },
  ],

  /* Run local dev server before starting the tests */
  webServer: {
    command: "make dev",
    url: process.env.BASE_URL || "http://localhost:8000",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
