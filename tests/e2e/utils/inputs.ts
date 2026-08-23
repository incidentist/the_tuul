/**
 * Input helpers for Playwright tests
 */
import { Page, expect, Locator } from '@playwright/test';
import { getFixturePath, loadFixtureFile } from './setupHelpers';
import { TabId, navigateToTab } from './navigation';

/**
 * Source card ids on the Song Info tab
 */
export type SongSource = 'youtube' | 'upload' | 'backing';

/**
 * Selects a source card ("YouTube link", "Upload a song", "Upload a backing
 * track") on the Song Info tab, revealing that source's panel.
 */
export async function selectSource(page: Page, source: SongSource): Promise<void> {
  await page.check(`.source-card input[type="radio"][value="${source}"]`);
}

/**
 * Uploads an audio file and waits for metadata to be loaded
 */
export async function uploadAudioFile(page: Page, filename: string, expectArtist?: string, expectTitle?: string): Promise<void> {
  await selectSource(page, 'upload');

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
export async function enterYouTubeUrl(page: Page, url: string, expectArtist?: string, expectTitle?: string): Promise<void> {
  await selectSource(page, 'youtube');

  // Enter YouTube URL
  await page.fill('[name="youtube-url"]', url);

  // Click the Load button
  await page.click('button:has-text("Load")');

  // Wait for loading to complete - button should no longer be in loading state
  await page.waitForSelector('button:has-text("Load"):not(.is-loading)');

  // Check for error message
  const errorMessage = await page.locator('.field.is-danger .message').isVisible();
  if (errorMessage) {
    throw new Error('YouTube URL loading failed: ' + await page.locator('.field.is-danger .message').textContent());
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
 * Uploads a backing track directly (already-instrumental source)
 */
export async function uploadBackingTrackFile(page: Page, filename: string): Promise<void> {
  await selectSource(page, 'backing');

  const filePath = getFixturePath(filename);
  const fileInput = page.locator('[name="backing-track-upload"] [type="file"]');

  await fileInput.setInputFiles(filePath);
}

/**
 * Loads lyrics from a fixture file or string and enters them in the lyrics editor
 */
export async function loadAndEnterLyrics(page: Page, lyricsContentOrFilename: string): Promise<void> {
  // Determine if this is a file path or direct content
  let lyricsContent = lyricsContentOrFilename;
  try {
    // Attempt to load as a file if it appears to be a file path
    if (lyricsContentOrFilename.includes('.') && !lyricsContentOrFilename.includes('\n')) {
      lyricsContent = await loadFixtureFile(lyricsContentOrFilename);
    }
  } catch (error) {
    // If loading fails, assume the input is direct content
    console.log('Input treated as direct lyrics content');
  }

  // Enter the lyrics content into the editor
  const textAreaLocator = page.locator('.lyric-input-tab .lyric-editor-textarea');
  await textAreaLocator.clear();
  await textAreaLocator.pressSequentially(lyricsContent);
}

/**
 * Uploads a timings file through the advanced options on the Song Timing tab
 */
export async function uploadTimingsFile(page: Page, timingsFilename: string): Promise<void> {
  // Navigate to the song timing tab if not already there
  if (!await page.locator('.song-timing-tab').isVisible()) {
    await navigateToTab(page, TabId.SongTiming);
  }

  // Click advanced button to reveal timings file upload
  await page.click("button:has-text('Advanced')");

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
  expectTitle?: string
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
  if (!await page.locator('.lyric-input-tab').isVisible()) {
    await navigateToTab(page, TabId.LyricInput);
  }

  await page.click("button:has-text('Add Underscores')");
}

/**
 * Toggles the "Magic Slashes" checkbox
 */
export async function toggleMagicSlashes(page: Page, enable: boolean): Promise<void> {
  if (!await page.locator('.lyric-input-tab').isVisible()) {
    await navigateToTab(page, TabId.LyricInput);
  }

  const checkbox = page.locator('.lyric-input-tab input[type="checkbox"]');
  const isChecked = await checkbox.isChecked();

  if ((enable && !isChecked) || (!enable && isChecked)) {
    await page.click('.lyric-input-tab .level-item .checkbox');
  }
}
