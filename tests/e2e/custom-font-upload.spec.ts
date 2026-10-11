import { test, expect, Page } from "@playwright/test";
import path from "path";
import {
  setupTestEnvironment,
  navigateToTab,
  TabId,
  getFixturesDir,
  defaultTestConfig,
  setupBasicInputs,
  uploadTimingsFile,
  exactFieldFor,
} from "./utils";

const FONT_UPLOAD = '[name="custom-font-upload"] input[type="file"]';
// The Adjust tab mounts a subtitle display of its own, so stay inside the Submit tab.
const SUBTITLE_CANVAS = ".submit-tab canvas.subtitle-canvas";

// The base style's picker comes before any custom style's own.
function fontSelect(page: Page) {
  return exactFieldFor(page, "Font").first().locator("select");
}

// A bundled font stands in for the user's own file. Its family name ("Metal Mania")
// deliberately differs from the file name.
function bundledFontPath(): string {
  return path.join(getFixturesDir(), "../../api/assets/fonts/MetalMania.ttf");
}

function canvasPixels(page: Page): Promise<string> {
  return page.locator(SUBTITLE_CANVAS).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
}

function isCanvasBlank(page: Page): Promise<boolean> {
  return page.locator(SUBTITLE_CANVAS).evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    return !data.some((channel) => channel !== 0);
  });
}

// A test may open the panel more than once, and a second click would close it.
async function openFontSettings(page: Page): Promise<void> {
  await navigateToTab(page, TabId.Submit);
  const trigger = page.getByRole("button", { name: "Fonts and Colors" });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  await expect(fontSelect(page)).toBeVisible();
}

test.describe("Custom Font Upload", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("an uploaded font overrides the picked one and survives a reload", async ({ page }) => {
    await openFontSettings(page);
    await expect(fontSelect(page)).toHaveValue("Trebuchet MS");

    await page.locator(FONT_UPLOAD).setInputFiles(bundledFontPath());

    await expect(page.locator('.toast:has-text("Metal Mania")')).toBeVisible();
    await expect(page.locator(".custom-font-help")).toContainText("Metal Mania");
    // The picker keeps its own value, so removing the font restores it.
    await expect(fontSelect(page)).toHaveValue("Trebuchet MS");

    await expect(page.locator(".source-file-links")).toContainText("MetalMania.ttf");

    await page.reload();
    await openFontSettings(page);

    await expect(page.locator(".custom-font-help")).toContainText("Metal Mania");
  });

  test("removing the font falls back to the picked one", async ({ page }) => {
    await openFontSettings(page);
    await fontSelect(page).selectOption("Impact");
    await page.locator(FONT_UPLOAD).setInputFiles(bundledFontPath());
    await expect(page.locator(".custom-font-help")).toContainText("Metal Mania");

    await page.locator('[name="custom-font-upload"] button.is-danger').click();

    await expect(page.locator(".custom-font-help")).toHaveCount(0);
    await expect(fontSelect(page)).toHaveValue("Impact");
  });

  test("the preview redraws the lyrics in the uploaded font", async ({ page }) => {
    await setupBasicInputs(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.lyricsFile,
      defaultTestConfig.artist,
      defaultTestConfig.title,
    );
    await uploadTimingsFile(page, defaultTestConfig.timingsFile);
    await openFontSettings(page);
    // Seeking paints the frame at that moment, since libass only draws on a time update.
    await page.locator(".submit-tab .preview-container audio").evaluate((el: HTMLAudioElement) => {
      el.muted = true;
      el.currentTime = 1;
    });
    // The title fades in from nothing at 0 seconds,
    // so only the frame after the seek can be non-blank.
    await expect.poll(() => isCanvasBlank(page)).toBe(false);
    const beforeUpload = await canvasPixels(page);
    // The frame at a fixed time is stable, so a difference after the upload can only come
    // from the font libass drew with.
    expect(await canvasPixels(page)).toBe(beforeUpload);

    await page.locator(FONT_UPLOAD).setInputFiles(bundledFontPath());

    await expect(page.locator(".custom-font-help")).toContainText("Metal Mania");
    // The renderer is replaced, so give it until it has drawn something different.
    await expect.poll(() => canvasPixels(page), { timeout: 15000 }).not.toBe(beforeUpload);
    await expect.poll(() => isCanvasBlank(page)).toBe(false);
  });

  test("a file that is not a font is reported and ignored", async ({ page }) => {
    await openFontSettings(page);

    await page.locator(FONT_UPLOAD).setInputFiles({
      name: "not-really.ttf",
      mimeType: "font/ttf",
      buffer: Buffer.from("just some text"),
    });

    await expect(page.locator(".toast.is-danger")).toBeVisible();
    await expect(page.locator(".custom-font-help")).toHaveCount(0);
    await expect(fontSelect(page)).toHaveValue("Trebuchet MS");
  });

  test("a voice takes its own uploaded font, kept across a reload and dropped on Start over", async ({
    page,
  }) => {
    await navigateToTab(page, TabId.SongInfo);
    await page.locator('[name="lyrics-file-upload"] input[type="file"]').setInputFiles({
      name: "duet.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("[Anna] la_la\n[Ben] hm_hm"),
    });
    await openFontSettings(page);

    const ben = page.locator(".style-override-row").filter({ hasText: "Ben" });
    await ben.locator(".switch").click();
    await ben.locator('.style-font-upload input[type="file"]').setInputFiles(bundledFontPath());

    await expect(ben.locator(".style-font-help")).toContainText("Rendering Ben in “Metal Mania”");
    await expect(
      page.locator(".style-override-row").filter({ hasText: "Anna" }).locator(".style-font-help"),
    ).toHaveCount(0);

    await page.reload();
    await navigateToTab(page, TabId.Submit);
    await expect(ben.locator(".style-font-help")).toContainText("Metal Mania");

    await page.getByRole("navigation").getByRole("button", { name: "Start Over" }).click();
    await expect(page.locator(".modal-card-body .source-file-links")).toContainText(
      "MetalMania.ttf",
    );
    await page.getByRole("dialog").getByRole("button", { name: "Start over" }).click();

    await navigateToTab(page, TabId.SongInfo);
    await page.locator('[name="lyrics-file-upload"] input[type="file"]').setInputFiles({
      name: "duet.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("[Anna] la_la\n[Ben] hm_hm"),
    });
    await navigateToTab(page, TabId.Submit);
    await expect(page.locator(".style-font-help")).toHaveCount(0);
  });

  test("the title takes its own uploaded font, kept across a reload and dropped with its style", async ({
    page,
  }) => {
    await openFontSettings(page);

    const title = page.locator(".style-override-row").filter({ hasText: "Title" });
    await title.locator('.style-font-upload input[type="file"]').setInputFiles(bundledFontPath());
    await expect(title.locator(".style-font-help")).toContainText(
      "Rendering the title in “Metal Mania”",
    );

    await page.reload();
    await openFontSettings(page);
    await expect(title.locator(".style-font-help")).toContainText("Metal Mania");

    await title.getByText("Custom style").click();
    await expect(title.locator(".style-font-help")).toHaveCount(0);
    await title.getByText("Custom style").click();
    await expect(title.locator(".style-font-upload")).toBeVisible();
    await expect(title.locator(".style-font-help")).toHaveCount(0);
  });
});
