import { test, expect, Page } from "@playwright/test";
import {
  setupTestEnvironment,
  navigateToTab,
  exactFieldFor,
  fieldFor,
  radioFor,
  TabId,
  getFixturePath,
} from "./utils";

async function uploadSettingsFile(
  page: Page,
  files: Parameters<ReturnType<Page["locator"]>["setInputFiles"]>[0],
) {
  await navigateToTab(page, TabId.SongInfo);
  await page.locator('[name="settings-file-upload"] input[type="file"]').setInputFiles(files);
}

test.describe("Settings File Upload", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("loading a settings.yaml applies its options across the app", async ({ page }) => {
    await uploadSettingsFile(page, getFixturePath("settings.yaml"));

    await expect(page.locator('.toast:has-text("Settings loaded!")')).toBeVisible();

    // The song metadata and separation model from the file are applied
    await expect(page.locator('[name="artist"]')).toHaveValue("Ma Rainey");
    await expect(page.locator('[name="title"]')).toHaveValue("Prove It On Me Blues");
    await expect(
      page.locator('.separation-model-radios input[value="UVR-MDX-NET-Inst_HQ_3.onnx"]'),
    ).toBeChecked();

    // ...as are the video options, over on the Submit tab
    await navigateToTab(page, TabId.Submit);
    await expect(radioFor(page, "Count-Ins", "screen")).toBeChecked();
    await expect(fieldFor(page, "Instrumental Breaks").locator('input[type="number"]')).toHaveValue(
      "12.5",
    );
    await expect(fieldFor(page, "Video Format").locator("select")).toHaveValue("mkv");

    await page.getByRole("button", { name: "Fonts and Colors" }).click();
    await expect(exactFieldFor(page, "Font").locator("select")).toHaveValue("Impact");
    await expect(fieldFor(page, "Font Size").locator('input[type="number"]')).toHaveValue("30");
    await expect(page.getByLabel("primary color hex code")).toHaveValue("#ff8800");
    await expect(page.getByLabel("secondary color hex code")).toHaveValue("#0088ff");
  });

  test("a malformed settings file is reported and changes nothing", async ({ page }) => {
    await uploadSettingsFile(page, {
      name: "settings.yaml",
      mimeType: "application/yaml",
      buffer: Buffer.from("- not\n- a mapping\n"),
    });

    await expect(page.locator(".toast.is-danger")).toBeVisible();

    await navigateToTab(page, TabId.Submit);
    await expect(radioFor(page, "Count-Ins", "line")).toBeChecked();
  });
});
