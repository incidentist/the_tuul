import { test, expect, Page } from "@playwright/test";
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  uploadTimingsFile,
  clickRegion,
  scrollWaveformIntoView,
  regionLocator,
  savedSegments,
  pressAtSongTime,
  playbackPosition,
  waitForPlayback,
} from "./utils";

// One segment per line, each starting on an odd second and ending a second later.
const SIX_LINES = "One\nTwo\nThree\nFour\nFive\nSix";
const SIX_LINES_TIMINGS = "timings-adjust-six-lines.json";

// A tap lands this far after the song time it waits for, from key and event latency.
const TAP_TOLERANCE = 0.15;

async function openTimingTab(page: Page) {
  await navigateToTab(page, TabId.SongInfo);
  await uploadAudioFile(
    page,
    defaultTestConfig.audioFile,
    defaultTestConfig.artist,
    defaultTestConfig.title,
  );
  await navigateToTab(page, TabId.LyricInput);
  await loadAndEnterLyrics(page, SIX_LINES);
  await uploadTimingsFile(page, SIX_LINES_TIMINGS);
  await navigateToTab(page, TabId.TimingAdjustment);
}

function transportButton(page: Page, name: "Play" | "Pause") {
  return page
    .locator(".timing-adjustment-tab")
    .getByRole("group", { name: "Playback" })
    .getByRole("button", { name, exact: true });
}

/**
 * Starts a Tap pass on Three, sung from 5 s to 6 s, and taps its start.
 */
async function tapThreeStart(page: Page) {
  await page.getByRole("button", { name: "Tap", exact: true }).click();
  await scrollWaveformIntoView(page);
  await expect(regionLocator(page, 2)).toBeVisible();
  await clickRegion(page, 2);
  await page.keyboard.press("Space");
  await pressAtSongTime(page, 5.4, "Space");
}

async function expectThreeTappedAt(page: Page, time: number) {
  await expect.poll(async () => (await savedSegments(page))[2].start).not.toBe(5);
  const { start } = (await savedSegments(page))[2];
  expect(start).toBeGreaterThanOrEqual(time);
  expect(start).toBeLessThan(time + TAP_TOLERANCE);
}

test.describe("Timing tab playback", () => {
  test.describe.configure({ timeout: 60000 });

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("plays a clicked rectangle to its end, then goes back to the preroll", async ({ page }) => {
    await openTimingTab(page);
    await scrollWaveformIntoView(page);

    // Two is sung from 3 s to 4 s, and Adjust mode's preroll is a second.
    await clickRegion(page, 1);
    await expect(transportButton(page, "Pause")).toBeVisible();
    await waitForPlayback(page, 3.5);
    await expect(transportButton(page, "Play")).toBeVisible({ timeout: 3000 });
    await expect.poll(() => playbackPosition(page)).toBeCloseTo(2, 3);
  });

  // GNOME takes the focus away for as long as a volume key is held.
  test("plays on when the window loses focus", async ({ page }) => {
    await openTimingTab(page);
    await tapThreeStart(page);

    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await waitForPlayback(page, 5.8);

    await expect(transportButton(page, "Pause")).toBeVisible();
  });

  test("pauses when the page is hidden, keeping the Tap pass", async ({ page }) => {
    await openTimingTab(page);
    await tapThreeStart(page);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await expect(transportButton(page, "Play")).toBeVisible();
    await expectThreeTappedAt(page, 5.4);
  });
});

test.describe("Media keys", () => {
  test.beforeEach(async ({ page }) => {
    // A test can't press a media key, so it calls the handlers the app gives the browser.
    await page.addInitScript(() => {
      const handlers: Record<string, () => void> = {};
      Object.assign(window, { mediaKeyHandlers: handlers });
      const session = navigator.mediaSession;
      const setActionHandler = session.setActionHandler.bind(session);
      session.setActionHandler = (action, handler) => {
        if (handler) handlers[action] = handler as () => void;
        setActionHandler(action, handler);
      };
    });
    await setupTestEnvironment(page);
  });

  function pressMediaKey(page: Page, action: "play" | "pause") {
    return page.evaluate(
      (key) =>
        (window as unknown as { mediaKeyHandlers: Record<string, () => void> }).mediaKeyHandlers[
          key
        ](),
      action,
    );
  }

  async function lyricsPlayerPaused(page: Page) {
    // The button is hidden along with its tab, which a role query leaves out.
    const button = page.locator(".song-player .transport-play");
    return (await button.getAttribute("aria-label")) === "Play";
  }

  test("reach the Lyrics tab's player only while its tab is shown", async ({ page }) => {
    await openTimingTab(page);
    await navigateToTab(page, TabId.LyricInput);
    const playPause = page.locator(".song-player").getByRole("button", { name: "Play" });
    await playPause.click();
    await expect.poll(() => lyricsPlayerPaused(page)).toBe(false);

    await pressMediaKey(page, "pause");
    await expect.poll(() => lyricsPlayerPaused(page)).toBe(true);

    await navigateToTab(page, TabId.TimingAdjustment);
    await pressMediaKey(page, "play");
    // Give a wrongly started player the time to start.
    await page.waitForTimeout(500);
    expect(await lyricsPlayerPaused(page)).toBe(true);
  });
});
