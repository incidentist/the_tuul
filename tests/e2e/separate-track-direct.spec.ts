import { test } from '@playwright/test';
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  mockSeparateTrackApiDirect,
  setIncludeBackingVocals,
  expectTabToBeDisabled,
  expectTabToBeEnabled,
  loadAndEnterTimings,
  expectSuccessMessage,
  expectFileDownload
} from './utils';

test.describe('Separate Track Direct Response', () => {
  test.describe.configure({ timeout: 300000 }); // 5 minutes

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test('Create a complete karaoke track when separate_track returns ZIP directly', async ({ page, context }) => {
    // Setup API mock to return ZIP directly (simulating non-cached behavior)
    await mockSeparateTrackApiDirect(context);

    // Navigate to Song Info tab and upload audio
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, defaultTestConfig.audioFile, defaultTestConfig.artist, defaultTestConfig.title);
    // The server-side model keeps separation on the mocked API
    await setIncludeBackingVocals(page, false);

    // Wait for the separation to complete
    await page.waitForTimeout(2000); // Give some time for the API call to complete

    // Verify Song Timing tab is initially disabled
    await expectTabToBeDisabled(page, TabId.SongTiming);

    // Navigate to Lyrics tab and enter lyrics
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, defaultTestConfig.lyricsFile);

    // Go back to Song Info tab to refresh tab states
    await navigateToTab(page, TabId.SongInfo);

    // Verify Song Timing tab is now enabled
    await expectTabToBeEnabled(page, TabId.SongTiming);

    // Navigate to Song Timing tab
    await navigateToTab(page, TabId.SongTiming);

    // Verify Submit tab is initially disabled
    await expectTabToBeDisabled(page, TabId.Submit);

    // Load and enter timings from fixture file
    await loadAndEnterTimings(page, defaultTestConfig.timingsFile);

    // Verify success message
    await expectSuccessMessage(page, '.song-timing-tab');

    // Verify Submit tab is now enabled
    await expectTabToBeEnabled(page, TabId.Submit);

    // Navigate to Submit tab
    await navigateToTab(page, TabId.Submit);

    // Click Create Video
    await page.click('button:has-text("Create Video")');

    // Wait for video download and verify
    const VIDEO_CREATION_TIMEOUT = 180000; // 3 minutes
    const videoPath = await expectFileDownload(page, VIDEO_CREATION_TIMEOUT);
    console.log('Video download path:', videoPath);
  });
});