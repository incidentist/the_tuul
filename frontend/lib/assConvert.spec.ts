import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import BuefyColor from "buefy/src/utils/color";
import {
  AssImport,
  assToProjectFiles,
  DELAY_UNKNOWN,
  FORMATTING_DROPPED,
  PROJECT_SETTINGS_UNREADABLE,
  RENDERED_EFFECTS,
  SCREENS_GUESSED,
  TEMPLATE_LINES_DROPPED,
  UNTIMED_LINES,
} from "./assConvert";
import { MARKUP_REMOVED } from "./importWarnings";
import { parseSettingsYaml } from "./settingsFile";
import {
  createMultiVoiceAssFile,
  DEFAULT_KARAOKE_OPTIONS,
  KaraokeOptions,
  VerticalAlignment,
} from "./timing";
import { FontLibrary } from "./textWidth";
import { TimedSegment } from "./timedSegments";

const FONTS = ["Arial Narrow", "Georgia"];
const SONG_DURATION = 60;

function ass(
  events: string[],
  styles: string[] = ["Style: Default,Georgia,20"],
  info = "",
): string {
  return [
    "[Script Info]",
    info,
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Outline",
    ...styles,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
  ].join("\n");
}

function render(tracks: { voice: string; segments: TimedSegment[] }[], options: KaraokeOptions) {
  return createMultiVoiceAssFile(
    tracks.map((track) => ({ ...track, options })),
    SONG_DURATION,
    "Pale Moon",
    "The Placeholders",
  );
}

function roundTrip(tracks: { voice: string; segments: TimedSegment[] }[], options: KaraokeOptions) {
  return assToProjectFiles(render(tracks, options), { fonts: FONTS });
}

/**
 * The file the imported project renders, on default settings overridden by the imported ones.
 */
function rerender(imported: AssImport): string {
  const { videoOptions } = parseSettingsYaml(imported.settings);
  const options = {
    ...DEFAULT_KARAOKE_OPTIONS,
    ...videoOptions,
    font: { ...DEFAULT_KARAOKE_OPTIONS.font, ...videoOptions.font },
    color: { ...DEFAULT_KARAOKE_OPTIONS.color, ...videoOptions.color },
  };
  const tracks = Object.entries(imported.timings).map(([voice, segments]) => ({ voice, segments }));
  return render(tracks, options);
}

describe("assToProjectFiles on the app's own files", () => {
  // Every line ends on a release, which the writer keeps as a gap before the next line.
  const segments: TimedSegment[] = [
    { text: "Hel/", start: 10 },
    { text: "lo_", start: 10.5 },
    { text: "moon\n", start: 11, end: 12 },
    { text: "Bright_", start: 13 },
    { text: "night\n\n", start: 13.5, end: 14.5 },
    { text: "After_", start: 30 },
    { text: "the_", start: 30.5, end: 30.8 },
    { text: "break", start: 31, end: 32 },
  ];

  it("drops the title screen, count-ins and instrumental screens", () => {
    const imported = roundTrip([{ voice: "Voice 1", segments }], DEFAULT_KARAOKE_OPTIONS);

    expect(imported.lyrics).toBe("Hel/lo_moon\nBright_night\n\nAfter_the_break");
    expect(imported.timings).toEqual({ "Voice 1": segments });
    expect(imported.warnings).toEqual([]);
    const settings = yaml.load(imported.settings) as Record<string, any>;
    expect(settings.song).toEqual({ title: "Pale Moon", artist: "The Placeholders" });
    expect(settings.videoOptions.font).toMatchObject({ name: "Arial Narrow", size: 20 });
    expect(settings.videoOptions.color).toMatchObject({ primary: "#FF00FF", secondary: "#00FFFF" });
  });

  it("drops a title screen that sweeps, as older versions wrote it", () => {
    const text = render([{ voice: "Voice 1", segments }], DEFAULT_KARAOKE_OPTIONS)
      .replace(/(?<=[,}])Pale Moon$/m, "{\\k0}{\\kf200}Pale Moon")
      .replace(/(?<=[,}])The Placeholders$/m, "{\\k200}{\\kf200}The Placeholders");
    expect(text).toContain("{\\kf200}The Placeholders");

    const imported = assToProjectFiles(text, { fonts: FONTS });
    expect(imported.timings).toEqual({ "Voice 1": segments });
    const settings = yaml.load(imported.settings) as Record<string, any>;
    expect(settings.song).toEqual({ title: "Pale Moon", artist: "The Placeholders" });
  });

  it("reads the title's own style back", () => {
    const options = {
      ...DEFAULT_KARAOKE_OPTIONS,
      titleStyle: {
        fontName: "Georgia",
        fontSize: 30,
        primary: BuefyColor.parse("#112233"),
        outlineWidth: 2,
        shadowX: 1,
      },
    };
    const text = render([{ voice: "Voice 1", segments }], options);
    const imported = assToProjectFiles(text, { fonts: FONTS });
    const { titleStyle } = parseSettingsYaml(imported.settings).videoOptions;

    expect(imported.warnings).toEqual([]);
    expect(titleStyle).toMatchObject({ fontName: "Georgia", fontSize: 30, outlineWidth: 2 });
    expect(titleStyle?.primary?.toString()).toBe("#112233");
    expect([titleStyle?.shadowX, titleStyle?.shadowY]).toEqual([1, undefined]);
    expect(rerender(imported)).toBe(text);
  });

  it("keeps the timings of a blank title screen in the song's time", () => {
    const early = segments.map((segment) => ({
      ...segment,
      start: (segment.start as number) - 8,
      ...(segment.end ? { end: segment.end - 8 } : {}),
    }));
    const options = { ...DEFAULT_KARAOKE_OPTIONS, showTitle: false, titleScreenDuration: 6 };
    const settings = yaml.dump(
      { videoOptions: { addTitleScreen: true, showTitle: false, titleScreenDuration: 6 } },
      { flowLevel: 0 },
    );
    const text = createMultiVoiceAssFile(
      [{ voice: "Voice 1", segments: early, options }],
      SONG_DURATION,
      "Pale Moon",
      "The Placeholders",
      new FontLibrary(),
      settings.trim(),
    );
    const imported = assToProjectFiles(text, { fonts: FONTS });

    expect(text).toContain("Audio Delay: 6.000");
    expect(text).not.toContain("Pale Moon");
    expect(imported.timings).toEqual({ "Voice 1": early });
    expect(parseSettingsYaml(imported.settings).videoOptions).toMatchObject({
      addTitleScreen: true,
      showTitle: false,
      titleScreenDuration: 6,
    });
  });

  it("moves the timings back by the delay the title screen and a quick start added", () => {
    const early = segments.map((segment) => ({
      ...segment,
      start: (segment.start as number) - 9.5,
      ...(segment.end ? { end: segment.end - 9.5 } : {}),
    }));
    const text = createMultiVoiceAssFile(
      [{ voice: "Voice 1", segments: early, options: DEFAULT_KARAOKE_OPTIONS }],
      SONG_DURATION,
      "Pale Moon",
      "The Placeholders",
    );
    expect(text).toMatch(/^Audio Delay: [1-9]/m);

    expect(assToProjectFiles(text, { fonts: FONTS }).timings).toEqual({ "Voice 1": early });
  });

  it("warns that a file older than its Audio Delay field may be late", () => {
    const text = createMultiVoiceAssFile(
      [{ voice: "Voice 1", segments, options: DEFAULT_KARAOKE_OPTIONS }],
      SONG_DURATION,
      "Pale Moon",
      "The Placeholders",
    ).replace(/^Audio Delay: .*\n/m, "");

    const imported = assToProjectFiles(text, { fonts: FONTS });
    expect(imported.warnings).toEqual([DELAY_UNKNOWN]);
    expect(imported.timings).toEqual({ "Voice 1": segments });
  });

  it("drops fixed count-ins too", () => {
    const options = { ...DEFAULT_KARAOKE_OPTIONS, dynamicCountIns: false, countInText: "♪" };
    const imported = roundTrip([{ voice: "Voice 1", segments }], options);
    expect(imported.timings).toEqual({ "Voice 1": segments });
  });

  describe("fits the settings and display periods", () => {
    const options: KaraokeOptions = {
      ...DEFAULT_KARAOKE_OPTIONS,
      countInMode: "line",
      countInText: "•••",
      countInThreshold: 1.9,
      instrumentalThreshold: 5.5,
      verticalAlignment: VerticalAlignment.Top,
      lineSpacing: 1.8,
      topMargin: 1.2,
      shadowX: 1,
      shadowY: -1,
    };

    it("that reproduce the file", () => {
      const text = render([{ voice: "Voice 1", segments }], options);
      const imported = assToProjectFiles(text, { fonts: FONTS });

      expect(imported.warnings).toEqual([]);
      expect(rerender(imported)).toBe(text);
      expect(yaml.load(imported.settings)).toMatchObject({
        videoOptions: {
          countInMode: "line",
          countInText: "•••",
          countInThreshold: 1.9,
          verticalAlignment: VerticalAlignment.Top,
          lineSpacing: 1.8,
          topMargin: 1.2,
          shadowX: 1,
          shadowY: -1,
        },
      });
    });

    it("but leaves out the ones the file doesn't show", () => {
      const imported = roundTrip([{ voice: "Voice 1", segments }], options);
      const { videoOptions } = yaml.load(imported.settings) as Record<string, any>;
      // Dynamic count-ins last the threshold, whatever the duration.
      expect(videoOptions).not.toHaveProperty("countInDuration");
      expect(videoOptions).not.toHaveProperty("useStoredDisplayPeriods");
    });

    it("keeping only the display periods the automatic ones don't give", () => {
      const stored = segments.map((segment) =>
        segment.text === "Bright_" ? { ...segment, displayStart: 12.2 } : segment,
      );
      const text = render([{ voice: "Voice 1", segments: stored }], options);
      const imported = assToProjectFiles(text, { fonts: FONTS });

      expect(imported.timings).toEqual({ "Voice 1": stored });
      expect(rerender(imported)).toBe(text);
      expect(yaml.load(imported.settings)).toMatchObject({
        videoOptions: { useStoredDisplayPeriods: true },
      });
    });

    it("with the page breaks and spacers that put each line at its height", () => {
      const spaced: TimedSegment[] = [
        { text: "Hel/", start: 10 },
        { text: "lo_", start: 10.5 },
        { text: "moon\n", start: 11, end: 12 },
        { text: "Bright_", start: 13 },
        { text: "night\n\n", start: 13.5, end: 14.5 },
        { text: "After_", start: 15.5, spacersBefore: 2 },
        { text: "the_", start: 16, end: 16.3 },
        { text: "break", start: 16.5, end: 17.5 },
      ];
      const text = render([{ voice: "Voice 1", segments: spaced }], DEFAULT_KARAOKE_OPTIONS);
      const imported = assToProjectFiles(text, { fonts: FONTS });

      expect(imported.lyrics).toBe("Hel/lo_moon\nBright_night\n\n/\n/\nAfter_the_break");
      expect(rerender(imported)).toBe(text);
    });
  });

  describe("reads back the settings the subtitles can't show", () => {
    const withSettings = (settings: string) =>
      createMultiVoiceAssFile(
        [{ voice: "Voice 1", segments, options: DEFAULT_KARAOKE_OPTIONS }],
        SONG_DURATION,
        "Pale Moon",
        "The Placeholders",
        new FontLibrary(),
        settings,
      );

    it("but not a hint the subtitles contradict", () => {
      const text = withSettings(
        "{song: {title: Other, duration: 61.5}, separationModel: x.ckpt, " +
          "videoOptions: {resolution: 1080p, countInMode: none, color: {background: '#123456', primary: '#000000'}}}",
      );
      expect(text).toMatch(/^Project Settings: \{/m);

      const imported = assToProjectFiles(text, { fonts: FONTS });
      const settings = yaml.load(imported.settings) as Record<string, any>;
      expect(imported.warnings).toEqual([]);
      expect(settings.song).toEqual({
        title: "Pale Moon",
        artist: "The Placeholders",
        duration: 61.5,
      });
      expect(settings.separationModel).toBe("x.ckpt");
      expect(settings.videoOptions).toMatchObject({
        resolution: "1080p",
        color: { background: "#123456", primary: "#FF00FF" },
      });
      expect(settings.videoOptions.countInMode).not.toBe("none");
    });

    it("with the hints the subtitles can't tell from other values", () => {
      const text = withSettings(
        "{videoOptions: {topMargin: 1.2, countInDuration: 0.5, instrumentalThreshold: 5.6}}",
      );

      const imported = assToProjectFiles(text, { fonts: FONTS });
      expect(yaml.load(imported.settings)).toMatchObject({
        videoOptions: { topMargin: 1.2, countInDuration: 0.5, instrumentalThreshold: 5.6 },
      });
    });

    it("with a count-in text no gap is long enough to show whole", () => {
      // The first gap earns two marks of three, and the others one.
      const short: TimedSegment[] = [
        { text: "Hel/", start: 2.5 },
        { text: "lo\n", start: 3, end: 3.5 },
        { text: "moon", start: 4.5, end: 5.5 },
      ];
      const options = { ...DEFAULT_KARAOKE_OPTIONS, countInText: "•••" };
      const text = render([{ voice: "Voice 1", segments: short }], options);
      const settingsOf = (imported: AssImport) =>
        (yaml.load(imported.settings) as Record<string, any>).videoOptions;

      const unhinted = assToProjectFiles(text, { fonts: FONTS });
      expect(settingsOf(unhinted)).toMatchObject({ countInText: "••", countInThreshold: 2 });

      const hinted = assToProjectFiles(
        text.replace(
          /^Audio Delay: .*$/m,
          "$&\nProject Settings: {videoOptions: {countInText: •••, countInThreshold: 3}}",
        ),
        { fonts: FONTS },
      );
      expect(settingsOf(hinted)).toMatchObject({ countInText: "•••", countInThreshold: 3 });
      expect(rerender(hinted)).toBe(text);
    });

    it("and warns when they can't be read", () => {
      const imported = assToProjectFiles(withSettings("{unclosed"), { fonts: FONTS });
      expect(imported.warnings).toEqual([PROJECT_SETTINGS_UNREADABLE]);
    });
  });

  it("leaves open an end at the start of the next line", () => {
    const open: TimedSegment[] = [
      { text: "Hello_", start: 10 },
      { text: "moon\n", start: 10.5 },
      { text: "Bright_", start: 11.5 },
      { text: "night", start: 12, end: 13 },
    ];
    const imported = roundTrip([{ voice: "Voice 1", segments: open }], DEFAULT_KARAOKE_OPTIONS);
    expect(imported.timings).toEqual({ "Voice 1": open });
  });

  it("reads each voice back from the actor field, with its screens", () => {
    const anna: TimedSegment[] = [
      { text: "Hello_", start: 10 },
      { text: "world\n\n", start: 10.5, end: 11 },
      { text: "Again_", start: 30 },
      { text: "now", start: 30.5, end: 31 },
    ];
    const ben: TimedSegment[] = [
      { text: "Good/", start: 11.5 },
      { text: "bye\n\n", start: 12, end: 12.5 },
      { text: "Fine", start: 31.5, end: 32 },
    ];
    const options = {
      ...DEFAULT_KARAOKE_OPTIONS,
      font: { ...DEFAULT_KARAOKE_OPTIONS.font, name: "Georgia" },
    };
    const imported = roundTrip(
      [
        { voice: "Anna", segments: anna },
        { voice: "Ben", segments: ben },
      ],
      options,
    );

    expect(imported.lyrics).toBe(
      "[Anna] Hello_world\n[Ben] Good/bye\n\n[Anna] Again_now\n[Ben] Fine",
    );
    expect(imported.timings).toEqual({ Anna: anna, Ben: ben });
  });
});

describe("assToProjectFiles on lines too wide for the screen", () => {
  const options: KaraokeOptions = {
    ...DEFAULT_KARAOKE_OPTIONS,
    font: { ...DEFAULT_KARAOKE_OPTIONS.font, name: "Georgia", size: 30 },
  };
  const words = "Pale moon rising slow over the quiet hill, lanterns drifting home".split(" ");

  it("joins the rows the app wrote for a line of several syllables", () => {
    const segments: TimedSegment[] = words.map((word, i) => ({
      text: i < words.length - 1 ? word + "_" : word,
      start: 10 + i,
      ...(i === words.length - 1 ? { end: 10 + words.length } : {}),
    }));
    const text = render([{ voice: "Voice 1", segments }], options);
    expect(text).toContain("{wrap}");

    const imported = assToProjectFiles(text, { fonts: FONTS });
    expect(imported.timings).toEqual({ "Voice 1": segments });
    expect(imported.lyrics).toBe(words.join("_"));
  });

  it("joins a syllable a row started inside", () => {
    const segments: TimedSegment[] = [{ text: words.join(" "), start: 10, end: 20 }];
    const text = render([{ voice: "Voice 1", segments }], options);
    expect(text).toContain("{wrap in syllable}");

    const imported = assToProjectFiles(text, { fonts: FONTS });
    expect(imported.timings).toEqual({ "Voice 1": segments });
    expect(imported.lyrics).toBe(words.join(" "));
  });

  it("reads a title the app wrapped back whole", () => {
    const title = "The Long and Winding Title of a Song Nobody Could Fit on One Row";
    const segments: TimedSegment[] = [
      { text: "Pale_", start: 10 },
      { text: "moon", start: 11 },
    ];
    const text = createMultiVoiceAssFile(
      [{ voice: "Voice 1", segments, options }],
      SONG_DURATION,
      title,
      "The Placeholders",
    );
    expect(text).toContain("{wrap in syllable}");

    const imported = assToProjectFiles(text, { fonts: FONTS });
    expect((yaml.load(imported.settings) as any).song.title).toBe(title);
  });
});

describe("assToProjectFiles on other files", () => {
  it("imports the source lines of a karaoke template, without display periods", () => {
    const imported = assToProjectFiles(
      ass(
        [
          "Comment: 0,0:00:00.00,0:00:00.00,Default,,0,0,0,template pre-line all,{\\fad(300,200)}",
          "Comment: 0,0:00:10.00,0:00:11.00,Default,,0,0,0,karaoke,{\\k25}Hel{\\k25}lo {\\k20}{\\k30}moon",
          "Dialogue: 0,0:00:09.10,0:00:11.20,Default,,0,0,0,fx,{\\k90\\fad(300,200)}{\\k25}Hel{\\k25}lo {\\k20}{\\k30}moon",
        ],
        undefined,
        "Title: Pale Moon",
      ),
      { fonts: FONTS },
    );

    expect(imported.lyrics).toBe("Hel/lo_moon");
    expect(imported.timings).toEqual({
      "Voice 1": [
        { text: "Hel/", start: 10 },
        { text: "lo_", start: 10.25, end: 10.5 },
        { text: "moon", start: 10.7, end: 11 },
      ],
    });
    expect(imported.warnings).toEqual([TEMPLATE_LINES_DROPPED]);
    expect((yaml.load(imported.settings) as any).song).toEqual({ title: "Pale Moon" });
  });

  it("imports the commented-out source lines an effect tool left unmarked", () => {
    const imported = assToProjectFiles(
      ass([
        'Comment: 0,0:00:00.00,0:00:00.00,Default,,0,0,0,template line,!retime("line")!{\\k90}',
        "Comment: 0,0:00:10.00,0:00:11.00,Default,,0,0,0,,{\\k50}Pale {\\k50}moon",
        "Dialogue: 1,0:00:09.50,0:00:10.50,Default,,0,0,0,,{\\an5\\pos(100,20)}Pale",
        "Dialogue: 1,0:00:10.00,0:00:11.00,Default,,0,0,0,,{\\an5\\pos(140,20)}moon",
      ]),
      { fonts: FONTS },
    );

    expect(imported.lyrics).toBe("Pale_moon");
    expect(imported.timings["Voice 1"]).toEqual([
      { text: "Pale_", start: 10 },
      { text: "moon", start: 10.5, end: 11 },
    ]);
    expect(imported.warnings).toEqual([TEMPLATE_LINES_DROPPED]);
  });

  it("warns when most lines look like rendered effects", () => {
    const imported = assToProjectFiles(
      ass([
        "Dialogue: 1,0:00:09.50,0:00:10.50,Default,,0,0,0,,{\\an5\\pos(100,20)}Pale",
        "Dialogue: 1,0:00:10.00,0:00:11.00,Default,,0,0,0,,{\\an5\\move(140,20,140,10)}moon",
        "Dialogue: 0,0:00:12.00,0:00:13.00,Default,,0,0,0,,{\\pos(140,20)}A whole line",
      ]),
      { fonts: FONTS },
    );
    expect(imported.warnings).toContain(RENDERED_EFFECTS);
  });

  it("makes a voice of each style, and keeps a shown line's display period", () => {
    const imported = assToProjectFiles(
      ass(
        [
          "Dialogue: 0,0:00:01.00,0:00:03.00,Lead,,0,0,0,,{\\fad(100,100)}{\\k100}{\\k50}Sun",
          "Dialogue: 0,0:00:02.00,0:00:04.00,Back,,0,0,0,,{\\k100}{\\k50}Moon",
        ],
        [
          "Style: Lead,Georgia,20,&H000000FF,&H00FFFFFF",
          "Style: Back,Comic Sans,20,&H00FF0000,&H00FFFFFF",
        ],
      ),
      { fonts: FONTS },
    );

    expect(imported.lyrics).toBe("[Lead] Sun\n[Back] Moon");
    expect(imported.timings).toEqual({
      Lead: [{ text: "Sun", start: 2, end: 2.5, displayStart: 1, displayEnd: 3 }],
      Back: [{ text: "Moon", start: 3, end: 3.5, displayStart: 2, displayEnd: 4 }],
    });
    const settings = yaml.load(imported.settings) as Record<string, any>;
    expect(settings.videoOptions.color.primary).toBe("#FF0000");
    expect(settings.voiceStyles).toEqual({ Back: { primary: "#0000FF" } });
    expect(imported.warnings).toContain(FORMATTING_DROPPED);
    expect(imported.warnings).toContain(
      `The font "Comic Sans" isn't bundled with the app, so it was left out`,
    );
  });

  it("names voices after actors when the file has several", () => {
    const imported = assToProjectFiles(
      ass([
        "Dialogue: 0,0:00:01.00,0:00:02.00,Default,Anna,0,0,0,,{\\k50}Sun",
        "Dialogue: 0,0:00:02.00,0:00:03.00,Default,Ben,0,0,0,,{\\k50}Moon",
      ]),
      { fonts: FONTS },
    );
    expect(Object.keys(imported.timings)).toEqual(["Anna", "Ben"]);
  });

  it("times an untagged line from its start to its end", () => {
    const imported = assToProjectFiles(
      ass(["Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Just a/b words"]),
      { fonts: FONTS },
    );

    expect(imported.lyrics).toBe("Just_ab_words");
    expect(imported.timings["Voice 1"]).toEqual([
      { text: "Just_", start: 1 },
      { text: "ab_" },
      { text: "words", end: 4 },
    ]);
    expect(imported.warnings).toEqual([MARKUP_REMOVED, UNTIMED_LINES]);
  });

  it("breaks screens at pauses, and splits long runs evenly", () => {
    const line = (second: number) =>
      `Dialogue: 0,0:00:${String(second).padStart(2, "0")}.00,0:00:${String(second + 1).padStart(2, "0")}.00,Default,,0,0,0,,{\\k100}L${second}`;
    const imported = assToProjectFiles(ass([1, 2, 3, 4, 5, 6, 10, 11].map(line)), {
      fonts: FONTS,
    });

    expect(imported.lyrics).toBe("L1\nL2\nL3\n\nL4\nL5\nL6\n\nL10\nL11");
    expect(imported.warnings).toContain(SCREENS_GUESSED);
  });

  it("scales sizes to the app's canvas", () => {
    const imported = assToProjectFiles(
      ass(
        ["Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\k50}Sun"],
        ["Style: Default,Georgia,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,4"],
        "PlayResX: 1920\nPlayResY: 1080",
      ),
      { fonts: FONTS },
    );
    const settings = yaml.load(imported.settings) as Record<string, any>;
    expect(settings.videoOptions.font.size).toBe(16);
    expect(settings.videoOptions.outlineWidth).toBe(1.1);
  });

  it("throws on a file without lyrics", () => {
    expect(() => assToProjectFiles(ass([]), { fonts: FONTS })).toThrow(/no lyrics/);
  });
});
