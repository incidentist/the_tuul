import { describe, expect, test } from "vitest";
import yaml from "js-yaml";
import Color from "buefy/src/utils/color";
import {
  parseSettingsYaml,
  serializeSettingsYaml,
  readSubtitleHints,
  serializeSubtitleSettings,
  SettingsFileSource,
} from "./settingsFile";
import { VerticalAlignment } from "./timing";
import type { VideoSettings } from "@/stores/settings";
import { BACKING_VOCALS_HQ_SEPARATOR_MODEL, NO_VOCALS_SEPARATOR_MODEL } from "@/stores/media";

// A file shaped exactly like the one the Submit tab exports.
const EXPORTED_FILE = yaml.dump({
  song: {
    title: "Bohemian Rhapsody",
    artist: "Queen",
    duration: 354.2,
    youtubeUrl: "https://youtu.be/fJ9rUzIMcZQ",
  },
  separationModel: NO_VOCALS_SEPARATOR_MODEL,
  videoOptions: {
    addTitleScreen: false,
    countInMode: "line",
    countInText: "1 2 3 ",
    countInThreshold: 6.5,
    countInDuration: 1.5,
    instrumentalThreshold: 8,
    addStaggeredLines: true,
    useStoredDisplayPeriods: false,
    useBackground: true,
    outputFormat: "mkv",
    verticalAlignment: VerticalAlignment.Top,
    lineSpacing: 1.381,
    topMargin: 0,
    outlineWidth: 2.5,
    shadowX: -1,
    shadowY: 2,
    font: { size: 30, name: "Impact" },
    color: {
      background: "#111111",
      primary: "#222222",
      secondary: "#333333",
      outline: "#444444",
      shadow: "#555555",
    },
  },
  voiceStyles: {
    Anna: {
      fontName: "Georgia",
      fontSize: 26,
      bold: true,
      primary: "#abcdef",
      outlineWidth: 0,
      shadowY: -3,
      shadow: "#fedcba",
    },
  },
});

describe("parseSettingsYaml", () => {
  test("reads back an exported settings file", () => {
    const parsed = parseSettingsYaml(EXPORTED_FILE);

    expect(parsed.warnings).toEqual([]);
    expect(parsed.song).toEqual({
      title: "Bohemian Rhapsody",
      artist: "Queen",
      duration: 354.2,
      youtubeUrl: "https://youtu.be/fJ9rUzIMcZQ",
    });
    expect(parsed.separationModel).toBe(NO_VOCALS_SEPARATOR_MODEL);

    expect(parsed.videoOptions.addTitleScreen).toBe(false);
    expect(parsed.videoOptions.countInMode).toBe("line");
    expect(parsed.videoOptions.countInText).toBe("1 2 3 ");
    expect(parsed.videoOptions.countInThreshold).toBe(6.5);
    expect(parsed.videoOptions.countInDuration).toBe(1.5);
    expect(parsed.videoOptions.instrumentalThreshold).toBe(8);
    expect(parsed.videoOptions.addStaggeredLines).toBe(true);
    expect(parsed.videoOptions.useStoredDisplayPeriods).toBe(false);
    expect(parsed.videoOptions.useBackground).toBe(true);
    expect(parsed.videoOptions.outputFormat).toBe("mkv");
    expect(parsed.videoOptions.verticalAlignment).toBe(VerticalAlignment.Top);
    expect(parsed.videoOptions.lineSpacing).toBe(1.381);
    expect(parsed.videoOptions.topMargin).toBe(0);
    expect(parsed.videoOptions.outlineWidth).toBe(2.5);
    expect(parsed.videoOptions.shadowX).toBe(-1);
    expect(parsed.videoOptions.shadowY).toBe(2);
    expect(parsed.videoOptions.font).toEqual({ size: 30, name: "Impact" });
    expect(parsed.videoOptions.color?.background).toBeInstanceOf(Color);
    expect(parsed.videoOptions.color?.background.toString()).toBe("#111111");
    expect(parsed.videoOptions.color?.primary.toString()).toBe("#222222");
    expect(parsed.videoOptions.color?.secondary.toString()).toBe("#333333");
    expect(parsed.videoOptions.color?.outline.toString()).toBe("#444444");
    expect(parsed.videoOptions.color?.shadow.toString()).toBe("#555555");

    const anna = parsed.voiceStyles?.Anna;
    expect(anna?.fontName).toBe("Georgia");
    expect(anna?.fontSize).toBe(26);
    expect(anna?.bold).toBe(true);
    expect(anna?.primary).toBeInstanceOf(Color);
    expect(anna?.primary?.toString()).toBe("#abcdef");
    expect(anna?.outlineWidth).toBe(0);
    expect(anna?.shadowY).toBe(-3);
    expect(anna?.shadow?.toString()).toBe("#fedcba");
  });

  test("skips a negative outline width", () => {
    const parsed = parseSettingsYaml(
      yaml.dump({
        videoOptions: { outlineWidth: -1 },
        voiceStyles: { Anna: { outlineWidth: -2 } },
      }),
    );

    expect(parsed.videoOptions.outlineWidth).toBeUndefined();
    expect(parsed.voiceStyles?.Anna.outlineWidth).toBeUndefined();
    expect(parsed.warnings.join("\n")).toContain("videoOptions.outlineWidth");
    expect(parsed.warnings.join("\n")).toContain("voiceStyles.Anna.outlineWidth");
  });

  test("only reports the settings the file mentions", () => {
    const parsed = parseSettingsYaml("videoOptions:\n  countInMode: none\n");

    expect(parsed.warnings).toEqual([]);
    expect(parsed.videoOptions).toEqual({ countInMode: "none" });
    expect(parsed.song).toEqual({});
    expect(parsed.separationModel).toBeUndefined();
    expect(parsed.backingTrack).toBeUndefined();
    expect(parsed.voiceStyles).toBeUndefined();
  });

  test("ignores count-in times that are not positive numbers", () => {
    const parsed = parseSettingsYaml(
      "videoOptions:\n  countInThreshold: 0\n  countInDuration: soon\n",
    );

    expect(parsed.videoOptions.countInThreshold).toBeUndefined();
    expect(parsed.videoOptions.countInDuration).toBeUndefined();
    expect(parsed.warnings.join("\n")).toContain("videoOptions.countInThreshold");
    expect(parsed.warnings.join("\n")).toContain("videoOptions.countInDuration");
  });

  test("reads the count-in mode a pre-line-mode file expresses as a boolean", () => {
    expect(parseSettingsYaml("videoOptions:\n  addCountIns: true\n").videoOptions.countInMode).toBe(
      "screen",
    );
    const off = parseSettingsYaml("videoOptions:\n  addCountIns: false\n");
    expect(off.warnings).toEqual([]);
    expect(off.videoOptions.countInMode).toBe("none");
  });

  test("reads the title screen settings, and skips a length that is not positive", () => {
    const parsed = parseSettingsYaml(
      'videoOptions:\n  showTitle: false\n  titleScreenDuration: 0\n  titleStyle: { fontSize: 30, primary: "#112233" }\n',
    );
    const { showTitle, titleScreenDuration, titleStyle } = parsed.videoOptions;

    expect([showTitle, titleScreenDuration]).toEqual([false, undefined]);
    expect(titleStyle?.fontSize).toBe(30);
    expect(titleStyle?.primary?.toString()).toBe("#112233");
    expect(parsed.warnings.join("\n")).toContain("videoOptions.titleScreenDuration");
  });

  test("reads an empty title style, which draws the title like the lyrics", () => {
    const parsed = parseSettingsYaml("videoOptions:\n  titleStyle: {}\n");

    expect(parsed.warnings).toEqual([]);
    expect(parsed.videoOptions).toEqual({ titleStyle: {} });
  });

  test("skips a negative instrumental threshold", () => {
    const parsed = parseSettingsYaml("videoOptions:\n  instrumentalThreshold: -1\n");
    expect(parsed.videoOptions.instrumentalThreshold).toBeUndefined();
    expect(parsed.warnings.join("\n")).toContain("videoOptions.instrumentalThreshold");
  });

  test("reads the gap restore settings, and skips a negative margin", () => {
    const parsed = parseSettingsYaml(
      "videoOptions:\n  restoreGaps: false\n  restorePausesInLines: true\n" +
        "  gapPreRoll: 0\n  gapPostRoll: 2\n  gapMinLength: 4\n  gapFade: -1\n",
    );
    expect(parsed.videoOptions).toMatchObject({
      restoreGaps: false,
      restorePausesInLines: true,
      gapPreRoll: 0,
      gapPostRoll: 2,
      gapMinLength: 4,
    });
    expect(parsed.videoOptions.gapFade).toBeUndefined();
    expect(parsed.warnings).toEqual([
      "videoOptions.gapFade: expected a number of seconds, or zero, ignoring -1",
    ]);
  });

  test("reads a pre-roll down to the lead allowed, and a level balance from 0 to 1", () => {
    expect(
      parseSettingsYaml("videoOptions:\n  gapPreRoll: -0.2\n  gapLevelBalance: 0.5\n").videoOptions,
    ).toMatchObject({ gapPreRoll: -0.2, gapLevelBalance: 0.5 });

    const parsed = parseSettingsYaml("videoOptions:\n  gapPreRoll: -0.5\n  gapLevelBalance: 2\n");
    expect(parsed.videoOptions.gapPreRoll).toBeUndefined();
    expect(parsed.videoOptions.gapLevelBalance).toBeUndefined();
    expect(parsed.warnings).toEqual([
      "videoOptions.gapPreRoll: expected a number at least -0.2, ignoring -0.5",
      "videoOptions.gapLevelBalance: expected a number from 0 to 1, ignoring 2",
    ]);
  });

  test("accepts named vertical alignments for hand-written files", () => {
    expect(
      parseSettingsYaml("videoOptions:\n  verticalAlignment: bottom\n").videoOptions
        .verticalAlignment,
    ).toBe(VerticalAlignment.Bottom);
    expect(
      parseSettingsYaml("videoOptions:\n  verticalAlignment: Top\n").videoOptions.verticalAlignment,
    ).toBe(VerticalAlignment.Top);
  });

  test("ignores a line spacing or top margin out of range", () => {
    const parsed = parseSettingsYaml("videoOptions:\n  lineSpacing: 0\n  topMargin: -1\n");
    expect(parsed.videoOptions.lineSpacing).toBeUndefined();
    expect(parsed.videoOptions.topMargin).toBeUndefined();
    expect(parsed.warnings).toEqual([
      "videoOptions.lineSpacing: expected a multiple of the font size above zero, ignoring 0",
      "videoOptions.topMargin: expected a multiple of the font size of zero or more, ignoring -1",
    ]);
  });

  test("accepts the separation model under the store field name too", () => {
    const parsed = parseSettingsYaml(
      `videoOptions:\n  vocalSeparationModel: ${BACKING_VOCALS_HQ_SEPARATOR_MODEL}\n`,
    );

    expect(parsed.warnings).toEqual([]);
    expect(parsed.separationModel).toBe(BACKING_VOCALS_HQ_SEPARATOR_MODEL);
    expect(parsed.videoOptions.vocalSeparationModel).toBe(BACKING_VOCALS_HQ_SEPARATOR_MODEL);
  });

  test("skips entries of the wrong type and reports them", () => {
    const parsed = parseSettingsYaml(
      [
        "videoOptions:",
        "  countInMode: sometimes",
        "  font:",
        "    size: large",
        "    name: Impact",
        "  color:",
        "    primary: not-a-color",
        '    secondary: "#00ff00"',
      ].join("\n"),
    );

    expect(parsed.videoOptions.countInMode).toBeUndefined();
    expect(parsed.videoOptions.font).toEqual({ name: "Impact" });
    expect(parsed.videoOptions.color?.primary).toBeUndefined();
    expect(parsed.videoOptions.color?.secondary.toString()).toBe("#00ff00");
    expect(parsed.warnings).toHaveLength(3);
    expect(parsed.warnings.join("\n")).toContain("videoOptions.countInMode");
    expect(parsed.warnings.join("\n")).toContain("videoOptions.font.size");
    expect(parsed.warnings.join("\n")).toContain("videoOptions.color.primary");
  });

  test("reports unknown settings instead of silently dropping them", () => {
    const parsed = parseSettingsYaml("videoOptions:\n  addCountIn: true\nnonsense: 1\n");

    expect(parsed.videoOptions).toEqual({});
    expect(parsed.warnings).toEqual([
      "nonsense: unknown setting, ignoring it",
      "videoOptions.addCountIn: unknown setting, ignoring it",
    ]);
  });

  test("rejects an output format no muxer is wired up for", () => {
    const parsed = parseSettingsYaml("videoOptions:\n  outputFormat: avi\n");

    expect(parsed.videoOptions.outputFormat).toBeUndefined();
    expect(parsed.warnings).toEqual([
      'videoOptions.outputFormat: expected mp4 or mkv, ignoring "avi"',
    ]);
  });

  test.each([["1080p"], ["1080P"], [1080]])("reads the resolution %j", (value) => {
    const parsed = parseSettingsYaml(`videoOptions:\n  resolution: ${value}\n`);

    expect(parsed.videoOptions.resolution).toBe("1080p");
    expect(parsed.warnings).toEqual([]);
  });

  test("reads the background switch under its older name", () => {
    const parsed = parseSettingsYaml("videoOptions:\n  useBackgroundVideo: true\n");

    expect(parsed.videoOptions.useBackground).toBe(true);
    expect(parsed.warnings).toEqual([]);
  });

  test("prefers the background switch's current name to its older one", () => {
    const parsed = parseSettingsYaml(
      "videoOptions:\n  useBackground: false\n  useBackgroundVideo: true\n",
    );

    expect(parsed.videoOptions.useBackground).toBe(false);
  });

  test("rejects a background fit it does not know", () => {
    const parsed = parseSettingsYaml("videoOptions:\n  backgroundFit: stretch\n");

    expect(parsed.videoOptions.backgroundFit).toBeUndefined();
    expect(parsed.warnings).toEqual([
      'videoOptions.backgroundFit: expected fill or fit, ignoring "stretch"',
    ]);
  });

  test("rejects a resolution the render does not offer", () => {
    const parsed = parseSettingsYaml(
      "videoOptions:\n  resolution: 4k\n  frameRate: 60\n  quality: lossless\n",
    );

    expect(parsed.videoOptions.resolution).toBeUndefined();
    expect(parsed.videoOptions.frameRate).toBeUndefined();
    expect(parsed.videoOptions.quality).toBeUndefined();
    expect(parsed.warnings).toEqual([
      'videoOptions.resolution: expected 720p or 1080p, ignoring "4k"',
      "videoOptions.frameRate: expected 20 or 30, ignoring 60",
      'videoOptions.quality: expected standard or high, ignoring "lossless"',
    ]);
  });

  test("rejects an unknown separation model", () => {
    const parsed = parseSettingsYaml("separationModel: some_other_model.ckpt\n");

    expect(parsed.separationModel).toBeUndefined();
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain("unknown separation model");
  });

  test("skips voice styles that are not mappings", () => {
    const parsed = parseSettingsYaml("voiceStyles:\n  Anna: Impact\n  Ben:\n    italic: true\n");

    expect(parsed.voiceStyles).toEqual({ Ben: { italic: true } });
    expect(parsed.warnings).toEqual(["voiceStyles.Anna: expected a mapping, ignoring it"]);
  });

  test("reads the backing track from a model or an uploaded file, and ignores any other", () => {
    expect(parseSettingsYaml("backingTrack: file:backing/Demucs.wav\n").backingTrack).toBe(
      "file:backing/Demucs.wav",
    );
    expect(parseSettingsYaml(`backingTrack: ${NO_VOCALS_SEPARATOR_MODEL}\n`).backingTrack).toBe(
      NO_VOCALS_SEPARATOR_MODEL,
    );
    const unknown = parseSettingsYaml("backingTrack: mystery.onnx\n");

    expect(unknown.backingTrack).toBeUndefined();
    expect(unknown.warnings.join("\n")).toContain("backingTrack");
  });

  test("throws on a file that is not a settings mapping", () => {
    expect(() => parseSettingsYaml("")).toThrow(/empty/);
    expect(() => parseSettingsYaml("- one\n- two\n")).toThrow(/mapping/);
    expect(() => parseSettingsYaml("videoOptions: [unclosed\n")).toThrow(/Could not parse/);
  });
});

describe("serializeSettingsYaml", () => {
  const source: SettingsFileSource = {
    song: { title: "Bohemian Rhapsody", artist: "Queen", duration: 354.2, youtubeUrl: null },
    separationModel: BACKING_VOCALS_HQ_SEPARATOR_MODEL,
    backingTrack: NO_VOCALS_SEPARATOR_MODEL,
    backgroundVideoOffset: -0.25,
    hintNote: "F#3",
    videoOptions: {
      vocalSeparationModel: NO_VOCALS_SEPARATOR_MODEL,
      addTitleScreen: false,
      titleScreenDuration: 5.5,
      showTitle: false,
      titleStyle: { fontName: "Georgia", primary: Color.parse("#123456"), shadowX: 2 },
      countInMode: "line",
      countInText: "1 2 3 ",
      dynamicCountIns: false,
      countInThreshold: 6.5,
      countInDuration: 1.5,
      instrumentalThreshold: 8,
      addStaggeredLines: true,
      useBackground: true,
      backgroundFit: "fit",
      outputFormat: "mkv",
      resolution: "720p",
      frameRate: 20,
      quality: "high",
      verticalAlignment: VerticalAlignment.Top,
      font: { size: 30, name: "Impact", bold: false, italic: true },
      color: {
        background: Color.parse("#111111"),
        primary: Color.parse("#222222"),
        secondary: Color.parse("#333333"),
        outline: Color.parse("#444444"),
        shadow: Color.parse("#555555"),
      },
      outlineWidth: 2,
      shadowX: 1,
      shadowY: -1,
    } as VideoSettings,
    voiceStyles: { Anna: { fontSize: 26, primary: Color.parse("#abcdef") }, Ben: {} },
  };

  test("writes a file that reads back to the same settings", () => {
    const parsed = parseSettingsYaml(serializeSettingsYaml(source));

    expect(parsed.warnings).toEqual([]);
    expect(parsed.song).toEqual({ title: "Bohemian Rhapsody", artist: "Queen", duration: 354.2 });
    expect(parsed.separationModel).toBe(BACKING_VOCALS_HQ_SEPARATOR_MODEL);
    expect(parsed.videoOptions.countInText).toBe("1 2 3 ");
    expect(parsed.videoOptions.font).toEqual({
      size: 30,
      name: "Impact",
      bold: false,
      italic: true,
    });
    expect(parsed.videoOptions.color?.primary.toString()).toBe("#222222");
    expect(parsed.videoOptions.color?.shadow.toString()).toBe("#555555");
    expect(parsed.videoOptions.outlineWidth).toBe(2);
    expect(parsed.videoOptions.shadowY).toBe(-1);
    expect(parsed.videoOptions.resolution).toBe("720p");
    expect(parsed.videoOptions.frameRate).toBe(20);
    expect(parsed.videoOptions.quality).toBe("high");
    expect(parsed.videoOptions.backgroundFit).toBe("fit");
    expect(Object.keys(parsed.voiceStyles ?? {})).toEqual(["Anna"]);
    expect(parsed.voiceStyles?.Anna.primary?.toString()).toBe("#abcdef");
  });

  test("writes the picked separation model at the top level only", () => {
    const document = yaml.load(serializeSettingsYaml(source)) as Record<string, any>;

    expect(document.separationModel).toBe(BACKING_VOCALS_HQ_SEPARATOR_MODEL);
    expect(document.videoOptions).not.toHaveProperty("vocalSeparationModel");
  });

  test("writes the backing track the video renders with, and leaves it out while there is none", () => {
    expect(parseSettingsYaml(serializeSettingsYaml(source)).backingTrack).toBe(
      NO_VOCALS_SEPARATOR_MODEL,
    );
    const withoutTracks = yaml.load(serializeSettingsYaml({ ...source, backingTrack: null }));

    expect(withoutTracks).not.toHaveProperty("backingTrack");
  });

  test("writes the background video's offset, and leaves it out while it is zero", () => {
    expect(parseSettingsYaml(serializeSettingsYaml(source)).backgroundVideoOffset).toBe(-0.25);
    const unmoved = yaml.load(serializeSettingsYaml({ ...source, backgroundVideoOffset: 0 }));

    expect(unmoved).not.toHaveProperty("backgroundVideoOffset");
  });

  test("writes the hint note, and leaves it out while there is none", () => {
    expect(parseSettingsYaml(serializeSettingsYaml(source)).hintNote).toBe("F#3");
    const silent = yaml.load(serializeSettingsYaml({ ...source, hintNote: null }));

    expect(silent).not.toHaveProperty("hintNote");
  });

  test("reads an unquoted frequency as the hint note", () => {
    expect(parseSettingsYaml("hintNote: 432\n").hintNote).toBe("432");
  });

  test("ignores a hint note it can't play, with a warning", () => {
    const parsed = parseSettingsYaml("hintNote: A7\n");

    expect(parsed).not.toHaveProperty("hintNote");
    expect(parsed.warnings.join("\n")).toContain("hintNote");
  });
});

describe("serializeSubtitleSettings", () => {
  const source: SettingsFileSource = {
    song: { title: "Humanised", artist: "Sola Rosa", duration: 211.14, youtubeUrl: null },
    separationModel: BACKING_VOCALS_HQ_SEPARATOR_MODEL,
    backingTrack: NO_VOCALS_SEPARATOR_MODEL,
    backgroundVideoOffset: 0,
    hintNote: null,
    videoOptions: {
      addTitleScreen: true,
      titleScreenDuration: 4,
      showTitle: true,
      titleStyle: {},
      countInMode: "line",
      countInText: "",
      instrumentalThreshold: 5.6,
      verticalAlignment: VerticalAlignment.Middle,
      useBackground: false,
      backgroundFit: "fill",
      outputFormat: "mkv",
      resolution: "1080p",
      frameRate: 30,
      quality: "standard",
      font: { size: 33, name: "Verdana" },
      color: {
        background: Color.parse("#000000"),
        primary: Color.parse("#7e06ee"),
        secondary: Color.parse("#ffffff"),
        outline: Color.parse("#000000"),
        shadow: Color.parse("#000000"),
      },
    } as VideoSettings,
    voiceStyles: {},
  };

  test("writes one line with the settings the subtitles can't show, and hints for the ones they may not", () => {
    const line = serializeSubtitleSettings(source);

    expect(line).not.toContain("\n");
    expect(yaml.load(line)).toEqual({
      song: { duration: 211.14 },
      separationModel: BACKING_VOCALS_HQ_SEPARATOR_MODEL,
      backingTrack: NO_VOCALS_SEPARATOR_MODEL,
      videoOptions: {
        useBackground: false,
        backgroundFit: "fill",
        outputFormat: "mkv",
        resolution: "1080p",
        frameRate: 30,
        quality: "standard",
        color: { background: "#000000" },
        addTitleScreen: true,
        titleScreenDuration: 4,
        showTitle: true,
        countInMode: "line",
        countInText: "",
        instrumentalThreshold: 5.6,
      },
    });
    expect(readSubtitleHints(line)).toEqual({
      addTitleScreen: true,
      titleScreenDuration: 4,
      showTitle: true,
      countInMode: "line",
      countInText: "",
      instrumentalThreshold: 5.6,
    });
  });

  test("writes the title and artist when no title screen shows them", () => {
    const untitled = {
      ...source,
      videoOptions: { ...source.videoOptions, addTitleScreen: false },
    };

    expect(yaml.load(serializeSubtitleSettings(untitled))).toMatchObject({
      song: { title: "Humanised", artist: "Sola Rosa", duration: 211.14 },
    });
  });
});
