import { test, expect } from "@playwright/test";
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  uploadTimingsFile,
  expectVideoCreationToBeDisabled,
  expectVideoCreationToBeEnabled,
  getFixturePath,
} from "./utils";

test.describe("Timings File Upload", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("Create Video becomes available after uploading timings file", async ({ page }) => {
    // 1. Navigate to Song Info tab and upload audio
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.artist,
      defaultTestConfig.title,
    );

    // 2. Navigate to Lyrics tab and enter lyrics
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, defaultTestConfig.lyricsFile);

    // 3. Verify the Submit tab is reachable but video creation is not yet available
    await navigateToTab(page, TabId.Submit);
    await expectVideoCreationToBeDisabled(page);

    // 4. Upload timings file through the restore box in the Song Info tab
    await navigateToTab(page, TabId.SongInfo);
    await uploadTimingsFile(page, defaultTestConfig.timingsFile);

    // 5. Navigate to Submit tab and verify video creation is now available
    await navigateToTab(page, TabId.Submit);
    await expect(page.locator('button:has-text("Create Video")')).toBeVisible();
    await expectVideoCreationToBeEnabled(page);
  });
});

test.describe("Telling timings and lyrics files apart", () => {
  const LYRICS_INPUT = '[name="lyrics-file-upload"] input[type="file"]';
  const TIMINGS_INPUT = '[name="timings-file-upload"] input[type="file"]';
  const text = (name: string, rows: string[]) => ({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(rows.join("\n") + "\n"),
  });

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
    await navigateToTab(page, TabId.SongInfo);
  });

  test("loads a timings.txt and lists what it changed under the input", async ({ page }) => {
    await page
      .locator(TIMINGS_INPUT)
      .setInputFiles(
        text("timings.txt", [
          "Toul timings 1",
          "",
          "page",
          "",
          "-",
          '"Went "  00:01.00',
          "-",
          "",
          "00:02.00",
          "00:03.00",
        ]),
      );

    await expect(page.locator('[name="timings-file-upload"] .file-name')).toHaveText("timings.txt");
    await expect(page.locator(".existing-files .import-warnings")).toContainText(
      "A blank spacer line's display times were dropped",
    );
  });

  test("keeps the lyrics when a timings.txt also holds voices they don't name", async ({
    page,
  }) => {
    await page
      .locator(LYRICS_INPUT)
      .setInputFiles(text("lyrics.txt", ["[Anna]", "Went", "[Ben]", "Back"]));
    await expect(page.locator('[name="lyrics-file-upload"] .file-name')).toHaveText("lyrics.txt");

    await page
      .locator(TIMINGS_INPUT)
      .setInputFiles(
        text("timings.txt", [
          "Toul timings 3",
          'voice "Anna"',
          "-",
          '"Went"  00:01.00',
          "-",
          'voice "Ben"',
          "-",
          '"Back"  00:02.00',
          "-",
          'voice "Left over"',
          "-",
          '"Went"  00:05.00',
          "-",
          "-",
          '"Back"  00:02.00',
          "-",
        ]),
      );

    await expect(page.locator('[name="timings-file-upload"] .file-name')).toHaveText("timings.txt");
    await expect(page.locator(".existing-files .import-warnings")).toHaveText(
      /A voice not named in the lyrics was left out/,
    );
    await expect(page.locator('[name="lyrics-file-upload"] .file-name')).toHaveText("lyrics.txt");
  });

  test("loads a timings.txt whose times go backwards, and lists that under the input", async ({
    page,
  }) => {
    await page
      .locator(TIMINGS_INPUT)
      .setInputFiles(
        text("timings.txt", [
          "Toul timings 3",
          "-",
          '"Went"  00:05.00',
          "-",
          "-",
          '"Back"  00:02.00',
          "-",
        ]),
      );

    await expect(page.locator('[name="timings-file-upload"] .file-name')).toHaveText("timings.txt");
    await expect(page.locator(".existing-files .import-warnings")).toContainText(
      "A line's times go backwards",
    );
  });

  test("refuses a timings file in the lyrics input", async ({ page }) => {
    await page.locator(LYRICS_INPUT).setInputFiles(text("timings.txt", ["Toul timings 1"]));

    await expect(page.locator('.toast:has-text("this is a timings file")')).toBeVisible();
    await expect(page.locator('[name="lyrics-file-upload"] .file-name')).toHaveText(
      "No file chosen",
    );
  });

  test("refuses a lyrics file in the timings input", async ({ page }) => {
    await page.locator(TIMINGS_INPUT).setInputFiles(getFixturePath("lyrics.txt"));

    await expect(page.locator('.toast:has-text("it may be a lyrics file")')).toBeVisible();
    await expect(page.locator('[name="timings-file-upload"] .file-name')).toHaveText(
      "No file chosen",
    );
  });
});
