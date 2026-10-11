import { expect, test } from "@playwright/test";
import fs from "fs/promises";
import JSZip from "jszip";
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  mockSeparateTrackApi,
  expectTabToBeDisabled,
  expectTabToBeEnabled,
  expectVideoCreationToBeDisabled,
  expectVideoCreationToBeEnabled,
  loadAndEnterTimings,
  expectSuccessMessage,
  expectFileDownload,
  getFixturePath,
} from "./utils";

test.describe("Karaoke Track Creation", () => {
  test.describe.configure({ timeout: 300000 }); // 5 minutes

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("Create a complete karaoke track", async ({ page, context }) => {
    // Setup API mock
    await mockSeparateTrackApi(context);

    // 1. Navigate to Song Info tab and upload audio
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.artist,
      defaultTestConfig.title,
    );

    // 2. Verify Song Timing tab is initially disabled
    await expectTabToBeDisabled(page, TabId.SongTiming);

    // 3. Navigate to Lyrics tab and enter lyrics
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, defaultTestConfig.lyricsFile);

    // Go back to Song Info tab to refresh tab states
    await navigateToTab(page, TabId.SongInfo);

    // 4. Verify Song Timing tab is now enabled
    await expectTabToBeEnabled(page, TabId.SongTiming);

    // 5. Verify the Submit tab is reachable but video creation is not yet available
    await navigateToTab(page, TabId.Submit);
    await expectVideoCreationToBeDisabled(page);

    // 6. Navigate to Song Timing tab
    await navigateToTab(page, TabId.SongTiming);

    // 7. Load and enter timings from fixture file
    await loadAndEnterTimings(page, defaultTestConfig.timingsFile);

    // 8. Verify success message
    await expectSuccessMessage(page, ".song-timing-tab");

    // 9. Navigate to Submit tab and verify video creation is now available
    await navigateToTab(page, TabId.Submit);
    await expectVideoCreationToBeEnabled(page);

    // 10. Click Create Video
    await page.click('button:has-text("Create Video")');

    // 11. Wait for video download and verify
    const VIDEO_CREATION_TIMEOUT = 180000; // 3 minutes
    const videoPath = await expectFileDownload(page, VIDEO_CREATION_TIMEOUT);
    console.log("Video download path:", videoPath);
  });

  test("Create a karaoke video over a background image", async ({ page, context }) => {
    await mockSeparateTrackApi(context);
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.artist,
      defaultTestConfig.title,
    );
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, defaultTestConfig.lyricsFile);
    await navigateToTab(page, TabId.SongTiming);
    await loadAndEnterTimings(page, defaultTestConfig.timingsFile);
    await expectSuccessMessage(page, ".song-timing-tab");
    await navigateToTab(page, TabId.Submit);

    await page
      .locator('[name="background-upload"] [type="file"]')
      .setInputFiles(getFixturePath("background.png"));

    // A new background turns itself on, and the preview shows it.
    const useBackground = page.locator(".field", { hasText: "Use Background" }).locator("input");
    await expect(useBackground).toBeChecked();
    await expect(page.locator(".preview-column img.background")).toBeVisible();
    // The offset only moves a video.
    await expect(page.locator(".field", { hasText: "Video Offset" })).toHaveCount(0);

    await page.click('button:has-text("Create Video")');
    const zipPath = await expectFileDownload(page, 180000);

    const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
    expect(zip.file("background.png")).not.toBeNull();
    const titleFrame = await zip.file("title.png")!.async("uint8array");
    expect([...titleFrame.slice(1, 4)].map((byte) => String.fromCharCode(byte)).join("")).toBe(
      "PNG",
    );
    expect(await zip.file("settings.yaml")!.async("string")).toContain("useBackground: true");
  });

  test("Create a karaoke video with a hint note over the title screen", async ({
    page,
    context,
  }) => {
    await mockSeparateTrackApi(context);
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.artist,
      defaultTestConfig.title,
    );
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, defaultTestConfig.lyricsFile);
    await navigateToTab(page, TabId.SongTiming);
    await loadAndEnterTimings(page, defaultTestConfig.timingsFile);
    await expectSuccessMessage(page, ".song-timing-tab");
    await navigateToTab(page, TabId.Submit);

    await page.getByRole("button", { name: "Title Screen" }).click();
    const hintNote = page.getByRole("textbox", { name: "Hint note" });
    await hintNote.fill("A7");
    await expect(page.getByText("Type a note from A1 to G6")).toBeVisible();
    await hintNote.fill("A3");
    await expect(page.getByText("Type a note from A1 to G6")).toHaveCount(0);

    // The title screen is silent in the fixture song, so anything loud there is the tone.
    const previewPeak = () =>
      page.locator(".preview-container audio").evaluate(async (audio: HTMLAudioElement) => {
        const data = await (await fetch(audio.src)).arrayBuffer();
        const decoded = await new AudioContext().decodeAudioData(data);
        const samples = decoded.getChannelData(0);
        const middle = Math.round(1.5 * decoded.sampleRate);
        return Math.max(...samples.slice(middle, middle + decoded.sampleRate).map(Math.abs));
      });
    await expect.poll(previewPeak, { timeout: 30000 }).toBeGreaterThan(0.2);

    await page.click('button:has-text("Create Video")');
    const zipPath = await expectFileDownload(page, 180000);

    const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
    expect(await zip.file("settings.yaml")!.async("string")).toContain("hintNote: A3");
  });
});
