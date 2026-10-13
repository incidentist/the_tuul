import { expect, Page, test } from "@playwright/test";
import {
  defaultTestConfig,
  navigateToTab,
  playbackPosition,
  playbackSlider,
  regionLocator,
  savedSegments,
  scrollWaveformIntoView,
  setupTestEnvironment,
  TabId,
  uploadAudioFile,
  waveformPixelsPerSecond,
  zoomWaveformIn,
} from "./utils";

const TIMINGS_TEXT = {
  name: "timings.txt",
  mimeType: "text/plain",
  buffer: Buffer.from(
    [
      "Toul timings 1",
      "",
      'voice "Voice 1"',
      "",
      "-",
      '"ka "  00:01.00',
      '"den"  00:02.00  00:02.50',
      "-",
      "",
      "-",
      '"lu"   00:03.00  00:03.50',
      "-",
      "",
    ].join("\n"),
  ),
};

function scrollElement(page: Page) {
  return page.locator('.timing-adjustment-tab .wavesurfer-container [part~="scroll"]');
}

/**
 * The fraction of the song the main waveform is scrolled to, and the fraction it shows.
 */
async function viewFractions(page: Page): Promise<{ start: number; width: number }> {
  return scrollElement(page).evaluate((el) => ({
    start: el.scrollLeft / el.scrollWidth,
    width: el.clientWidth / el.scrollWidth,
  }));
}

test.describe("Adjust overview strip", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, defaultTestConfig.audioFile, defaultTestConfig.artist);
    await page
      .locator('[name="timings-file-upload"] input[type="file"]')
      .setInputFiles(TIMINGS_TEXT);
    await expect.poll(async () => (await savedSegments(page)).length).toBe(3);
    await navigateToTab(page, TabId.TimingAdjustment);
  });

  test("scrolls the zoomed waveform by its box, and seeks to where it is clicked", async ({
    page,
  }) => {
    await zoomWaveformIn(page, 12);
    // The strip replaces the transport's slider once the waveform is decoded.
    const strip = playbackSlider(page).locator("..");
    await expect(strip).toHaveClass(/overview-strip/);
    const box = (await strip.boundingBox())!;
    const before = await viewFractions(page);
    expect(before.width).toBeLessThan(0.5);
    const position = await playbackPosition(page);

    const grabX = box.x + (before.start + before.width / 2) * box.width;
    await page.mouse.move(grabX, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();

    await expect.poll(async () => (await viewFractions(page)).start).toBeGreaterThan(0.5);
    expect(await playbackPosition(page)).toBe(position);
    await expect(regionLocator(page, 2)).not.toBeInViewport();

    const duration = Number(await playbackSlider(page).getAttribute("max"));
    await page.mouse.click(box.x + (3.25 / duration) * box.width, box.y + box.height / 2);

    await expect.poll(() => playbackPosition(page)).toBeCloseTo(3.25, 0);
    await expect(regionLocator(page, 2)).toBeInViewport();
  });

  test("zooms the waveform when the wheel turns over it", async ({ page }) => {
    await scrollWaveformIntoView(page);
    const before = await waveformPixelsPerSecond(page);
    const box = (await playbackSlider(page).locator("..").boundingBox())!;

    await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2);
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);

    await expect.poll(() => waveformPixelsPerSecond(page)).toBeGreaterThan(before * 1.5);
  });
});
