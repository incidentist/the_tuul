import { test, expect } from '@playwright/test';
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  loadAndEnterLyrics,
  mockSeparateTrackApi,
  setIncludeBackingVocals,
  expectTabToBeDisabled,
  expectTabToBeEnabled,
  loadAndEnterTimings,
  expectSuccessMessage,
  expectFileDownload,
  mockYouTubeDownloadApi,
  enterYouTubeUrl,
  getCurrentTimings,
  loadFixtureJson,
  expectTimingsToMatch
} from './utils';

test.describe('YouTube Karaoke Video Creation', () => {
  test.describe.configure({ timeout: 300000 }); // 5 minutes

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test('Create a complete karaoke video from YouTube URL', async ({ page, context }) => {
    // Setup API mocks first
    await mockSeparateTrackApi(context);
    await mockYouTubeDownloadApi(context);

    // 1. Navigate to Song Info tab
    await navigateToTab(page, TabId.SongInfo);

    // 2. Enter YouTube URL and load it
    await enterYouTubeUrl(
      page,
      'https://www.youtube.com/watch?v=gVw-wI1GeqI',
      'Beastie Boys - Topic',
      'Now Get Busy'
    );
    // The server-side model keeps separation on the mocked API
    await setIncludeBackingVocals(page, false);

    // 3. Verify Song Timing tab is initially disabled
    await expectTabToBeDisabled(page, TabId.SongTiming);

    // 4. Navigate to Lyrics tab and enter lyrics
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, defaultTestConfig.lyricsFile);

    // Go back to Song Info tab to refresh tab states
    await navigateToTab(page, TabId.SongInfo);

    // 5. Verify Song Timing tab is now enabled
    await expectTabToBeEnabled(page, TabId.SongTiming);

    // 6. Navigate to Song Timing tab
    await navigateToTab(page, TabId.SongTiming);

    // 7. Verify Submit tab is initially disabled
    await expectTabToBeDisabled(page, TabId.Submit);

    // 8. Load and enter timings from fixture file
    await loadAndEnterTimings(page, defaultTestConfig.timingsFile);

    // 9. Verify success message
    await expectSuccessMessage(page, '.song-timing-tab');

    // 10. Verify Submit tab is now enabled
    await expectTabToBeEnabled(page, TabId.Submit);

    // 11. Get timings and compare with expected
    const actualTimings = await getCurrentTimings(page);

    // Load the expected timings from the fixture file
    const expectedTimings: any[] = await loadFixtureJson(defaultTestConfig.timingsFile);

    expectTimingsToMatch(actualTimings, expectedTimings);

    // 12. Navigate to Submit tab
    await navigateToTab(page, TabId.Submit);

    // 13. Click Create Video
    await page.click('button:has-text("Create Video")');

    // 14. Wait for video download and verify
    const VIDEO_CREATION_TIMEOUT = 180000; // 3 minutes
    const videoPath = await expectFileDownload(page, VIDEO_CREATION_TIMEOUT);
    console.log('Video download path:', videoPath);
  });
});
