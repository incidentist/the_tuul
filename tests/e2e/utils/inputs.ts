/**
 * Input helpers for Playwright tests
 */
import { Locator, Page, expect } from "@playwright/test";
import { getFixturePath, loadFixtureFile } from "./setupHelpers";
import { TabId, navigateToTab } from "./navigation";

/**
 * Uploads an audio file and waits for metadata to be loaded
 */
export async function uploadAudioFile(
  page: Page,
  filename: string,
  expectArtist?: string,
  expectTitle?: string,
): Promise<void> {
  const audioFilePath = getFixturePath(filename);
  const audioFileInput = page.locator('[name="song-file-upload"] [type="file"]');

  await audioFileInput.setInputFiles(audioFilePath);

  // If we expect specific metadata, wait for it to be loaded
  if (expectArtist) {
    await expect(page.locator('[name="artist"]')).toHaveValue(expectArtist);
  }

  if (expectTitle) {
    await expect(page.locator('[name="title"]')).toHaveValue(expectTitle);
  }
}

/**
 * Enters a YouTube URL and clicks the Load button
 */
export async function enterYouTubeUrl(
  page: Page,
  url: string,
  expectArtist?: string,
  expectTitle?: string,
): Promise<void> {
  // Enter YouTube URL
  await page.fill('input[type="text"]', url);

  // Click the Load button
  await page.click('button:has-text("Load")');

  // Wait for loading to complete - button should no longer be in loading state
  await page.waitForSelector('button:has-text("Load"):not(.is-loading)');

  // Check for error message
  const errorMessage = await page.locator(".field.is-danger .message").isVisible();
  if (errorMessage) {
    throw new Error(
      "YouTube URL loading failed: " +
        (await page.locator(".field.is-danger .message").textContent()),
    );
  }

  // If we expect specific metadata, wait for it to be loaded
  if (expectArtist) {
    await expect(page.locator('[name="artist"]')).toHaveValue(expectArtist);
  }

  if (expectTitle) {
    await expect(page.locator('[name="title"]')).toHaveValue(expectTitle);
  }
}

/**
 * The lyrics editor on the Lyrics tab
 */
export function lyricsEditor(page: Page): Locator {
  return page.getByRole("textbox", { name: "Lyrics" });
}

/**
 * The text in the lyrics editor, read from the lines it renders
 */
export async function lyricsText(page: Page): Promise<string> {
  return lyricsEditor(page).evaluate((content) =>
    Array.from(content.querySelectorAll(".cm-line"), (line) => line.textContent).join("\n"),
  );
}

/**
 * Waits for the lyrics editor to hold exactly `text`
 */
export async function expectLyricsText(page: Page, text: string): Promise<void> {
  await expect.poll(() => lyricsText(page)).toBe(text);
}

/**
 * Loads lyrics from a fixture file or string and enters them in the lyrics editor
 */
export async function loadAndEnterLyrics(
  page: Page,
  lyricsContentOrFilename: string,
): Promise<void> {
  // Determine if this is a file path or direct content
  let lyricsContent = lyricsContentOrFilename;
  try {
    // Attempt to load as a file if it appears to be a file path
    if (lyricsContentOrFilename.includes(".") && !lyricsContentOrFilename.includes("\n")) {
      lyricsContent = await loadFixtureFile(lyricsContentOrFilename);
    }
  } catch (error) {
    // If loading fails, assume the input is direct content
    console.log("Input treated as direct lyrics content");
  }

  // Enter the lyrics content into the editor
  const editor = lyricsEditor(page);
  await editor.clear();
  await editor.pressSequentially(lyricsContent);
}

/**
 * Uploads a timings file through the restore box on the Files tab
 */
export async function uploadTimingsFile(page: Page, timingsFilename: string): Promise<void> {
  // Navigate to song info tab if not already there
  if (!(await page.locator(".song-info-tab").isVisible())) {
    await navigateToTab(page, TabId.SongInfo);
  }

  // Upload the timings file
  const timingsFilePath = getFixturePath(timingsFilename);
  const timingsFileInput = page.locator('[name="timings-file-upload"] input[type="file"]');

  await timingsFileInput.setInputFiles(timingsFilePath);
}

/**
 * Sets up the basic inputs required for most tests:
 * 1. Navigates to Song Info tab
 * 2. Uploads audio file
 * 3. Navigates to Lyrics tab
 * 4. Enters lyrics
 */
export async function setupBasicInputs(
  page: Page,
  audioFilename: string,
  lyricsFilename: string,
  expectArtist?: string,
  expectTitle?: string,
): Promise<void> {
  // Navigate to Song Info tab
  await navigateToTab(page, TabId.SongInfo);

  // Upload audio file
  await uploadAudioFile(page, audioFilename, expectArtist, expectTitle);

  // Navigate to Lyrics tab
  await navigateToTab(page, TabId.LyricInput);

  // Enter lyrics
  await loadAndEnterLyrics(page, lyricsFilename);
}

/**
 * Adds underscores to lyrics (clicks the "Add Underscores" button)
 */
export async function addUnderscoresToLyrics(page: Page): Promise<void> {
  if (!(await page.locator(".lyric-input-tab").isVisible())) {
    await navigateToTab(page, TabId.LyricInput);
  }

  await page.click("button:has-text('Add Underscores')");
}

/**
 * Toggles the "Magic Slashes" checkbox
 */
export async function toggleMagicSlashes(page: Page, enable: boolean): Promise<void> {
  if (!(await page.locator(".lyric-input-tab").isVisible())) {
    await navigateToTab(page, TabId.LyricInput);
  }

  // Buefy hides the input under its label.
  await magicSlashesCheckbox(page).setChecked(enable, { force: true });
}

export function magicSlashesCheckbox(page: Page) {
  return page.getByRole("checkbox", { name: "Magic Slashes", exact: true });
}

/**
 * The Submit tab's options live in horizontal fields labelled with the option name. The
 * labels also carry a tooltip, so match on the name as a substring.
 */
export function fieldFor(page: Page, label: string) {
  return page.locator(".field.is-horizontal", { hasText: label });
}

/**
 * The same, for a label a substring match would over-match: "Font" is also inside "Custom
 * Font" and "Fonts and Colors".
 */
export function exactFieldFor(page: Page, label: string) {
  return page.locator(`.settings-column .field:has(label:text-is("${label}"))`);
}

/**
 * The switch inside one of those fields.
 */
export function switchFor(page: Page, label: string) {
  return fieldFor(page, label).locator('input[type="checkbox"]');
}

/**
 * One radio of a radio group inside one of those fields, by its value.
 */
export function radioFor(page: Page, label: string, value: string) {
  return fieldFor(page, label).locator(`input[type="radio"][value="${value}"]`);
}
