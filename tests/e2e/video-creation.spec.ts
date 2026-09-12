import { test, expect } from '@playwright/test';
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  mockSeparateTrackApi,
  setIncludeBackingVocals,
  expectTabToBeDisabled,
  expectTabToBeEnabled,
  loadAndEnterTimings,
  expectSuccessMessage,
  expectFileDownload
} from './utils';

test.describe('Karaoke Track Creation', () => {
  test.describe.configure({ timeout: 300000 }); // 5 minutes

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test('Create a complete karaoke track', async ({ page, context }) => {
    // Setup API mock
    await mockSeparateTrackApi(context);

    // 1. Navigate to Song Info tab and upload audio
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, defaultTestConfig.audioFile, defaultTestConfig.artist, defaultTestConfig.title);
    // The server-side model keeps separation on the mocked API
    await setIncludeBackingVocals(page, false);

    // 2. Verify Song Timing tab is initially disabled
    await expectTabToBeDisabled(page, TabId.SongTiming);

    // 3. Navigate to Lyrics tab and enter lyrics
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, defaultTestConfig.lyricsFile);

    // Take screenshot
    await page.screenshot({ path: 'lyrics.png' });

    // Go back to Song Info tab to refresh tab states
    await navigateToTab(page, TabId.SongInfo);

    // 4. Verify Song Timing tab is now enabled
    await expectTabToBeEnabled(page, TabId.SongTiming);

    // 5. Navigate to Song Timing tab
    await navigateToTab(page, TabId.SongTiming);

    // 6. Verify Submit tab is initially disabled
    await expectTabToBeDisabled(page, TabId.Submit);

    // 7. Load and enter timings from fixture file
    await loadAndEnterTimings(page, defaultTestConfig.timingsFile);

    // 8. Verify success message
    await expectSuccessMessage(page, '.song-timing-tab');

    // 9. Verify Submit tab is now enabled
    await expectTabToBeEnabled(page, TabId.Submit);

    // 10. Navigate to Submit tab
    await navigateToTab(page, TabId.Submit);

    // 11. Click Create Video
    await page.click('button:has-text("Create Video")');

    // 12. Wait for video download and verify
    const VIDEO_CREATION_TIMEOUT = 180000; // 3 minutes
    const videoPath = await expectFileDownload(page, VIDEO_CREATION_TIMEOUT);
    console.log('Video download path:', videoPath);
  });
});
