import { test, expect, Page } from '@playwright/test';
import {
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  enterTimings,
  mockSeparateTrackApi,
  setIncludeBackingVocals,
} from './utils';

// A song file with no metadata tags (e.g. a WAV) used to leave the song
// duration unset, so the subtitles came out empty and the preview stayed black.
test.describe('Untagged audio file', () => {
  test.describe.configure({ timeout: 120000 });

  test('previews subtitles for a WAV with no metadata', async ({ page, context }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await setupTestEnvironment(page);
    await mockSeparateTrackApi(context);

    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, 'no_metadata.wav');
    // The server-side model keeps separation on the mocked API
    await setIncludeBackingVocals(page, false);
    // Nothing to read from the file, so the title and artist stay blank
    await expect(page.locator('[name="artist"]')).toHaveValue('');
    await expect(page.locator('[name="title"]')).toHaveValue('');

    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, 'lyrics.txt');

    // The fixture is only 3 seconds long
    await navigateToTab(page, TabId.SongTiming);
    await enterTimings(page, [
      { time: 0.3, type: 1 },
      { time: 1.0, type: 2 },
      { time: 1.3, type: 1 },
      { time: 2.5, type: 2 },
    ]);

    // The Adjust tab now renders a preview as well, so scope to the Submit tab
    await navigateToTab(page, TabId.Submit);
    const submitTab = page.getByRole('tabpanel', { name: 'Submit' });
    await expect(submitTab.locator('.subtitle-canvas')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.click('a[title="download subtitles"]');
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let subtitles = '';
    for await (const chunk of stream) {
      subtitles += chunk;
    }
    expect(subtitles).toContain('Dialogue:');
    expect(subtitles).toContain('real thing');

    // Seek the preview to where the first lyrics screen is up (after the
    // 4-second title screen) and check that something is drawn
    const audio = submitTab.locator('audio');

    // The preview audio should be the delay followed by the 3-second song,
    // with no trailing silence
    await expect(audio).toHaveAttribute('src', /^blob:/);
    const { duration, songStart } = await audio.evaluate(async (el: HTMLAudioElement) => {
      const data = await (await fetch(el.src)).arrayBuffer();
      const context = new AudioContext();
      const buffer = await context.decodeAudioData(data);
      await context.close();
      const samples = buffer.getChannelData(0);
      const firstSound = samples.findIndex((s) => Math.abs(s) > 0.01);
      return { duration: buffer.duration, songStart: firstSound / buffer.sampleRate };
    });
    expect(songStart).toBeGreaterThan(0);
    expect(duration - songStart).toBeCloseTo(3, 1);

    await audio.evaluate((el: HTMLAudioElement) => {
      el.currentTime = 6;
      el.dispatchEvent(new Event('timeupdate'));
    });
    const preview = submitTab.locator('.video-container');
    await expect.poll(async () => countLitPixels(page, await preview.screenshot()), {
      message: 'lyrics should be drawn on the preview canvas',
    }).toBeGreaterThan(100);

    expect(consoleErrors.filter((e) => /isBrotliFile|indexOf/.test(e))).toEqual([]);
  });
});

// Counts the non-black pixels in a PNG screenshot, decoding it in the browser
async function countLitPixels(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] > 150) lit++;
    }
    return lit;
  }, png.toString('base64'));
}
