import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "fs";
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
  switchFor,
  mockSeparateTrackApi,
} from "./utils";

// The Adjust tab mounts a subtitle display of its own, so stay inside the Submit tab.
const SUBTITLE_CANVAS = ".submit-tab canvas.subtitle-canvas";

// The base style's picker comes before any custom style's own.
function fontSelect(page: Page) {
  return exactFieldFor(page, "Font").first().locator("select");
}

function uploadedFonts(page: Page) {
  return page.getByRole("list", { name: "Uploaded fonts" }).getByRole("listitem");
}

// Faces of one family, which the bundled fonts don't have.
function fixtureFont(name: string): string {
  return path.join(getFixturesDir(), "fonts", name);
}

// The upload and the list of uploaded fonts are on the Files tab.
async function uploadFonts(page: Page, ...names: string[]): Promise<void> {
  await navigateToTab(page, TabId.SongInfo);
  await page.getByLabel("Font files").setInputFiles(names.map(fixtureFont));
}

// The canvas belongs to the renderer's worker, so only a screenshot can read it.
async function canvasPixels(page: Page): Promise<string> {
  return (await page.locator(SUBTITLE_CANVAS).screenshot()).toString("base64");
}

async function isCanvasBlank(page: Page): Promise<boolean> {
  const png = await canvasPixels(page);
  return page.evaluate(async (png) => {
    const image = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${png}`)).blob(),
    );
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    // The canvas sits at a fractional position, so the screenshot's edge can show the page.
    const { data } = context.getImageData(2, 2, image.width - 4, image.height - 4);
    // With nothing drawn, every pixel has the preview's background color.
    return data.every((channel, i) => channel === data[i % 4]);
  }, png);
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

test.describe("Font Library", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("several faces upload at once, each a choice that sets Bold and Italic to match", async ({
    page,
  }) => {
    await uploadFonts(page, "NotoSans-Regular.ttf", "NotoSans-Bold.ttf", "NotoSans-Italic.ttf");

    await expect(page.locator('.toast:has-text("Added 3 fonts")')).toBeVisible();
    await expect(uploadedFonts(page)).toHaveText([
      /Noto Sans Regular/,
      /Noto Sans Italic/,
      /Noto Sans Bold/,
    ]);

    await openFontSettings(page);
    await fontSelect(page).selectOption("Noto Sans Italic");
    await expect(switchFor(page, "Bold").first()).not.toBeChecked();
    await expect(switchFor(page, "Italic").first()).toBeChecked();

    await fontSelect(page).selectOption("Noto Sans Bold");
    await expect(switchFor(page, "Bold").first()).toBeChecked();
    await expect(switchFor(page, "Italic").first()).not.toBeChecked();
    // Only the face the video uses goes with the project.
    await expect(page.locator(".download-links .source-file-links")).toContainText(
      "NotoSans-Bold.ttf",
    );
    await expect(page.locator(".download-links .source-file-links")).not.toContainText(
      "NotoSans-Regular.ttf",
    );

    await page.reload();
    await openFontSettings(page);
    await expect(fontSelect(page)).toHaveValue("Noto Sans Bold");
    await navigateToTab(page, TabId.SongInfo);
    await expect(uploadedFonts(page)).toHaveCount(3);
  });

  test("a removed face stays picked, marked as not uploaded, until it is uploaded again", async ({
    page,
  }) => {
    await uploadFonts(page, "NotoSans-Bold.ttf");
    await openFontSettings(page);
    await fontSelect(page).selectOption("Noto Sans Bold");

    await navigateToTab(page, TabId.SongInfo);
    await page.getByRole("button", { name: "Remove Noto Sans Bold" }).click();

    await expect(uploadedFonts(page)).toHaveCount(0);
    await openFontSettings(page);
    await expect(fontSelect(page)).toHaveValue("Noto Sans Bold");
    await expect(fontSelect(page).locator("option:checked")).toHaveText(
      "Noto Sans Bold (not uploaded)",
    );
    await expect(exactFieldFor(page, "Font").first()).toContainText(
      "“Trebuchet MS” is drawn instead",
    );

    await uploadFonts(page, "NotoSans-Bold.ttf");
    await openFontSettings(page);

    await expect(fontSelect(page).locator("option:checked")).toHaveText("Noto Sans Bold");
    await expect(exactFieldFor(page, "Font").first()).not.toContainText("is drawn instead");
  });

  test("the preview redraws the lyrics in a picked face", async ({ page }) => {
    await setupBasicInputs(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.lyricsFile,
      defaultTestConfig.artist,
      defaultTestConfig.title,
    );
    await uploadTimingsFile(page, defaultTestConfig.timingsFile);
    await uploadFonts(page, "NotoSans-Bold.ttf");
    await openFontSettings(page);
    // Seeking paints the frame at that moment, since libass only draws on a time update.
    await page.locator(".submit-tab .preview-container audio").evaluate((el: HTMLAudioElement) => {
      el.muted = true;
      el.currentTime = 1;
    });
    // The title fades in from nothing at 0 seconds,
    // so only the frame after the seek can be non-blank.
    await expect.poll(() => isCanvasBlank(page)).toBe(false);
    const beforePick = await canvasPixels(page);
    // The frame at a fixed time is stable, so a difference after the pick can only come
    // from the font libass drew with.
    expect(await canvasPixels(page)).toBe(beforePick);

    await fontSelect(page).selectOption("Noto Sans Bold");

    // The font loads before the preview redraws, so give it until it has drawn something different.
    await expect.poll(() => canvasPixels(page), { timeout: 15000 }).not.toBe(beforePick);
    await expect.poll(() => isCanvasBlank(page)).toBe(false);
  });

  test("the preview shows the frame at a seek made while a picked face loads", async ({ page }) => {
    // A finished separation swaps the preview's audio source, which resets the time to 0
    // and then restores it, so the seek can arrive among several time changes.
    await mockSeparateTrackApi(page.context());
    await setupBasicInputs(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.lyricsFile,
      defaultTestConfig.artist,
      defaultTestConfig.title,
    );
    await uploadTimingsFile(page, defaultTestConfig.timingsFile);
    await uploadFonts(page, "NotoSans-Bold.ttf");
    await openFontSettings(page);

    await fontSelect(page).selectOption("Noto Sans Bold");
    await page.locator(".submit-tab .preview-container audio").evaluate((el: HTMLAudioElement) => {
      el.muted = true;
      el.currentTime = 2.5;
    });

    // The title fades in from nothing at 0 seconds, so a blank frame is one from before the seek.
    await expect.poll(() => isCanvasBlank(page)).toBe(false);
  });

  test("a file that is not a font is reported, and the others in the drop still added", async ({
    page,
  }) => {
    await navigateToTab(page, TabId.SongInfo);

    await page.getByLabel("Font files").setInputFiles([
      { name: "not-really.ttf", mimeType: "font/ttf", buffer: Buffer.from("just some text") },
      {
        name: "NotoSans-Bold.ttf",
        mimeType: "font/ttf",
        buffer: readFileSync(fixtureFont("NotoSans-Bold.ttf")),
      },
    ]);

    await expect(page.locator('.toast.is-danger:has-text("not-really.ttf")')).toBeVisible();
    await expect(uploadedFonts(page)).toHaveText([/Noto Sans Bold/]);
    await openFontSettings(page);
    await expect(fontSelect(page)).toHaveValue("Trebuchet MS");
  });

  test("a voice and the title pick from the same uploaded faces", async ({ page }) => {
    await navigateToTab(page, TabId.SongInfo);
    await page.locator('[name="lyrics-file-upload"] input[type="file"]').setInputFiles({
      name: "duet.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("[Anna] la_la\n[Ben] hm_hm"),
    });
    await uploadFonts(page, "NotoSans-Regular.ttf", "NotoSans-Bold.ttf");
    await openFontSettings(page);

    const ben = page.locator(".style-override-row").filter({ hasText: "Ben" });
    await ben.getByText("Custom style").click();
    await ben.getByRole("combobox").first().selectOption("Noto Sans Regular");
    const title = page.locator(".style-override-row").filter({ hasText: "Title" });
    await title.getByRole("combobox").first().selectOption("Noto Sans Bold");

    await page.reload();
    await openFontSettings(page);

    await expect(ben.getByRole("combobox").first()).toHaveValue("Noto Sans Regular");
    await expect(title.getByRole("combobox").first()).toHaveValue("Noto Sans Bold");
    await expect(fontSelect(page)).toHaveValue("Trebuchet MS");
  });
});
