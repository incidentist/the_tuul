import { test, expect } from '@playwright/test';
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  uploadTimingsFile,
  expectTabToBeDisabled,
  expectTabToBeEnabled
} from './utils';

test.describe('Timings File Upload', () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test('Submit tab becomes enabled after uploading timings file', async ({ page }) => {
    // 1. Navigate to Song Info tab and upload audio
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, defaultTestConfig.audioFile, defaultTestConfig.artist, defaultTestConfig.title);

    // 2. Navigate to Lyrics tab and enter lyrics
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, defaultTestConfig.lyricsFile);

    // 3. Verify Submit tab is initially disabled
    await expectTabToBeDisabled(page, TabId.Submit);

    // 4. Upload timings file through advanced options in the Song Timing tab
    await uploadTimingsFile(page, defaultTestConfig.timingsFile);

    // 5. Verify Submit tab is now enabled
    await expectTabToBeEnabled(page, TabId.Submit);

    // 6. Navigate to Submit tab and verify it's accessible
    await navigateToTab(page, TabId.Submit);
    await expect(page.locator('button:has-text("Create Video")')).toBeVisible();
  });
});
