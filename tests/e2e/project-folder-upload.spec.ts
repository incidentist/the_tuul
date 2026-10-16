import { test, expect, Page } from "@playwright/test";
import { promises as fs } from "fs";
import path from "path";
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  getFixturePath,
  loadFixtureFile,
  expectVideoCreationToBeEnabled,
  expectLyricsText,
  exactFieldFor,
  getFixturesDir,
} from "./utils";

// The title the folder's settings.yaml carries. Deliberately not the one in the song's own tags,
// so the Song Title field shows which of the two won.
const RESTORED_TITLE = "Prove It On Me Blues (restored)";

async function makeFolder(name: string): Promise<string> {
  const folder = test.info().outputPath(name);
  await fs.mkdir(folder, { recursive: true });
  return folder;
}

// A folder shaped like an extracted export: every source file, plus the two the app has nothing to do with.
async function makeProjectFolder(): Promise<string> {
  const folder = await makeFolder("project");
  await fs.copyFile(getFixturePath(defaultTestConfig.audioFile), path.join(folder, "song.mp3"));
  await fs.copyFile(getFixturePath("lyrics.txt"), path.join(folder, "lyrics.txt"));
  await fs.copyFile(getFixturePath("timings.json"), path.join(folder, "timings.json"));
  await fs.writeFile(
    path.join(folder, "settings.yaml"),
    (await loadFixtureFile("settings.yaml")).replace(
      `title: ${defaultTestConfig.title}`,
      `title: ${RESTORED_TITLE}`,
    ),
  );
  await fs.writeFile(path.join(folder, "subtitles.ass"), "[Script Info]\n");
  await fs.writeFile(
    path.join(folder, `${defaultTestConfig.artist} - ${RESTORED_TITLE} [karaoke].mp4`),
    "",
  );
  return folder;
}

// Mono 8 kHz 16-bit silence, whose length the browser reads exactly from the header.
function silentWav(seconds: number): Buffer {
  const rate = 8000;
  const dataSize = seconds * rate * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, Buffer.alloc(dataSize)]);
}

async function openFontSettings(page: Page): Promise<void> {
  await navigateToTab(page, TabId.Submit);
  const trigger = page.getByRole("button", { name: "Fonts and Colors" });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
}

function uploadedFonts(page: Page) {
  return page.getByRole("list", { name: "Uploaded fonts" }).getByRole("listitem");
}

async function loadProjectFolder(page: Page, folder: string): Promise<void> {
  await navigateToTab(page, TabId.SongInfo);
  await page.locator('[name="project-folder-upload"] input[type="file"]').setInputFiles(folder);
}

test.describe("Project Folder Upload", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("loading a project folder puts the whole song back together", async ({ page }) => {
    await loadProjectFolder(page, await makeProjectFolder());

    await expect(page.locator('.toast:has-text("Loaded")')).toBeVisible();

    // The settings file's song details stand, rather than the tags inside the song file.
    await expect(page.locator('[name="title"]')).toHaveValue(RESTORED_TITLE);
    await expect(page.locator('[name="artist"]')).toHaveValue(defaultTestConfig.artist);
    await expect(
      page.locator('.separation-model-radios input[value="UVR-MDX-NET-Inst_HQ_3.onnx"]'),
    ).toBeChecked();

    // Each file lands in the field that would have taken it on its own.
    await expect(page.locator('[name="settings-file-upload"] .file-name')).toHaveText(
      "settings.yaml",
    );
    await expect(page.locator('[name="lyrics-file-upload"] .file-name')).toHaveText("lyrics.txt");
    await expect(page.locator('[name="timings-file-upload"] .file-name')).toHaveText(
      "timings.json",
    );
    await expect(page.locator('[name="song-file-upload"] .file-name')).toHaveText("song.mp3");

    await navigateToTab(page, TabId.LyricInput);
    await expectLyricsText(page, await loadFixtureFile("lyrics.txt"));

    // Song, lyrics and finished timings are all back, so the video can be built.
    await navigateToTab(page, TabId.Submit);
    await expectVideoCreationToBeEnabled(page);
  });

  test("the Intro tab's example link loads the example project", async ({ page }) => {
    await page.getByRole("link", { name: "Load an example song" }).click();

    await expect(page.getByRole("heading", { name: "Files", exact: true })).toBeVisible();
    await expect(page.locator('.toast:has-text("Loaded")')).toBeVisible();
    await expect(page.locator('[name="project-folder-upload"] .file-name')).toHaveText(
      "Example project",
    );
    await expect(page.locator('[name="song-file-upload"] .file-name')).toHaveText("song.mp3");
    await expect(page.locator('[name="backing-track-upload"] .file-name')).toHaveText(
      "backing.mp3",
    );
    await expect(page.locator('[name="vocal-track-upload"] .file-name')).toHaveText("vocals.mp3");

    await navigateToTab(page, TabId.Submit);
    await expectVideoCreationToBeEnabled(page);
  });

  test("a folder holding only some of the files loads just those", async ({ page }) => {
    const folder = await makeFolder("partial");
    await fs.copyFile(getFixturePath("lyrics.txt"), path.join(folder, "lyrics.txt"));

    await loadProjectFolder(page, folder);

    await expect(page.locator('.toast:has-text("Loaded lyrics.")')).toBeVisible();
    await expect(page.locator('[name="lyrics-file-upload"] .file-name')).toHaveText("lyrics.txt");
    await expect(page.locator('[name="settings-file-upload"] .file-name')).toHaveText(
      "No file chosen",
    );
    await expect(page.locator('[name="song-file-upload"] .file-name')).toHaveText("No file chosen");
  });

  test("a folder's fonts join the library, the ones its settings name picked", async ({ page }) => {
    const folder = await makeFolder("fonts");
    await fs.writeFile(
      path.join(folder, "settings.yaml"),
      (await loadFixtureFile("settings.yaml")).replace("name: Impact", "name: Noto Sans Bold"),
    );
    for (const font of ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"]) {
      await fs.copyFile(path.join(getFixturesDir(), "fonts", font), path.join(folder, font));
    }

    await loadProjectFolder(page, folder);

    await expect(page.locator('.toast:has-text("Loaded settings and the fonts.")')).toBeVisible();
    await expect(uploadedFonts(page)).toHaveText([/Noto Sans Regular/, /Noto Sans Bold/]);
    await openFontSettings(page);
    await expect(exactFieldFor(page, "Font").first().locator("select")).toHaveValue(
      "Noto Sans Bold",
    );
  });

  test("the one font of a project saved before the font library draws its lyrics", async ({
    page,
  }) => {
    // Such a project's settings name a bundled font, which its font file overrode.
    const folder = await makeFolder("older-project");
    await fs.copyFile(getFixturePath("settings.yaml"), path.join(folder, "settings.yaml"));
    await fs.copyFile(
      path.join(getFixturesDir(), "fonts", "NotoSans-Bold.ttf"),
      path.join(folder, "NotoSans-Bold.ttf"),
    );

    await loadProjectFolder(page, folder);

    await expect(page.locator('.toast:has-text("Loaded settings and the font.")')).toBeVisible();
    await openFontSettings(page);
    await expect(exactFieldFor(page, "Font").first().locator("select")).toHaveValue(
      "Noto Sans Bold",
    );
  });

  test("a folder with nothing to load says so", async ({ page }) => {
    const folder = await makeFolder("empty");
    await fs.writeFile(path.join(folder, "notes.docx"), "");

    await loadProjectFolder(page, folder);

    await expect(page.locator('.toast:has-text("Nothing to load")')).toBeVisible();
  });

  test("asks before a folder replaces loaded files, and offers them first", async ({ page }) => {
    const folder = await makeProjectFolder();
    await navigateToTab(page, TabId.SongInfo);
    await page
      .locator('[name="lyrics-file-upload"] input[type="file"]')
      .setInputFiles(getFixturePath("lyrics.txt"));

    await loadProjectFolder(page, folder);
    await expect(page.locator(".modal-card-title")).toHaveText("Load this project folder?");
    await expect(page.locator(".modal-card-body")).toContainText(
      "replace your lyrics and settings",
    );
    await expect(page.locator(".modal-card-body .source-file-links")).toContainText("lyrics.txt");
    await expect(page.locator(".modal-card-body .source-file-links")).toContainText(
      "settings.yaml",
    );
    await page.click('.modal-card-foot button:has-text("Keep what I have")');

    await expect(page.locator(".modal-card")).toBeHidden();
    await expect(page.locator('[name="project-folder-upload"] .file-name')).toHaveText(
      "No folder chosen",
    );
    await expect(page.locator('[name="timings-file-upload"] .file-name')).toHaveText(
      "No file chosen",
    );

    await loadProjectFolder(page, folder);
    await page.click('.modal-card-foot button:has-text("Load folder")');

    await expect(page.locator('.toast:has-text("Loaded")')).toBeVisible();
    await expect(page.locator('[name="project-folder-upload"] .file-name')).toHaveText("project");
    await expect(page.locator('[name="timings-file-upload"] .file-name')).toHaveText(
      "timings.json",
    );
  });

  test("loads each model's tracks into that model's pair", async ({ page }) => {
    const folder = await makeFolder("models");
    await fs.copyFile(getFixturePath(defaultTestConfig.audioFile), path.join(folder, "song.mp3"));
    const tracks = getFixturePath("project/backing.mp3");
    await fs.copyFile(tracks, path.join(folder, "backing.mp3"));
    await fs.copyFile(tracks, path.join(folder, "MDX-Kara-backing.mp3"));
    await fs.copyFile(tracks, path.join(folder, "MDX-Kara-vocals.mp3"));
    // The MDX-Kara pair loads last, so only the settings make the uploaded track the one rendered.
    await fs.writeFile(
      path.join(folder, "settings.yaml"),
      "backingTrack: file:backing/backing.mp3\n",
    );

    await loadProjectFolder(page, folder);

    await expect(page.locator('.toast:has-text("the MDX-Kara tracks")')).toBeVisible();
    await expect(page.locator('[name="song-file-upload"] .file-name')).toHaveText("song.mp3");
    await expect(page.locator('[name="backing-track-upload"] .file-name')).toHaveText(
      "backing.mp3",
    );
    await expect(page.getByRole("img", { name: "Already separated" })).toHaveCount(1);
    await expect(page.getByRole("radio", { name: /^MDX-Net \(fastest\)/ })).toHaveAccessibleName(
      /Already separated/,
    );

    await navigateToTab(page, TabId.Submit);
    await expect(
      page.locator('.field:has(label:has-text("Backing Track")) select').first(),
    ).toHaveValue("file:backing/backing.mp3");
    await expect(page.locator(".source-file-links").last()).toContainText("MDX-Kara-vocals.mp3");
    await expect(page.locator(".source-file-links").last()).toContainText("MDX-Kara-backing.mp3");
  });

  test("uploads the other tracks, up to three of each kind, under their file names", async ({
    page,
  }) => {
    const folder = await makeFolder("unknown-models");
    await fs.copyFile(getFixturePath(defaultTestConfig.audioFile), path.join(folder, "song.mp3"));
    const tracks = getFixturePath("project/backing.mp3");
    for (const name of ["A-vocals", "B-vocals", "C-vocals", "Demucs-vocals", "Demucs-backing"]) {
      await fs.copyFile(tracks, path.join(folder, `${name}.mp3`));
    }
    await fs.copyFile(tracks, path.join(folder, "Demucs-backing.wav"));

    await loadProjectFolder(page, folder);

    await expect(
      page.locator(
        '.toast:has-text("The uploaded tracks are limited to 3 vocal and 3 backing tracks. Ignored Demucs-vocals.mp3.")',
      ),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[name="song-file-upload"] .file-name')).toHaveText("song.mp3");
    await expect(page.locator('[name="vocal-track-upload"] .file-name')).toHaveText("A-vocals.mp3");
    await navigateToTab(page, TabId.Submit);
    const backingGroup = page.locator(
      '.field:has(label:has-text("Backing Track")) optgroup[label="Backing · uploaded"]',
    );
    await expect(backingGroup.first().locator("option")).toHaveText([
      "Demucs-backing.mp3",
      "Demucs-backing.wav",
    ]);
    await navigateToTab(page, TabId.LyricInput);
    await expect(
      page.getByLabel("Playback track").locator('optgroup[label="Vocals · uploaded"] option'),
    ).toHaveText(["A-vocals.mp3", "B-vocals.mp3", "C-vocals.mp3"]);
  });

  test("warns about a track that is not the same length as the song", async ({ page }) => {
    const folder = await makeFolder("short-track");
    await fs.copyFile(getFixturePath(defaultTestConfig.audioFile), path.join(folder, "song.mp3"));
    await fs.copyFile(getFixturePath("project/vocals.mp3"), path.join(folder, "vocals.mp3"));
    await fs.writeFile(path.join(folder, "backing.wav"), silentWav(5));

    await loadProjectFolder(page, folder);

    await expect(
      page.locator(
        '.toast:has-text("backing.wav is not the same length as the song, so the timings may not line up with it.")',
      ),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.toast:has-text("vocals.mp3 is not")')).toHaveCount(0);
  });

  test("keeps the tracks when the folder brings a new song, and asks only about the song", async ({
    page,
  }) => {
    const folder = await makeFolder("song-only");
    await fs.copyFile(getFixturePath(defaultTestConfig.audioFile), path.join(folder, "song.mp3"));
    await navigateToTab(page, TabId.SongInfo);
    await page
      .locator('[name="song-file-upload"] input[type="file"]')
      .setInputFiles(getFixturePath(defaultTestConfig.audioFile));
    await page
      .locator('[name="backing-track-upload"] input[type="file"]')
      .setInputFiles(getFixturePath(defaultTestConfig.audioFile));

    await loadProjectFolder(page, folder);
    await expect(page.locator(".modal-card-title")).toHaveText("Load this project folder?");
    await expect(page.locator(".modal-card-body")).toContainText("replace your song.");
    await expect(page.locator(".modal-card-body .source-file-links")).toHaveCount(0);
    await page.click('.modal-card-foot button:has-text("Load folder")');

    await expect(page.locator('.toast:has-text("Loaded")')).toBeVisible();
    await expect(page.locator('[name="song-file-upload"] .file-name')).toHaveText("song.mp3");
    await expect(page.locator('[name="backing-track-upload"] .file-name')).toHaveText(
      defaultTestConfig.audioFile,
    );
  });

  test("warns when a new song does not match the length of the tracks it keeps", async ({
    page,
  }) => {
    await navigateToTab(page, TabId.SongInfo);
    await page
      .locator('[name="song-file-upload"] input[type="file"]')
      .setInputFiles(getFixturePath(defaultTestConfig.audioFile));
    await page
      .locator('[name="backing-track-upload"] input[type="file"]')
      .setInputFiles(getFixturePath(defaultTestConfig.audioFile));

    // Over two minutes, against a backing track of under twenty seconds.
    await page
      .locator('[name="song-file-upload"] input[type="file"]')
      .setInputFiles(getFixturePath("youtube/audio"));

    await expect(
      page.locator(".toast", { hasText: "is not the same length as the song" }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[name="backing-track-upload"] .file-name')).toHaveText(
      defaultTestConfig.audioFile,
    );
  });
});
