import { expect, test } from "@playwright/test";
import path from "path";
import {
  getFixturePath,
  getFixturesDir,
  navigateToTab,
  setupTestEnvironment,
  TabId,
  expectLyricsText,
  exactFieldFor,
} from "./utils";

test.describe("Starting over", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
    await navigateToTab(page, TabId.SongInfo);
    await page
      .locator('[name="lyrics-file-upload"] input[type="file"]')
      .setInputFiles(getFixturePath("lyrics.txt"));
    await page.getByRole("navigation").getByRole("button", { name: "Start Over" }).click();
  });

  test("offers the current files for download before discarding them", async ({ page }) => {
    await expect(page.locator(".modal-card-title")).toHaveText("Start over?");
    await expect(page.locator(".modal-card-body .source-file-links")).toContainText("lyrics.txt");

    await page.getByRole("dialog").getByRole("button", { name: "Start over" }).click();

    await expect(page.locator(".modal-card")).toBeHidden();
    await expect(page.locator('[name="lyrics-file-upload"] .file-name')).toHaveText(
      "No file chosen",
    );
    await navigateToTab(page, TabId.LyricInput);
    await expectLyricsText(page, "");
  });

  test("keeps everything when declined", async ({ page }) => {
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    await expect(page.locator(".modal-card")).toBeHidden();
    await expect(page.locator('[name="lyrics-file-upload"] .file-name')).toHaveText("lyrics.txt");
  });

  test("keeps the uploaded fonts and resets the fonts and colors", async ({ page }) => {
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await page
      .getByLabel("Font files")
      .setInputFiles(path.join(getFixturesDir(), "fonts", "NotoSans-Bold.ttf"));
    await navigateToTab(page, TabId.Submit);
    await page.getByRole("button", { name: "Fonts and Colors" }).click();
    const fontSelect = exactFieldFor(page, "Font").first().locator("select");
    await fontSelect.selectOption("Noto Sans Bold");
    await page.getByLabel("primary color hex code", { exact: true }).fill("#ff8800");
    await page.getByLabel("primary color hex code", { exact: true }).press("Enter");
    await expect(page.getByLabel("primary color hex code", { exact: true })).toHaveValue("#ff8800");

    await page.getByRole("navigation").getByRole("button", { name: "Start Over" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start over" }).click();

    await expect(page).toHaveURL(/#song$/);
    await page.reload();
    await expect(
      page.getByRole("list", { name: "Uploaded fonts" }).getByRole("listitem"),
    ).toHaveText([/Noto Sans Bold/]);
    await navigateToTab(page, TabId.Submit);
    const trigger = page.getByRole("button", { name: "Fonts and Colors" });
    if ((await trigger.getAttribute("aria-expanded")) !== "true") {
      await trigger.click();
    }
    await expect(fontSelect).toHaveValue("Trebuchet MS");
    await expect(page.getByLabel("primary color hex code", { exact: true })).toHaveValue("#7957d5");
  });
});
