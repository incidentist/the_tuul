import { readFileSync } from "node:fs";
import path from "node:path";
import { createPinia, setActivePinia } from "pinia";
import { useSettingsStore } from "./settings";
import { VerticalAlignment } from "@/lib/timing";
import { BACKING_VOCALS_SEPARATOR_MODEL, NO_VOCALS_SEPARATOR_MODEL } from "./media";
import Color from "buefy/src/utils/color";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { nextTick } from "vue";
import { applyVoiceStyle } from "@/lib/voiceStyle";
import { DEFAULT_TIMING_KEYS } from "@/lib/timingKeys";
import { UnreadableFontError } from "@/lib/fontFile";
import { takeLegacyBlob } from "@/lib/persistence";
import { DEFAULT_LINE_SPACING, DEFAULT_OUTLINE_WIDTH, DEFAULT_TOP_MARGIN } from "@/constants";

function fontFile(name: string, as = name, dir = "../../api/assets/fonts"): File {
  const data = readFileSync(path.resolve(__dirname, dir, name));
  return new File([new Uint8Array(data)], as);
}

// Faces of one family, which the bundled fonts don't have.
function fixtureFont(name: string): File {
  return fontFile(name, name, "../../tests/fixtures/fonts");
}

vi.mock("@/lib/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/persistence")>()),
  takeLegacyBlob: vi.fn().mockResolvedValue(undefined),
}));

describe("Settings Store", () => {
  beforeEach(() => {
    // Create a fresh pinia instance for each test
    setActivePinia(createPinia());
  });

  test("should initialize with default settings", () => {
    const settingsStore = useSettingsStore();

    // Check default values
    expect(settingsStore.videoOptions.addTitleScreen).toBe(true);
    expect(settingsStore.videoOptions.countInMode).toBe("line");
    expect(settingsStore.videoOptions.instrumentalThreshold).toBe(8);
    expect(settingsStore.videoOptions.addStaggeredLines).toBe(true);
    expect(settingsStore.videoOptions.useBackground).toBe(false);
    expect(settingsStore.videoOptions.outputFormat).toBe("mp4");
    expect(settingsStore.videoOptions.verticalAlignment).toBe(VerticalAlignment.Middle);
    expect(settingsStore.videoOptions.vocalSeparationModel).toBe(BACKING_VOCALS_SEPARATOR_MODEL);

    // Check font default values
    expect(settingsStore.videoOptions.font.size).toBe(30);
    expect(settingsStore.videoOptions.font.name).toBe("Trebuchet MS");
    expect(settingsStore.videoOptions.font.bold).toBe(true);

    // Check color default values
    expect(settingsStore.videoOptions.color.background.toString()).toBe("#000000");
    expect(settingsStore.videoOptions.color.primary.toString()).toBe("#7957d5");
    expect(settingsStore.videoOptions.color.secondary.toString()).toBe("#ffffff");
  });

  test("should save settings to localStorage when changed", async () => {
    const settingsStore = useSettingsStore();

    // Modify a setting
    settingsStore.videoOptions.addTitleScreen = false;
    console.log(window.localStorage);
    await nextTick(); // Wait for Vue to update the DOM
    // Check if localStorage was updated
    expect(window.localStorage.videoOptions).toBeDefined();

    // Parse the stored JSON to verify values
    const savedOptions = JSON.parse(window.localStorage.videoOptions);
    expect(savedOptions.addTitleScreen).toBe(false);

    // Check that colors are stored as strings
    expect(typeof savedOptions.color.background).toBe("string");
    expect(savedOptions.color.background).toBe("#000000");
  });

  test("should load settings from localStorage", () => {
    // Prepare localStorage with custom settings
    const customSettings = {
      addTitleScreen: false,
      countInMode: "line",
      instrumentalThreshold: 0,
      addStaggeredLines: false,
      useBackground: true,
      verticalAlignment: VerticalAlignment.Top,
      vocalSeparationModel: NO_VOCALS_SEPARATOR_MODEL,
      font: {
        size: 30,
        name: "Times New Roman",
      },
      color: {
        background: "#111111",
        primary: "#222222",
        secondary: "#333333",
      },
    };

    window.localStorage.videoOptions = JSON.stringify(customSettings);

    // Initialize the store, which should load settings from localStorage
    const settingsStore = useSettingsStore();

    // Verify settings were loaded
    expect(settingsStore.videoOptions.addTitleScreen).toBe(false);
    expect(settingsStore.videoOptions.countInMode).toBe("line");
    expect(settingsStore.videoOptions.instrumentalThreshold).toBe(0);
    expect(settingsStore.videoOptions.addStaggeredLines).toBe(false);
    expect(settingsStore.videoOptions.useBackground).toBe(true);
    expect(settingsStore.videoOptions.verticalAlignment).toBe(VerticalAlignment.Top);
    expect(settingsStore.videoOptions.vocalSeparationModel).toBe(NO_VOCALS_SEPARATOR_MODEL);

    // Check font values
    expect(settingsStore.videoOptions.font.size).toBe(30);
    expect(settingsStore.videoOptions.font.name).toBe("Times New Roman");

    // Check color values - they should be Color objects after loading
    expect(settingsStore.videoOptions.color.background).toBeInstanceOf(Color);
    expect(settingsStore.videoOptions.color.background.toString()).toBe("#111111");
    expect(settingsStore.videoOptions.color.primary.toString()).toBe("#222222");
    expect(settingsStore.videoOptions.color.secondary.toString()).toBe("#333333");
  });

  test("reads the background switch saved under its older name", () => {
    window.localStorage.videoOptions = JSON.stringify({
      useBackgroundVideo: true,
      color: { background: "#000000" },
    });

    const settingsStore = useSettingsStore();

    expect(settingsStore.videoOptions.useBackground).toBe(true);
    expect(settingsStore.videoOptions).not.toHaveProperty("useBackgroundVideo");
  });

  test("should handle invalid localStorage data", () => {
    // Set invalid JSON in localStorage
    const consoleSpy = vi.spyOn(console, "error");
    window.localStorage.videoOptions = "not-valid-json";

    // Initialize the store - this should use default values
    const settingsStore = useSettingsStore();

    // Verify default settings were used
    expect(settingsStore.videoOptions.addTitleScreen).toBe(true);
    expect(settingsStore.videoOptions.font.size).toBe(30);
    expect(settingsStore.videoOptions.color.background.toString()).toBe("#000000");

    // Spy on console.error
    expect(consoleSpy).toHaveBeenCalled();
  });

  test("should reset settings to defaults", async () => {
    // Start with custom settings
    const customSettings = {
      addTitleScreen: false,
      countInMode: "line",
      instrumentalThreshold: 0,
      addStaggeredLines: false,
      useBackground: true,
      verticalAlignment: VerticalAlignment.Top,
      vocalSeparationModel: NO_VOCALS_SEPARATOR_MODEL,
      font: {
        size: 30,
        name: "Times New Roman",
      },
      color: {
        background: "#111111",
        primary: "#222222",
        secondary: "#333333",
      },
    };

    window.localStorage.videoOptions = JSON.stringify(customSettings);
    const settingsStore = useSettingsStore();

    // Verify custom settings loaded
    expect(settingsStore.videoOptions.addTitleScreen).toBe(false);

    // Reset to defaults
    settingsStore.resetSettings();
    await nextTick(); // Wait for Vue to update the DOM

    // Verify settings were reset
    expect(settingsStore.videoOptions.addTitleScreen).toBe(true);
    expect(settingsStore.videoOptions.countInMode).toBe("line");
    expect(settingsStore.videoOptions.font.size).toBe(30);
    expect(settingsStore.videoOptions.font.name).toBe("Trebuchet MS");
    expect(settingsStore.videoOptions.color.background.toString()).toBe("#000000");
    expect(settingsStore.videoOptions.color.primary.toString()).toBe("#7957d5");
    expect(settingsStore.videoOptions.color.secondary.toString()).toBe("#ffffff");

    // Check localStorage was updated
    const savedOptions = JSON.parse(window.localStorage.videoOptions);
    expect(savedOptions.addTitleScreen).toBe(true);
  });

  test.each([
    [true, "screen"],
    [false, "none"],
  ])("loads a stored addCountIns: %s as countInMode %s", (stored, expected) => {
    window.localStorage.videoOptions = JSON.stringify({
      addCountIns: stored,
      color: { background: "#000000", primary: "#ff00ff", secondary: "#00ffff" },
    });

    const settingsStore = useSettingsStore();

    expect(settingsStore.videoOptions.countInMode).toBe(expected);
    expect((settingsStore.videoOptions as any).addCountIns).toBeUndefined();
  });

  test("outlines settings saved before the outline color in their background color", () => {
    window.localStorage.videoOptions = JSON.stringify({
      color: { background: "#123456", primary: "#ff00ff", secondary: "#00ffff" },
    });

    const settingsStore = useSettingsStore();

    expect(settingsStore.videoOptions.color.outline?.toString()).toBe("#123456");
  });

  test("keeps no color for an outline or shadow that isn't drawn", async () => {
    window.localStorage.clear();
    const settingsStore = useSettingsStore();
    const options = settingsStore.videoOptions;
    expect(options.color.shadow).toBeNull();

    options.shadowX = 2;
    await nextTick();
    expect(options.color.shadow?.toString()).toBe("#000000");

    options.color.outline = Color.parse("#ff0000");
    options.titleStyle = { outline: Color.parse("#00ff00"), shadow: Color.parse("#0000ff") };
    settingsStore.setVoiceStyles({ Anna: { outlineWidth: 2, outline: Color.parse("#ffff00") } });
    options.outlineWidth = 0;
    options.shadowX = 0;
    await nextTick();
    expect(options.color.outline).toBeNull();
    expect(options.color.shadow).toBeNull();
    expect(options.titleStyle).toEqual({});
    expect(settingsStore.voiceStyles.Anna.outline?.toString()).toBe("#ffff00");

    options.outlineWidth = 1;
    await nextTick();
    expect(options.color.outline?.toString()).toBe("#000000");
  });

  test("resets the mix settings, and leaves the Restore Gaps switch and the rest alone", () => {
    window.localStorage.clear();
    const settingsStore = useSettingsStore();
    expect(settingsStore.mixSettingsAreDefault).toBe(true);
    Object.assign(settingsStore.videoOptions, {
      restoreGaps: true,
      gapPreRoll: 0,
      gapPostRoll: 0,
      gapMinLength: 2,
      gapFade: 0,
      gapLevelBalance: 0.5,
      restorePausesInLines: true,
      instrumentalThreshold: 0,
    });
    expect(settingsStore.mixSettingsAreDefault).toBe(false);

    settingsStore.resetMixSettings();

    expect(settingsStore.mixSettingsAreDefault).toBe(true);
    expect(settingsStore.videoOptions).toMatchObject({
      restoreGaps: true,
      gapPreRoll: 0.5,
      gapPostRoll: 1.5,
      gapMinLength: 1,
      gapFade: 0.1,
      gapLevelBalance: 1,
      restorePausesInLines: false,
      instrumentalThreshold: 0,
    });
  });

  test("count-in duration is capped by the threshold", async () => {
    window.localStorage.clear();
    const settingsStore = useSettingsStore();

    settingsStore.videoOptions.countInDuration = 4;
    settingsStore.videoOptions.countInThreshold = 3;
    await nextTick();
    expect(settingsStore.videoOptions.countInDuration).toBe(3);

    settingsStore.applyVideoOptions({ countInDuration: 10 });
    await nextTick();
    expect(settingsStore.videoOptions.countInDuration).toBe(3);
  });

  test("applyVideoOptions merges partial options over the current ones", async () => {
    window.localStorage.clear();
    const settingsStore = useSettingsStore();

    settingsStore.applyVideoOptions({
      countInMode: "none",
      font: { name: "Impact" } as any,
      color: { primary: Color.parse("#abcdef") } as any,
    });

    // Applied
    expect(settingsStore.videoOptions.countInMode).toBe("none");
    expect(settingsStore.videoOptions.font.name).toBe("Impact");
    expect(settingsStore.videoOptions.color.primary.toString()).toBe("#abcdef");
    // Untouched
    expect(settingsStore.videoOptions.addTitleScreen).toBe(true);
    expect(settingsStore.videoOptions.font.size).toBe(30);
    expect(settingsStore.videoOptions.color.background.toString()).toBe("#000000");
    expect(settingsStore.videoOptions.color.secondary.toString()).toBe("#ffffff");

    // And persisted, like any other change
    await nextTick();
    expect(JSON.parse(window.localStorage.videoOptions).color.primary).toBe("#abcdef");
  });

  describe("Voice style overrides", () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    test("sets and gets a per-voice override", () => {
      const store = useSettingsStore();
      expect(store.getVoiceStyle("Anna")).toBeUndefined();

      store.setVoiceStyleField("Anna", "fontName", "Impact");
      store.setVoiceStyleField("Anna", "bold", false);

      expect(store.getVoiceStyle("Anna")).toEqual({ fontName: "Impact", bold: false });
    });

    test("persists overrides with colors as hex strings", async () => {
      const store = useSettingsStore();
      store.setVoiceStyleField("Anna", "primary", Color.parse("#abcdef"));
      await nextTick();

      const saved = JSON.parse(window.localStorage.getItem("voiceStyles") as string);
      expect(saved.Anna.primary).toBe("#abcdef");
    });

    test("loads overrides from localStorage, parsing colors back", () => {
      window.localStorage.setItem(
        "voiceStyles",
        JSON.stringify({ Ben: { fontSize: 28, secondary: "#123456" } }),
      );

      const store = useSettingsStore();
      const ben = store.getVoiceStyle("Ben");

      expect(ben?.fontSize).toBe(28);
      expect(ben?.secondary).toBeInstanceOf(Color);
      expect(ben?.secondary?.toString()).toBe("#123456");
    });

    test("setVoiceStyles replaces every override", () => {
      const store = useSettingsStore();
      store.setVoiceStyleField("Anna", "bold", true);

      store.setVoiceStyles({ Ben: { fontSize: 18 } });

      expect(store.getVoiceStyle("Anna")).toBeUndefined();
      expect(store.getVoiceStyle("Ben")).toEqual({ fontSize: 18 });
    });

    test("clearVoiceStyle removes the override", () => {
      const store = useSettingsStore();
      store.setVoiceStyleField("Anna", "bold", true);
      store.clearVoiceStyle("Anna");
      expect(store.getVoiceStyle("Anna")).toBeUndefined();
    });
  });

  describe("font library", () => {
    // Earlier tests leave settings in localStorage, which a new store would load. These
    // cases are about the defaults and the uploaded fonts.
    beforeEach(() => {
      window.localStorage.clear();
      setActivePinia(createPinia());
    });

    test("renderOptions is videoOptions while every font name is known", () => {
      const store = useSettingsStore();

      expect(store.fontFaces).toEqual([]);
      expect(store.renderOptions).toBe(store.videoOptions);
    });

    test("adds every face of several files, sorted by family, weight and slant", async () => {
      const store = useSettingsStore();

      const { added, failed } = await store.addFonts([
        fixtureFont("NotoSans-Italic.ttf"),
        fixtureFont("NotoSans-Bold.ttf"),
        fontFile("MetalMania.ttf", "my-font.ttf"),
        fixtureFont("NotoSans-Regular.ttf"),
      ]);

      expect(added).toHaveLength(4);
      expect(failed).toEqual([]);
      // The name inside each file, not the file name, is what libass matches on.
      expect(store.fontFaces.map((face) => face.name)).toEqual([
        "Metal Mania",
        "Noto Sans Regular",
        "Noto Sans Italic",
        "Noto Sans Bold",
      ]);
      expect(store.fontFaces.every((face) => face.url)).toBe(true);
    });

    test("a file that is not a font is returned with its error, and the others still added", async () => {
      const store = useSettingsStore();
      const fake = new File(["nope"], "fake.ttf");

      const { added, failed } = await store.addFonts([fake, fontFile("Impact.ttf")]);

      expect(added.map((face) => face.name)).toEqual(["Impact"]);
      expect(failed).toHaveLength(1);
      expect(failed[0].file).toBe(fake);
      expect(failed[0].error).toBeInstanceOf(UnreadableFontError);
    });

    test("a face replaces one of the same name, whatever the case", async () => {
      const store = useSettingsStore();
      await store.addFonts([fontFile("Impact.ttf", "old.ttf")]);

      await store.addFonts([fontFile("Impact.ttf", "new.ttf")]);

      expect(store.fontFaces.map((face) => face.file.name)).toEqual(["new.ttf"]);
    });

    test("removeFont takes the face out of the library", async () => {
      const store = useSettingsStore();
      await store.addFonts([fontFile("Impact.ttf"), fontFile("MetalMania.ttf")]);

      store.removeFont("metal mania");

      expect(store.fontFaces.map((face) => face.name)).toEqual(["Impact"]);
    });

    test("a style picks an uploaded face by name, for rendering and for measuring", async () => {
      const store = useSettingsStore();
      await store.addFonts([fixtureFont("NotoSans-Bold.ttf")]);

      store.videoOptions.font.name = "Noto Sans Bold";

      expect(store.renderOptions.font.name).toBe("Noto Sans Bold");
      expect(store.fonts.covered("Noto Sans Bold")).toBeDefined();
    });

    test("a font that is neither bundled nor uploaded renders in the default font", async () => {
      const store = useSettingsStore();
      store.videoOptions.font.name = "Noto Sans Bold";
      store.videoOptions.font.size = 42;

      expect(store.renderOptions.font.name).toBe("Trebuchet MS");
      expect(store.renderOptions.font.size).toBe(42);
      // The setting keeps the name, so the font comes back once it is uploaded.
      expect(store.videoOptions.font.name).toBe("Noto Sans Bold");

      await store.addFonts([fixtureFont("NotoSans-Bold.ttf")]);

      expect(store.renderOptions.font.name).toBe("Noto Sans Bold");
    });

    test("the title and the voices fall back to the default font too", () => {
      const store = useSettingsStore();
      store.setTitleStyleField("fontName", "Missing Title Font");
      store.setVoiceStyleField("Anna", "fontName", "Missing Voice Font");
      store.setVoiceStyleField("Ben", "fontName", "Impact");

      expect(store.renderOptions.titleStyle.fontName).toBe("Trebuchet MS");
      expect(store.videoOptions.titleStyle.fontName).toBe("Missing Title Font");
      expect(store.renderVoiceStyle("Anna")?.fontName).toBe("Trebuchet MS");
      expect(store.renderVoiceStyle("Ben")?.fontName).toBe("Impact");
      expect(store.getVoiceStyle("Anna")?.fontName).toBe("Missing Voice Font");
    });

    test("resolveFontName ignores case and spells the name as the font does", async () => {
      const store = useSettingsStore();
      await store.addFonts([fixtureFont("NotoSans-Bold.ttf")]);

      expect(store.resolveFontName("noto sans bold")).toBe("Noto Sans Bold");
      expect(store.resolveFontName("IMPACT")).toBe("Impact");
    });

    test("the fonts saved before the library are dropped", () => {
      useSettingsStore();

      for (const key of ["settings.customFont", "settings.titleFont", "settings.voiceFonts"]) {
        expect(takeLegacyBlob).toHaveBeenCalledWith(key);
      }
    });

    test("resetStyling puts back the fonts and colors, title and voice styles included", async () => {
      const store = useSettingsStore();
      await store.addFonts([fontFile("Impact.ttf")]);
      Object.assign(store.videoOptions.font, { name: "Impact", size: 50, bold: false });
      store.videoOptions.color.primary = Color.parse("#123456");
      store.videoOptions.outlineWidth = 4;
      store.videoOptions.shadowX = 2;
      store.videoOptions.verticalAlignment = VerticalAlignment.Top;
      store.videoOptions.lineSpacing = 2;
      store.videoOptions.topMargin = 1;
      store.setTitleStyleField("fontName", "Impact");
      store.setVoiceStyleField("Anna", "outlineWidth", 2);
      store.videoOptions.countInMode = "none";

      store.resetStyling();

      expect(store.videoOptions.font).toEqual({ name: "Trebuchet MS", size: 30, bold: true });
      expect(store.videoOptions.color.primary.toString()).toBe("#7957d5");
      expect(store.videoOptions.outlineWidth).toBe(DEFAULT_OUTLINE_WIDTH);
      expect(store.videoOptions.shadowX).toBe(0);
      expect(store.videoOptions.verticalAlignment).toBe(VerticalAlignment.Middle);
      expect(store.videoOptions.lineSpacing).toBe(DEFAULT_LINE_SPACING);
      expect(store.videoOptions.topMargin).toBe(DEFAULT_TOP_MARGIN);
      expect(store.videoOptions.titleStyle.fontName).toBeUndefined();
      expect(store.videoOptions.titleStyle.fontSize).toBe(45);
      expect(store.voiceStyles).toEqual({});
      // Other settings and the library stay.
      expect(store.videoOptions.countInMode).toBe("none");
      expect(store.fontFaces.map((face) => face.name)).toEqual(["Impact"]);
    });

    test("resetSettings keeps the library", async () => {
      const store = useSettingsStore();
      await store.addFonts([fontFile("Impact.ttf")]);

      store.resetSettings();

      expect(store.fontFaces.map((face) => face.name)).toEqual(["Impact"]);
    });
  });

  describe("timing keys", () => {
    beforeEach(() => {
      localStorage.removeItem("timingKeys");
      localStorage.removeItem("timingKeyLabels");
      setActivePinia(createPinia());
    });

    test("taps with spacebar, enter and backspace by default", () => {
      const store = useSettingsStore();

      expect(store.timingKeys).toMatchObject({
        start: { key: "Space" },
        end: { key: "Enter" },
        redo: { key: "Backspace" },
      });
    });

    test("stores a rebound key", async () => {
      const store = useSettingsStore();

      store.setTimingKey("start", { key: "z", code: "KeyW" });
      await nextTick();

      const expected = { ...DEFAULT_TIMING_KEYS, start: { key: "z", code: "KeyW" } };
      expect(store.timingKeys).toEqual(expected);
      expect(JSON.parse(localStorage.getItem("timingKeys")!)).toEqual(expected);
    });

    test("binding another role's key swaps the two", () => {
      const store = useSettingsStore();

      store.setTimingKey("start", { key: "Enter" });

      expect(store.timingKeys).toEqual({
        ...DEFAULT_TIMING_KEYS,
        start: { key: "Enter" },
        end: { key: "Space" },
      });
    });

    test("swaps with whichever role holds the key", () => {
      const store = useSettingsStore();

      store.setTimingKey("redo", { key: "Space" });

      expect(store.timingKeys).toEqual({
        ...DEFAULT_TIMING_KEYS,
        start: { key: "Backspace" },
        redo: { key: "Space" },
      });
    });

    test("swaps two actions outside Tap mode", () => {
      const store = useSettingsStore();

      store.setTimingKey("switchMode", { key: "n", code: "KeyN" });

      expect(store.timingKeys).toEqual({
        ...DEFAULT_TIMING_KEYS,
        switchMode: { key: "n", code: "KeyN" },
        nextReview: { key: "t", code: "KeyT" },
      });
    });

    test("tells a key with Shift from the key alone when swapping", () => {
      const store = useSettingsStore();

      store.setTimingKey("seekBack", { key: "ArrowLeft", shift: true });

      expect(store.timingKeys).toMatchObject({
        seekBack: { key: "ArrowLeft", shift: true },
        seekBackFar: { key: "ArrowLeft" },
      });
    });

    test("tells a key with Ctrl from the key alone when swapping", () => {
      const store = useSettingsStore();

      store.setTimingKey("viewStart", { key: "Home", ctrl: true });

      expect(store.timingKeys).toMatchObject({
        viewStart: { key: "Home", ctrl: true },
        songStart: { key: "Home" },
      });
    });

    test("loads a stored Ctrl", () => {
      localStorage.setItem("timingKeys", JSON.stringify({ songEnd: { key: "e", ctrl: true } }));
      setActivePinia(createPinia());

      expect(useSettingsStore().timingKeys.songEnd).toEqual({ key: "e", ctrl: true });
    });

    test("loads a stored Shift", () => {
      localStorage.setItem(
        "timingKeys",
        JSON.stringify({ previousReview: { key: "p", code: "KeyP", shift: true } }),
      );
      setActivePinia(createPinia());

      expect(useSettingsStore().timingKeys.previousReview).toEqual({
        key: "p",
        code: "KeyP",
        shift: true,
      });
    });

    test("lets a tap key share its key with an action outside Tap mode", () => {
      const store = useSettingsStore();

      store.setTimingKey("start", { key: "t", code: "KeyT" });

      expect(store.timingKeys).toEqual({
        ...DEFAULT_TIMING_KEYS,
        start: { key: "t", code: "KeyT" },
      });
    });

    test("loads stored keys", () => {
      localStorage.setItem(
        "timingKeys",
        JSON.stringify({ start: { key: "a", code: "KeyQ" }, end: { key: "Home" } }),
      );
      setActivePinia(createPinia());

      expect(useSettingsStore().timingKeys).toEqual({
        ...DEFAULT_TIMING_KEYS,
        start: { key: "a", code: "KeyQ" },
        end: { key: "Home" },
      });
    });

    test("falls back to the default for a stored key that no longer names one", () => {
      localStorage.setItem(
        "timingKeys",
        JSON.stringify({ start: { key: "Spacebar" }, end: { key: "b" }, redo: 3 }),
      );
      setActivePinia(createPinia());

      expect(useSettingsStore().timingKeys).toEqual({ ...DEFAULT_TIMING_KEYS, end: { key: "b" } });
    });

    test("loads keys saved as plain names", () => {
      localStorage.setItem("timingKeys", JSON.stringify({ start: "Home", switchMode: "t" }));
      setActivePinia(createPinia());

      expect(useSettingsStore().timingKeys).toMatchObject({
        start: { key: "Home" },
        switchMode: { key: "t", code: "KeyT" },
      });
    });

    test("turns keys saved by position into what they typed, keeping the position", () => {
      localStorage.setItem(
        "timingKeys",
        JSON.stringify({ start: "KeyQ", end: "Digit1", redo: "NumpadEnter" }),
      );
      localStorage.setItem("timingKeyLabels", JSON.stringify({ KeyQ: "A", Digit1: "&" }));
      setActivePinia(createPinia());

      expect(useSettingsStore().timingKeys).toEqual({
        ...DEFAULT_TIMING_KEYS,
        start: { key: "a", code: "KeyQ" },
        end: { key: "&", code: "Digit1" },
        redo: { key: "Enter" },
      });
    });

    test("reads a key saved by position without a label as what it types on QWERTY", () => {
      localStorage.setItem("timingKeys", JSON.stringify({ start: "KeyJ", end: "Slash" }));
      setActivePinia(createPinia());

      expect(useSettingsStore().timingKeys).toMatchObject({
        start: { key: "j", code: "KeyJ" },
        end: { key: "/", code: "Slash" },
      });
    });

    test("saves the migrated keys and drops the old labels", () => {
      localStorage.setItem("timingKeys", JSON.stringify({ start: "KeyQ" }));
      localStorage.setItem("timingKeyLabels", JSON.stringify({ KeyQ: "A" }));
      setActivePinia(createPinia());
      useSettingsStore();

      expect(JSON.parse(localStorage.getItem("timingKeys")!)).toMatchObject({
        start: { key: "a", code: "KeyQ" },
      });
      expect(localStorage.getItem("timingKeyLabels")).toBeNull();
    });

    test("resetTimingKeys restores the defaults", () => {
      const store = useSettingsStore();
      store.setTimingKey("end", { key: "b", code: "KeyB" });
      store.setTimingKey("zoomIn", { key: "a", code: "KeyQ" });

      store.resetTimingKeys();

      expect(store.timingKeys).toEqual(DEFAULT_TIMING_KEYS);
    });

    test("resetSettings restores the defaults", () => {
      const store = useSettingsStore();
      store.setTimingKey("end", { key: "b", code: "KeyB" });

      store.resetSettings();

      expect(store.timingKeys).toEqual(DEFAULT_TIMING_KEYS);
    });
  });
});
