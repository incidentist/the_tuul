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
  togglePlayback,
  enterTimings,
  adjustTiming,
  expectTabToBeEnabled,
  getCurrentTimings,
  expectSegmentTimingsToBe,
  expectTimingsToMatch
} from './utils';

test.describe('Multi-screen Timing and Adjustment', () => {
  test.describe.configure({ timeout: 180000 }); // 3 minutes

  test.beforeEach(async ({ page, context }) => {
    await setupTestEnvironment(page);
    await mockSeparateTrackApi(context);
  });

  test.fixme('Adjust timing on first screen and continue with second screen. Region dragging events are being blocked somehow.', async ({ page }) => {
    // 1. Setup: Upload audio and enter a 2-screen lyrics text
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, defaultTestConfig.audioFile, defaultTestConfig.artist, defaultTestConfig.title);
    // The server-side model keeps separation on the mocked API
    await setIncludeBackingVocals(page, false);

    await navigateToTab(page, TabId.LyricInput);

    // Two-screen lyrics with clear separation
    const twoScreenLyrics =
      "First screen line 1\n" +
      "First screen line 2\n" +
      "\n" +  // This line marks the screen break
      "Second screen line 3\n" +
      "Second screen line 4";

    await loadAndEnterLyrics(page, twoScreenLyrics);

    // 2. Navigate to Timing tab and do timings for first screen only
    await navigateToTab(page, TabId.SongTiming);

    // Define timings for the first screen (4 lines = 8 events, start and end for each line)
    const firstScreenTimings = [
      { time: 1.0, type: 1 },  // Line 1 start
      { time: 2.0, type: 2 },  // Line 1 end
      { time: 3.0, type: 1 },  // Line 2 start
      { time: 4.0, type: 2 },  // Line 2 end
    ];

    // Enter timings for first screen
    await enterTimings(page, firstScreenTimings);

    // Stop playback after entering timings for first screen
    await togglePlayback(page);

    // 3. Navigate to Adjustment tab and adjust the first segment
    await navigateToTab(page, TabId.TimingAdjustment);
    await page.waitForTimeout(1000); // Wait for the adjustment tab to load

    // Adjust the timing of the first segment - move start time earlier by 0.5 seconds
    const firstSegmentIndex = 0;
    const startTimeAdjustment = -500; // Pixel adjustment that would correspond to ~0.5 seconds
    await adjustTiming(page, firstSegmentIndex, startTimeAdjustment, 0);

    // 4. Navigate back to Timing tab to do timings for second screen
    await navigateToTab(page, TabId.SongTiming);

    // Continue with timings for the second screen
    const secondScreenTimings = [
      { time: 6.0, type: 1 }, // Line 3 start
      { time: 7.0, type: 2 }, // Line 3 end
      { time: 8.0, type: 1 }, // Line 4 start
      { time: 9.0, type: 2 }, // Line 4 end
    ];

    // Enter timings for second screen
    await togglePlayback(page); // Start playback again
    await enterTimings(page, secondScreenTimings);

    // Verify success message is displayed
    await expect(page.locator('.song-timing-tab .message.is-success')).toBeVisible();

    // 5. Verify the Submit tab is now enabled after completing all timings
    await expectTabToBeEnabled(page, TabId.Submit);

    // 6. Get and verify the final timings
    const actualTimings = await getCurrentTimings(page);

    // Define expected timings - including the adjusted first segment
    const expectedTimings = [
      [0.5, 1],  // Line 1 start - adjusted from 1.0 to 0.5
      [2.0, 2],  // Line 1 end
      [3.0, 1],  // Line 2 start
      [4.0, 2],  // Line 2 end
      [10.0, 1], // Line 3 start
      [11.0, 2], // Line 3 end
      [12.0, 1], // Line 4 start
      [13.0, 2]  // Line 4 end
    ];

    // Check that timings match expected values
    await expectTimingsToMatch(actualTimings, expectedTimings, 0.1);

    // Also verify the first segment specifically
    await expectSegmentTimingsToBe(page, firstSegmentIndex, 0.5, 2.0, 0.1);
  });
});
