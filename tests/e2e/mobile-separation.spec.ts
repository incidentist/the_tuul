import { test, expect } from '@playwright/test';
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  mockLocalSeparationModel,
  mockSeparateTrackApiDirect,
  setIncludeBackingVocals,
  expectTabToBeEnabled,
  loadAndEnterTimings,
  expectSuccessMessage,
  expectFileDownload
} from './utils';

// Phones and tablets can't handle in-browser separation, so they always send
// the track to the API, even for a model that would run locally on desktop.
test.describe('Separation on mobile', () => {
  test.describe.configure({ timeout: 300000 }); // 5 minutes
  test.use({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
  });

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test('Separates the track on the server and builds a video', async ({ page, context }) => {
    await mockSeparateTrackApiDirect(context);
    const modelDownloads = await mockLocalSeparationModel(context);

    const serverSeparationRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/separate_track')) {
        serverSeparationRequests.push(request.url());
      }
    });

    // 1. Upload audio with the model that runs in the browser on desktop
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, defaultTestConfig.audioFile, defaultTestConfig.artist, defaultTestConfig.title);
    await setIncludeBackingVocals(page, true);

    // 2. Separate from the Song Info tab; it should go to the server
    await page.click('button:has-text("Separate Track")');
    const separatingIndicator = page.locator('.song-info-tab-header .loader');
    await expect(separatingIndicator).toBeHidden({ timeout: 30000 });
    expect(serverSeparationRequests).toHaveLength(1);
    expect(modelDownloads.servedUrls).toEqual([]);

    // 3. Lyrics, timings, and the video from the server's backing track
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, defaultTestConfig.lyricsFile);

    await navigateToTab(page, TabId.SongInfo);
    await expectTabToBeEnabled(page, TabId.SongTiming);
    await navigateToTab(page, TabId.SongTiming);
    await loadAndEnterTimings(page, defaultTestConfig.timingsFile);
    await expectSuccessMessage(page, '.song-timing-tab');

    await navigateToTab(page, TabId.Submit);
    await page.click('button:has-text("Create Video")');

    const VIDEO_CREATION_TIMEOUT = 180000; // 3 minutes
    const videoPath = await expectFileDownload(page, VIDEO_CREATION_TIMEOUT);
    console.log('Video download path:', videoPath);
    expect(modelDownloads.servedUrls).toEqual([]);
  });
});
