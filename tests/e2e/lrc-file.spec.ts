import { expect, test } from "@playwright/test";
import { promises as fs } from "fs";
import {
  enableAdvancedMode,
  getFixturePath,
  navigateToTab,
  setupTestEnvironment,
  TabId,
} from "./utils";

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

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "project.lrc" }).click();
    const download = await downloading;

    expect(download.suggestedFilename()).toBe("project.lrc");
    const lrc = await fs.readFile((await download.path()) as string, "utf8");
    expect(lrc).toContain("[ti:Pale Moon]\n");
    expect(lrc).toContain("]➣➣➣Pale moon rising slow\n");
    // Not among the project's own files.
    await expect(page.locator(".source-file-links")).not.toContainText(".lrc");
  });
});
