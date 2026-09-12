import { test, expect } from '@playwright/test';
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  mockLocalSeparationModel,
  setIncludeBackingVocals,
  expectTabToBeEnabled,
  loadAndEnterTimings,
  expectSuccessMessage,
  expectFileDownload
} from './utils';

// The "Include Backing Vocals" model (UVR_MDXNET_KARA_2) runs in the browser
// via web-audio-separation. The model download is mocked with a tiny
// pass-through ONNX graph; everything else (decode, STFT, ONNX Runtime Web,
// WAV encoding) is real.
test.describe('In-browser track separation', () => {
  test.describe.configure({ timeout: 300000 }); // 5 minutes

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test('Separates the track locally and builds a video without calling the server', async ({ page, context }) => {
    const modelDownloads = await mockLocalSeparationModel(context);

    const serverSeparationRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/separate_track')) {
        serverSeparationRequests.push(request.url());
      }
    });

    // 1. Upload audio and make sure the in-browser model is selected
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, defaultTestConfig.audioFile, defaultTestConfig.artist, defaultTestConfig.title);
    await setIncludeBackingVocals(page, true);

    // 2. Kick off separation from the Song Info tab
    await page.click('button:has-text("Separate Track")');
    const separatingIndicator = page.locator('.song-info-tab-header .loader');
    await expect(separatingIndicator).toBeVisible();

    // 3. Keep working on lyrics while it runs
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, defaultTestConfig.lyricsFile);

    // 4. Wait for separation to finish (model download is mocked, inference is real)
    await expect(separatingIndicator).toBeHidden({ timeout: 240000 });
    expect(serverSeparationRequests).toEqual([]);
    // The model came from the fixture, not from a real 30MB download
    expect(modelDownloads.servedUrls).toHaveLength(1);

    // 5. Time the song and build the video from the locally separated backing track
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
    expect(serverSeparationRequests).toEqual([]);
  });
});
