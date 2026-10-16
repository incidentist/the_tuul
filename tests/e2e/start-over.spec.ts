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

  for (const resetsStyling of [false, true]) {
    test(`keeps the uploaded fonts, and ${resetsStyling ? "resets" : "keeps"} the fonts and colors as asked`, async ({
      page,
    }) => {
      await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
      await page
        .getByLabel("Font files")
        .setInputFiles(path.join(getFixturesDir(), "fonts", "NotoSans-Bold.ttf"));
      await navigateToTab(page, TabId.Submit);
      await page.getByRole("button", { name: "Fonts and Colors" }).click();
      const fontSelect = exactFieldFor(page, "Font").first().locator("select");
      const primaryColor = page.getByLabel("primary color hex code", { exact: true });
      await fontSelect.selectOption("Noto Sans Bold");
      await primaryColor.fill("#ff8800");
      await primaryColor.press("Enter");
      await expect(primaryColor).toHaveValue("#ff8800");

      await page.getByRole("navigation").getByRole("button", { name: "Start Over" }).click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("checkbox", { name: "Also reset the fonts and colors" }),
      ).not.toBeChecked();
      if (resetsStyling) {
        await dialog.getByText("Also reset the fonts and colors").click();
      }
      await dialog.getByRole("button", { name: "Start over" }).click();

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
      await expect(fontSelect).toHaveValue(resetsStyling ? "Trebuchet MS" : "Noto Sans Bold");
      await expect(primaryColor).toHaveValue(resetsStyling ? "#7957d5" : "#ff8800");
    });
  }
});
