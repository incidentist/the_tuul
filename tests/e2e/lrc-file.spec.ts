import { expect, test, Page } from "@playwright/test";
import { promises as fs } from "fs";
import {
  enableAdvancedMode,
  getFixturePath,
  navigateToTab,
  setupTestEnvironment,
  TabId,
} from "./utils";

async function downloadFrom(page: Page, exportName: string): Promise<string> {
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("group", { name: exportName, exact: true })
    .getByRole("button", { name: "project.lrc" })
    .click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("project.lrc");
  return fs.readFile((await download.path()) as string, "utf8");
}

test.describe("LRC files", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
    await enableAdvancedMode(page);
    await navigateToTab(page, TabId.SongInfo);
  });

  test("the Submit tab downloads the synced lyrics as an LRC file", async ({ page }) => {
    await page
      .locator('[name="kbp-file-upload"] input[type="file"]')
      .setInputFiles(getFixturePath("song.kbp"));
    await navigateToTab(page, TabId.Submit);

    const lrc = await downloadFrom(page, "Synced lyrics");
    expect(lrc).toContain("[ti:Pale Moon]\n");
    expect(lrc).toContain("]➣➣➣Pale moon rising slow\n");
    // Not among the project's own files.
    await expect(page.locator(".source-file-links")).not.toContainText(".lrc");
  });

  test("the Submit tab downloads the syllable timings as an enhanced LRC file", async ({
    page,
  }) => {
    await page
      .locator('[name="kbp-file-upload"] input[type="file"]')
      .setInputFiles(getFixturePath("song.kbp"));
    await navigateToTab(page, TabId.Submit);

    const lrc = await downloadFrom(page, "Word-synced lyrics");
    expect(lrc).toContain("[ti:Pale Moon]\n");
    expect(lrc).toMatch(/<\d\d:\d\d\.\d\d>Pale <\d\d:\d\d\.\d\d>moon <\d\d:\d\d\.\d\d>ri<\d/);
  });
});
