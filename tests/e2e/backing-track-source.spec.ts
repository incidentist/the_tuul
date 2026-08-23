import { test, expect } from '@playwright/test';
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadBackingTrackFile,
} from './utils';

test.describe('Backing Track Source', () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test('uploading a backing track skips separation and advances to Lyrics', async ({ page }) => {
    await navigateToTab(page, TabId.SongInfo);

    // No separation request should fire for an already-instrumental upload.
    let separationRequested = false;
    page.on('request', (request) => {
      if (request.url().includes('separate_track')) {
        separationRequested = true;
      }
    });

    await uploadBackingTrackFile(page, defaultTestConfig.audioFile);

    await page.fill('[name="title"]', defaultTestConfig.title);
    await page.fill('[name="artist"]', defaultTestConfig.artist);

    await page.click('button:has-text("Continue")');

    // The CTA should have navigated us to the Lyrics tab.
    await expect(page.locator('h2:has-text("Song Lyrics")')).toBeVisible();

    expect(separationRequested).toBe(false);
  });
});
