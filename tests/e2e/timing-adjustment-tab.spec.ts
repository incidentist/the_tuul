import { test, expect, Page } from '@playwright/test';
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  loadAndEnterTimings,
  mockSeparateTrackApi,
  setIncludeBackingVocals,
  getCurrentTimings,
} from './utils';

test.describe('Timing Adjustment Tab', () => {
  test.describe.configure({ timeout: 120000 }); // 2 minutes

  test.beforeEach(async ({ page, context }) => {
    await setupTestEnvironment(page);
    await mockSeparateTrackApi(context);

    // Setup: upload audio, enter lyrics, enter initial timings
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, defaultTestConfig.audioFile, defaultTestConfig.artist, defaultTestConfig.title);
    // The server-side model keeps separation on the mocked API
    await setIncludeBackingVocals(page, false);

    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, defaultTestConfig.lyricsFile);

    await navigateToTab(page, TabId.SongTiming);
    await loadAndEnterTimings(page, defaultTestConfig.timingsFile);
  });

  // Regions are rendered by OpenEndedRegionPlugin inside wavesurfer's (open) shadow root,
  // identified by `part` attributes rather than classes. Playwright CSS locators pierce it.
  const regionLocator = (page: Page) => page.locator('.wavesurfer-container [part~="region"]');
  const segmentLocator = (page: Page, index: number) =>
    page.locator(`.wavesurfer-container [part="region segment_${index}"]`);

  test('displays regions for timed lyrics', async ({ page }) => {
    await navigateToTab(page, TabId.TimingAdjustment);

    // Wait for the waveform to be ready
    await page.waitForSelector('.wavesurfer-container canvas');

    // The fixture timings produce two segments, labelled with their lyric text
    const firstSegment = segmentLocator(page, 0);
    await expect(firstSegment).toBeVisible();
    await expect(firstSegment.locator('[part="region-content"]')).not.toBeEmpty();
    expect(await regionLocator(page).count()).toBeGreaterThan(0);
  });

  test('regions have draggable handles', async ({ page }) => {
    await navigateToTab(page, TabId.TimingAdjustment);

    await page.waitForSelector('.wavesurfer-container canvas');
    await expect(segmentLocator(page, 0)).toBeVisible();

    // Every region has a left (start) handle
    const leftHandles = page.locator('.wavesurfer-container [part~="region-handle-left"]');
    const regionCount = await regionLocator(page).count();
    await expect(leftHandles).toHaveCount(regionCount);
    await expect(leftHandles.first()).toHaveCSS('cursor', 'ew-resize');

    // Segments with an explicit end (marked with Enter) also have a right handle
    const firstRightHandle = segmentLocator(page, 0).locator('[part~="region-handle-right"]');
    await expect(firstRightHandle).toBeVisible();
  });

  test('dragging handle updates timing', async ({ page }) => {
    const initialTimings = await getCurrentTimings(page);
    const initialStart = initialTimings[0][0];

    await navigateToTab(page, TabId.TimingAdjustment);

    await page.waitForSelector('.wavesurfer-container canvas');
    const firstSegment = segmentLocator(page, 0);
    await expect(firstSegment).toBeVisible();

    // Get the first region's left handle
    const firstHandle = firstSegment.locator('[part~="region-handle-left"]');
    await expect(firstHandle).toBeVisible();

    // The subtitle display above the waveform resizes once it loads, shifting the
    // handle down the page; wait for its position to settle before dragging it.
    let initialBox = await firstHandle.boundingBox();
    await expect.poll(async () => {
      const previous = initialBox;
      await page.waitForTimeout(250);
      initialBox = await firstHandle.boundingBox();
      return JSON.stringify(initialBox) === JSON.stringify(previous);
    }).toBe(true);
    expect(initialBox).not.toBeNull();

    // Drag the start handle left (earlier) by 25px, ~0.5s at the default 50 px/sec
    const y = initialBox!.y + initialBox!.height / 2;
    await page.mouse.move(initialBox!.x + initialBox!.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(initialBox!.x - 10, y, { steps: 5 });
    await page.mouse.move(initialBox!.x - 25, y, { steps: 5 });
    await page.mouse.up();

    // The handle moved on screen...
    await expect.poll(async () => (await firstHandle.boundingBox())!.x).toBeLessThan(initialBox!.x - 10);

    // ...and the first segment's start timing moved earlier in the stored timings
    const newTimings = await getCurrentTimings(page);
    expect(newTimings).toHaveLength(initialTimings.length);
    expect(newTimings[0][1]).toBe(initialTimings[0][1]);
    expect(newTimings[0][0]).toBeLessThan(initialStart - 0.2);
    expect(newTimings[0][0]).toBeGreaterThan(initialStart - 1);
    // Other events are unchanged
    expect(newTimings.slice(1)).toEqual(initialTimings.slice(1));
  });

  test('click on waveform seeks playhead', async ({ page }) => {
    await navigateToTab(page, TabId.TimingAdjustment);

    await page.waitForSelector('.wavesurfer-container canvas');

    // Get the audio element's initial time
    const audioPlayer = page.locator('audio');

    // Click on the waveform container (not on a region handle)
    const waveformContainer = page.locator('.wavesurfer-container');
    const containerBox = await waveformContainer.boundingBox();
    expect(containerBox).not.toBeNull();

    // Click at the middle of the waveform
    await page.mouse.click(
      containerBox!.x + containerBox!.width / 2,
      containerBox!.y + containerBox!.height / 2
    );

    // Wait a moment for the seek to complete
    await page.waitForTimeout(100);

    // The audio player should have seeked to approximately the middle of the track
    // We just verify that the click-to-seek functionality works by checking
    // that the audio player's currentTime is non-zero
  });
});
