import { test, expect, Page } from "@playwright/test";
import {
  setupTestEnvironment,
  navigateToTab,
  TabId,
  loadAndEnterLyrics,
  loadFixtureFile,
  addUnderscoresToLyrics,
  toggleMagicSlashes,
  expectLyricsText,
  lyricsEditor,
  magicSlashesCheckbox,
} from "./utils";

// The fixture's last line holds this word twice, for magic slashes to copy a slash across.
const REPEATED_WORD = "was";

/**
 * Replaces every whole `word` in underscored lyrics with `replacement`.
 */
function replaceWord(lyrics: string, word: string, replacement: string): string {
  return lyrics.replace(new RegExp(`(?<=^|[_\\n])${word}(?=[_\\n]|$)`, "g"), replacement);
}

/**
 * Puts the cursor `offset` characters into the last occurrence of `word` in the lyrics.
 */
async function moveIntoLastOccurrence(page: Page, lyrics: string, word: string, offset: number) {
  await lyricsEditor(page).focus();
  await page.keyboard.press("ControlOrMeta+End");
  for (let i = 0; i < lyrics.length - lyrics.lastIndexOf(word) - offset; i++) {
    await page.keyboard.press("ArrowLeft");
  }
}

test.describe("Lyrics Tab Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("Lyrics tab functionality - Add Underscore and Magic Slashes", async ({ page }) => {
    await navigateToTab(page, TabId.LyricInput);

    // The fixture's words, typed without its markup.
    const fixture = await loadFixtureFile("lyrics.txt");
    const underscored = fixture.replaceAll("/", "");
    await loadAndEnterLyrics(page, underscored.replaceAll("_", " "));

    await addUnderscoresToLyrics(page);
    await expectLyricsText(page, underscored);

    // Magic Slashes is on by default.
    await expect(magicSlashesCheckbox(page)).toBeChecked();

    // A slash typed into the last occurrence of the word lands in the other one too.
    await moveIntoLastOccurrence(page, underscored, REPEATED_WORD, 2);
    await page.keyboard.type("/");
    const oneSlash = replaceWord(underscored, REPEATED_WORD, "wa/s");
    await expectLyricsText(page, oneSlash);

    // So does a second slash in the same word.
    await moveIntoLastOccurrence(page, oneSlash, "wa/s", 1);
    await page.keyboard.type("/");
    await expectLyricsText(page, replaceWord(underscored, REPEATED_WORD, "w/a/s"));

    // With Magic Slashes off, a slash stays in the word it was typed into.
    await loadAndEnterLyrics(page, "Hello hello hello");
    await addUnderscoresToLyrics(page);
    await expectLyricsText(page, "Hello_hello_hello");

    await toggleMagicSlashes(page, false);
    await expect(magicSlashesCheckbox(page)).not.toBeChecked();

    await lyricsEditor(page).focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("/");
    await expectLyricsText(page, "He/llo_hello_hello");
  });
});
