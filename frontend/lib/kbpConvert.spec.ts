import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { KBP_DIVIDER, parseKbp } from "./kbp";
import { COUNT_INS_OFF, kbpToProjectFiles, projectFilesToKbp, ProjectFiles } from "./kbpConvert";
import { parseSettingsYaml } from "./settingsFile";
import { TimedSegment } from "./timedSegments";
import { DISPLAY_PERIOD_WIDENED, SPACER_PAGE_DROPPED } from "./importWarnings";
import { VerticalAlignment } from "./timing";

const FIXTURE = readFileSync(path.resolve(__dirname, "../../tests/fixtures/song.kbp"), "utf8");
const HEADER = FIXTURE.slice(0, FIXTURE.indexOf(`${KBP_DIVIDER}\r\nPAGEV2`));
const FONTS = ["Arial", "Georgia"];
const SPACER = ["C/A/0/0/0/0/0", "/              0/0/0", ""];

function withPages(header: string, ...pages: string[][]): string {
  return header + pages.map((lines) => [KBP_DIVIDER, "PAGEV2", ...lines, ""].join("\r\n")).join("");
}

function settingsFile(
  extra: {
    duration?: number;
    voiceStyles?: Record<string, unknown>;
    font?: Record<string, unknown>;
    color?: Record<string, string>;
  } = {},
): string {
  return yaml.dump({
    song: { title: "Pale Moon", artist: "The Placeholders", duration: extra.duration ?? 60 },
    videoOptions: {
      font: { name: "Georgia", size: 28, ...extra.font },
      color: {
        background: "#123456",
        primary: "#FF00FF",
        secondary: "#00FFFF",
        ...extra.color,
      },
    },
    ...(extra.voiceStyles ? { voiceStyles: extra.voiceStyles } : {}),
  });
}

describe("kbpToProjectFiles", () => {
  test("turns a single-style project into lyrics, timings and settings", () => {
    const result = kbpToProjectFiles(FIXTURE, { fonts: FONTS });

    expect(result.lyrics).toBe(
      [
        "➣➣➣/Pale_moon_ri/sing_slow",
        "o/ver_the_qui/et_hill",
        "Lan/terns_glow",
        "",
        "Wan/der_a/way",
        "Home_a/gain",
      ].join("\n"),
    );
    // An end at the next start, or 1 cs before it, is left open. Any other end is a release.
    expect(result.timings).toEqual({
      "Voice 1": [
        { text: "➣➣➣/", start: 3.01, displayStart: 0.01, displayEnd: 6.38 },
        { text: "Pale_", start: 4.2 },
        { text: "moon_", start: 4.39 },
        { text: "ri/", start: 4.61 },
        { text: "sing_", start: 4.99 },
        { text: "slow\n", start: 5.25, end: 5.88 },
        { text: "o/", start: 6.45, displayStart: 0.01, displayEnd: 8.84 },
        { text: "ver_", start: 6.69 },
        { text: "the_", start: 6.81 },
        { text: "qui/", start: 7.07 },
        { text: "et_", start: 7.27 },
        { text: "hill\n", start: 7.71, end: 8.34 },
        { text: "Lan/", start: 9.23, displayStart: 0.01, displayEnd: 11.15 },
        { text: "terns_", start: 9.45, end: 9.65 },
        { text: "glow\n\n", start: 10.37, end: 10.65 },
        { text: "Wan/", start: 19.13, displayStart: 16.13, displayEnd: 20.82 },
        { text: "der_", start: 19.27 },
        { text: "a/", start: 19.45 },
        { text: "way\n", start: 19.64, end: 20.32 },
        { text: "Home_", start: 20.83, displayStart: 16.13, displayEnd: 22.05 },
        { text: "a/", start: 21.13 },
        { text: "gain", start: 21.33, end: 21.55 },
      ],
    });
    expect(result.audioName).toBe("The Placeholders - Pale Moon.flac");
    expect(result.warnings).toEqual([COUNT_INS_OFF]);

    const settings = parseSettingsYaml(result.settings);
    expect(settings.warnings).toEqual([]);
    expect(settings.song).toEqual({ title: "Pale Moon", artist: "The Placeholders" });
    expect(settings.videoOptions.countInMode).toBe("none");
    expect(settings.videoOptions.instrumentalThreshold).toBe(0);
    expect(settings.videoOptions.verticalAlignment).toBe(VerticalAlignment.Top);
    // The fixture's margins are top 7 and line spacing 12, and its font size is 22 once scaled:
    // (12 + 19) and (7 + 12) CDG units, times 288 / 216, over 22.
    expect(settings.videoOptions.lineSpacing).toBe(1.879);
    expect(settings.videoOptions.topMargin).toBe(1.152);
    expect(settings.videoOptions.font).toEqual({
      name: "Arial",
      size: 22,
      bold: true,
      italic: false,
    });
    expect(settings.videoOptions.color?.background.toString()).toBe("#005555");
    expect(settings.videoOptions.color?.primary.toString()).toBe("#ee7700");
    expect(settings.videoOptions.color?.secondary.toString()).toBe("#ffffff");
    expect(settings.videoOptions.color?.outline?.toString()).toBe("#000000");
    // Present though empty, so loading it drops the overrides already there.
    expect(settings.voiceStyles).toEqual({});
  });

  test("makes a voice of each style in use", () => {
    const header = HEADER.replace("Style01,Male", "Style01,Lead+Harmony").replace(
      "Style02,Female",
      "Style02,Lead+Harmony",
    );
    const text = withPages(
      header,
      [
        "C/B/0/100/0/0/0",
        "Hi/            10/20/0",
        "",
        "C/C/0/100/0/0/0",
        "Yo/            30/40/0",
        "",
      ],
      ["C/B/0/200/0/0/0", "Hey/           150/160/0", ""],
    );
    const result = kbpToProjectFiles(text, { fonts: FONTS });

    expect(result.lyrics).toBe("[Lead Harmony] Hi\n[Lead Harmony 2] Yo\n\n[Lead Harmony] Hey");
    expect(result.timings).toEqual({
      "Lead Harmony": [
        { text: "Hi\n\n", start: 0.1, end: 0.2, displayStart: 0, displayEnd: 1 },
        { text: "Hey", start: 1.5, end: 1.6, displayStart: 0, displayEnd: 2 },
      ],
      "Lead Harmony 2": [{ text: "Yo", start: 0.3, end: 0.4, displayStart: 0, displayEnd: 1 }],
    });

    // The first style in use is the base, and the other voice keeps only what differs from it.
    const settings = parseSettingsYaml(result.settings);
    expect(settings.videoOptions.color?.secondary.toString()).toBe("#ccffff");
    expect(Object.keys(settings.voiceStyles ?? {})).toEqual(["Lead Harmony 2"]);
    const override = settings.voiceStyles?.["Lead Harmony 2"];
    expect(override?.secondary?.toString()).toBe("#ffccff");
    expect(override?.primary?.toString()).toBe("#ff33ff");
    expect(override?.outline?.toString()).toBe("#330033");
    expect(override?.fontSize).toBeUndefined();
  });

  test("drops or repairs what the app can't hold, and says so", () => {
    const header = HEADER.replace(
      "    2,2,2,2,0,0,0,L\r\n\r\n  Style01",
      "    2,2,2,2,0,0,0,U\r\n\r\n  Style01",
    );
    const text = withPages(header, [
      "FX/F/",
      "L/A/0/100/5/0/0",
      "[aside]/       10/20/0",
      "",
      "C/A/0/100/0/0/0",
      "/              0/0/0",
      "",
      "C/a/0/100/0/0/0",
      "fixed /        0/0/0",
      "text/          0/0/0",
      "",
      "C/Z/0/100/0/0/0",
      "and{-}or /     30/40/0",
      "snake_case/    40/50/0",
      "",
    ]);
    const result = kbpToProjectFiles(text, { fonts: FONTS });

    expect(result.lyrics).toBe("ASIDE\n/\nFIXED_TEXT\nANDOR_SNAKECASE");
    expect(result.timings["Voice 1"]).toEqual([
      { text: "ASIDE\n", start: 0.1, end: 0.2, displayStart: 0, displayEnd: 1 },
      { text: "FIXED_", spacersBefore: 1 },
      { text: "TEXT\n" },
      { text: "ANDOR_", start: 0.3, displayStart: 0, displayEnd: 1 },
      { text: "SNAKECASE", start: 0.4, end: 0.5 },
    ]);
    expect(result.warnings).toEqual([
      "Page transitions were dropped",
      "Line positions were dropped, since the app lays out its own screens",
      "Lines in an undefined style Z use Style00",
      "Square brackets starting a line were removed, since they would read as a voice tag",
      "A fixed line was imported untimed, since the app has no text without a wipe",
      "A / or _ in the lyrics was removed, since the app uses both as markup (×2)",
      COUNT_INS_OFF,
    ]);
  });

  test("keeps spacers in their slots", () => {
    const text = withPages(
      HEADER,
      [...SPACER, "C/A/0/300/0/0/0", "Pale /         10/20/0", "moon/          20/30/0", ""],
      [...SPACER, ...SPACER, "C/A/0/300/0/0/0", "Solo/          40/250/0", ""],
      [
        "C/A/250/600/0/0/0",
        "Wan/           300/320/0",
        "der/           320/340/0",
        "",
        ...SPACER,
        "C/A/250/600/0/0/0",
        "home/          400/450/0",
        "",
        ...SPACER,
      ],
      [...SPACER, ...SPACER],
    );
    const result = kbpToProjectFiles(text, { fonts: FONTS });

    expect(result.lyrics).toBe("/\nPale_moon\n\n/\n/\nSolo\n\nWan/der\n/\nhome\n/");
    expect(
      result.timings["Voice 1"].map(({ text, spacersBefore, spacersAfter }) => ({
        text,
        spacersBefore,
        spacersAfter,
      })),
    ).toEqual([
      { text: "Pale_", spacersBefore: 1 },
      { text: "moon\n\n" },
      { text: "Solo\n\n", spacersBefore: 2 },
      { text: "Wan/" },
      { text: "der\n" },
      { text: "home", spacersBefore: 1, spacersAfter: 1 },
    ]);
    expect(result.warnings).toEqual([SPACER_PAGE_DROPPED, COUNT_INS_OFF]);
    // KBS anchors lines to the top, where spacers push them down a full slot.
    expect(parseSettingsYaml(result.settings).videoOptions.verticalAlignment).toBe(
      VerticalAlignment.Top,
    );
  });

  test("gives a spacer the voice of the line it pushes down, whatever its style", () => {
    const text = withPages(HEADER, [
      "C/D/0/0/0/0/0",
      "/              0/0/0",
      "",
      "C/A/0/100/0/0/0",
      "Hi/            10/20/0",
      "",
      "C/D/0/0/0/0/0",
      "/              0/0/0",
      "",
      "C/B/0/100/0/0/0",
      "Yo/            30/40/0",
      "",
      "C/D/0/0/0/0/0",
      "/              0/0/0",
      "",
    ]);
    const result = kbpToProjectFiles(text, { fonts: FONTS });

    expect(result.lyrics).toBe("[Default] /\nHi\n[Male] /\nYo\n/");
    expect(result.timings).toEqual({
      Default: [
        { text: "Hi", start: 0.1, end: 0.2, displayStart: 0, displayEnd: 1, spacersBefore: 1 },
      ],
      Male: [
        {
          text: "Yo",
          start: 0.3,
          end: 0.4,
          displayStart: 0,
          displayEnd: 1,
          spacersBefore: 1,
          spacersAfter: 1,
        },
      ],
    });
  });

  test("keeps the spacers of an unsynced project", () => {
    const text =
      HEADER.replace("Status    1", "Status    0") +
      [KBP_DIVIDER, "LYRICSV2", "/", "Pale moon", "", "/", "Wan/der"].join("\r\n");
    const result = kbpToProjectFiles(text, { fonts: FONTS });

    expect(result.lyrics).toBe("/\nPale_moon\n\n/\nWan/der");
  });

  test("widens a line's display period to contain its syllables, and says so", () => {
    const text = withPages(HEADER, [
      "C/A/150/300/0/0/0",
      "one /          100/140/0",
      "two/           140/200/0",
      "",
      "C/A/250/260/0/0/0",
      "three/         250/400/0",
      "",
    ]);
    const result = kbpToProjectFiles(text, { fonts: FONTS });

    expect(result.timings["Voice 1"]).toEqual([
      { text: "one_", start: 1, displayStart: 1, displayEnd: 3 },
      { text: "two\n", start: 1.4, end: 2 },
      { text: "three", start: 2.5, end: 4, displayStart: 2.5, displayEnd: 4 },
    ]);
    expect(result.warnings).toEqual([`${DISPLAY_PERIOD_WIDENED} (×2)`, COUNT_INS_OFF]);
  });

  test("leaves out a font the app doesn't bundle", () => {
    const result = kbpToProjectFiles(FIXTURE, { fonts: ["Georgia"] });

    expect(parseSettingsYaml(result.settings).videoOptions.font).toEqual({
      size: 22,
      bold: true,
      italic: false,
    });
    expect(result.warnings).toContain(
      `The font "Arial" isn't bundled with the app, so it was left out`,
    );
  });

  test("turns an unsynced project into lyrics with no timings", () => {
    const text =
      HEADER.replace("Status    1", "Status    0") +
      [KBP_DIVIDER, "LYRICSV2", "Pale moon ri/sing ", "o/ver the hill", "", "Wan/der a/way"].join(
        "\r\n",
      );
    const result = kbpToProjectFiles(text, { fonts: FONTS });

    expect(result.lyrics).toBe("Pale_moon_ri/sing\no/ver_the_hill\n\nWan/der_a/way");
    expect(result.timings).toEqual({});
  });
});

describe("projectFilesToKbp", () => {
  const single: ProjectFiles = {
    lyrics: "Pale_moon\nri/sing\n\nslow",
    timings: {
      "Voice 1": [
        { text: "Pale_", start: 5 },
        { text: "moon\n", start: 5.5, end: 6 },
        { text: "ri/", start: 7 },
        { text: "sing\n\n", start: 7.25 },
        { text: "slow", start: 30 },
      ],
    },
    settings: settingsFile({ duration: 31.5 }),
  };

  test("writes pages, lines and syllables the way KBS times them", () => {
    const result = projectFilesToKbp({ ...single, audioName: "Pale Moon.flac" });
    const document = parseKbp(result.kbp);

    expect(result.warnings).toEqual([]);
    expect(document.trackInfo).toMatchObject({
      Status: "1",
      Title: "Pale Moon",
      Artist: "The Placeholders",
      Audio: "Pale Moon.flac",
    });
    expect(
      document.pages.map((page) => page.lines.map((line) => [line.style, line.start, line.end])),
    ).toEqual([
      [
        ["A", 200, 650],
        ["A", 200, 2999 + 50],
      ],
      // 3 s ahead of the page, the first slot's previous line having gone long before.
      [["A", 2700, 3150 + 50]],
    ]);
    expect(document.pages.flatMap((page) => page.lines.flatMap((line) => line.syllables))).toEqual([
      { text: "Pale ", start: 500, end: 549, wipe: 0 },
      { text: "moon", start: 550, end: 600, wipe: 0 },
      { text: "ri", start: 700, end: 724, wipe: 0 },
      { text: "sing", start: 725, end: 2999, wipe: 0 },
      // The last open end runs to the end of the song.
      { text: "slow", start: 3000, end: 3150, wipe: 0 },
    ]);
  });

  test("never shows a line after its own first syllable", () => {
    const result = projectFilesToKbp({
      lyrics: "a\n\nb",
      timings: {
        "Voice 1": [
          { text: "a\n\n", start: 1, end: 2 },
          { text: "b", start: 2.2 },
        ],
      },
      settings: settingsFile(),
      audioName: null,
    });
    const [first, second] = parseKbp(result.kbp).pages.map((page) => page.lines[0]);

    expect(first.end).toBe(250);
    expect(second.start).toBe(220);
  });

  test("writes a stored display period, widened to contain the line's syllables", () => {
    const result = projectFilesToKbp({
      lyrics: "a\nb\nc",
      timings: {
        "Voice 1": [
          { text: "a\n", displayStart: 0.5, displayEnd: 9 },
          { text: "b\n", start: 1, end: 2, displayStart: 1.5 },
          { text: "c", start: 3, end: 4 },
        ],
      },
      settings: settingsFile(),
      audioName: null,
    });
    const lines = parseKbp(result.kbp).pages[0].lines;

    // The untimed line is left out, and the last line keeps the automatic rules.
    expect(lines.map((line) => [line.start, line.end])).toEqual([
      [100, 250],
      [0, 450],
    ]);
  });

  test("writes the base font's bold and italic, which voices inherit", () => {
    const result = projectFilesToKbp({
      lyrics: "[Anna] la\n[Ben] hm",
      timings: { Anna: [{ text: "la", start: 1 }], Ben: [{ text: "hm", start: 2 }] },
      settings: settingsFile({
        font: { bold: false, italic: true },
        voiceStyles: { Ben: { bold: true } },
      }),
      audioName: null,
    });

    expect(parseKbp(result.kbp).styles.map((s) => s.fontStyle)).toEqual(["I", "BI"]);
  });

  test("writes the lyrics alone when nothing is timed", () => {
    const result = projectFilesToKbp({
      lyrics: "[Anna] Pale_moon\n[Ben] ri/sing",
      timings: {},
      settings: settingsFile(),
      audioName: null,
    });
    const document = parseKbp(result.kbp);

    expect(document.trackInfo.Status).toBe("0");
    expect(document.unsyncedLyrics).toEqual(["Pale moon", "ri/sing"]);
  });

  test("writes a row break as the separator it carries", () => {
    const unsynced = projectFilesToKbp({
      lyrics: "Pale_moon|ri/|sing",
      timings: {},
      settings: settingsFile(),
      audioName: null,
    });
    expect(parseKbp(unsynced.kbp).unsyncedLyrics).toEqual(["Pale moon ri/sing"]);

    const synced = projectFilesToKbp({
      lyrics: "Pale_moon|ri/|sing",
      timings: {
        "Voice 1": [
          { text: "Pale_", start: 1 },
          { text: "moon|", start: 2 },
          { text: "ri/|", start: 3 },
          { text: "sing", start: 4, end: 5 },
        ],
      },
      settings: settingsFile(),
      audioName: null,
    });
    const [line] = parseKbp(synced.kbp).pages[0].lines;
    expect(line.syllables.map(({ text }) => text)).toEqual(["Pale ", "moon ", "ri", "sing"]);
  });

  test("outlines the text in the outline color, not the background", () => {
    const result = projectFilesToKbp({
      lyrics: "[Anna] la",
      timings: { Anna: [{ text: "la", start: 1, end: 2 }] },
      settings: settingsFile({ color: { outline: "#FF0000" } }),
      audioName: null,
    });
    const document = parseKbp(result.kbp);

    expect(document.palette.slice(0, 4)).toEqual(["135", "F00", "0FF", "F0F"]);
    expect(document.styles[0].colors).toEqual([2, 1, 3, 1]);
  });

  test("gives each voice a style, and merges voices' pages that overlap", () => {
    const result = projectFilesToKbp({
      lyrics: "[Anna] la_la\n[Anna+Ben] oh\n[Ben] hm",
      timings: {
        Anna: [
          { text: "la_", start: 1 },
          { text: "la\n", start: 1.5 },
          { text: "oh", start: 2, end: 3 },
        ],
        Ben: [
          { text: "oh\n", start: 2.1 },
          { text: "hm", start: 3, end: 4 },
        ],
      },
      settings: settingsFile({ voiceStyles: { Ben: { primary: "#00FF00", fontName: "Arial" } } }),
      audioName: null,
    });
    const document = parseKbp(result.kbp);

    expect(document.styles.map((s) => [s.name, s.fontName, s.fontSize, s.fontStyle])).toEqual([
      ["Anna", "Georgia", 15, "B"],
      ["Ben", "Arial", 15, "B"],
    ]);
    // Entry 0 is the background, which also outlines the text when the file names no outline color.
    expect(document.palette.slice(0, 4)).toEqual(["135", "0FF", "F0F", "0F0"]);
    expect(document.styles.map((s) => s.colors)).toEqual([
      [1, 0, 2, 0],
      [1, 0, 3, 0],
    ]);
    expect(document.pages).toHaveLength(1);
    expect(
      document.pages[0].lines.map((line) => [
        line.style,
        line.syllables.map((s) => s.text).join(""),
      ]),
    ).toEqual([
      ["A", "la la"],
      ["A", "oh"],
      ["B", "oh"],
      ["B", "hm"],
    ]);
  });

  test("shares out the palette's 16 entries, and says when colours had to double up", () => {
    const voices = Array.from({ length: 10 }, (_, i) => `v${i}`);
    const hex = (i: number) => `#${(i * 17).toString(16).padStart(2, "0")}0000`;
    const result = projectFilesToKbp({
      lyrics: voices.map((voice) => `[${voice}] la`).join("\n"),
      timings: Object.fromEntries(voices.map((voice, i) => [voice, [{ text: "la", start: i }]])),
      settings: settingsFile({
        voiceStyles: Object.fromEntries(
          voices.map((voice, i) => [voice, { primary: hex(i), secondary: hex(i + 10) }]),
        ),
      }),
      audioName: null,
    });

    expect(parseKbp(result.kbp).palette).toHaveLength(16);
    expect(result.warnings).toContain(
      "The styles use more than 16 colours, so some take the nearest one",
    );
  });
});

describe("projectFilesToKbp with spacers", () => {
  test("writes them as KBS does, in their slots", () => {
    const project: ProjectFiles = {
      lyrics: "/\nPale_moon\n/\n\nri/sing\n/\nslow",
      timings: {
        "Voice 1": [
          { text: "Pale_", start: 5, spacersBefore: 1, spacersAfter: 1 },
          { text: "moon\n\n", start: 5.5, end: 6 },
          { text: "ri/", start: 7 },
          { text: "sing\n", start: 7.25, end: 8 },
          { text: "slow", start: 9, spacersBefore: 1 },
        ],
      },
      settings: settingsFile({ duration: 10 }),
    };
    const { kbp } = projectFilesToKbp({ ...project, audioName: null });
    const pages = parseKbp(kbp).pages.map((page) =>
      page.lines.map(({ start, end, syllables }) => ({
        start,
        end,
        text: syllables.map((syllable) => syllable.text).join(""),
      })),
    );

    expect(kbp).toContain(["C/A/0/0/0/0/0", "/              0/0/0"].join("\r\n"));
    // A slot the previous page holds a spacer in has gone when that page's last line has.
    expect(pages).toEqual([
      [
        { start: 0, end: 0, text: "" },
        { start: 200, end: 650, text: "Pale moon" },
        { start: 0, end: 0, text: "" },
      ],
      [
        { start: 651, end: 850, text: "rising" },
        { start: 0, end: 0, text: "" },
        { start: 651, end: 1050, text: "slow" },
      ],
    ]);
  });

  test("writes them in their voice's style", () => {
    const { kbp } = projectFilesToKbp({
      lyrics: "[Anna] la\n[Ben] /\noh",
      timings: {
        Anna: [{ text: "la", start: 1 }],
        Ben: [{ text: "oh", start: 1.5, spacersBefore: 1 }],
      },
      settings: settingsFile(),
      audioName: null,
    });
    const lines = parseKbp(kbp).pages.flatMap((page) => page.lines);
    expect(lines.map(({ style, syllables }) => [style, syllables[0].text])).toEqual([
      ["A", "la"],
      ["B", ""],
      ["B", "oh"],
    ]);
  });

  test("writes the lyrics' spacers when nothing is timed", () => {
    const { kbp } = projectFilesToKbp({
      lyrics: "/\nPale_moon",
      timings: {},
      settings: settingsFile(),
      audioName: null,
    });
    expect(parseKbp(kbp).unsyncedLyrics).toEqual(["/", "Pale moon"]);
  });
});

describe("round trip", () => {
  test("a KBS project keeps its spacers", () => {
    const text = withPages(
      HEADER,
      [...SPACER, "C/A/0/300/0/0/0", "Pale /         10/20/0", "moon/          20/30/0", ""],
      [
        ...SPACER,
        ...SPACER,
        "C/A/0/600/0/0/0",
        "Wan/           300/320/0",
        "der/           320/340/0",
        "",
      ],
    );
    const imported = kbpToProjectFiles(text, { fonts: FONTS });
    const exported = projectFilesToKbp({ ...imported, audioName: null });
    const back = kbpToProjectFiles(exported.kbp, { fonts: FONTS });

    expect(back.lyrics).toBe(imported.lyrics);
    expect(back.timings).toEqual(imported.timings);
  });

  test("a KBS project comes back with the same lyrics and timings", () => {
    const imported = kbpToProjectFiles(FIXTURE, { fonts: FONTS });
    const exported = projectFilesToKbp({ ...imported, audioName: imported.audioName });
    const back = kbpToProjectFiles(exported.kbp, { fonts: FONTS });

    expect(back.lyrics).toBe(imported.lyrics);
    expect(back.timings).toEqual(imported.timings);
    expect(back.settings).toBe(imported.settings);
  });

  test("each voice of the app's project comes back with the same timings", () => {
    const project: ProjectFiles = {
      lyrics: "[Anna] la_la\n[Anna+Ben] oh\n[Ben] hm",
      timings: {
        Anna: [
          { text: "la_", start: 1 },
          { text: "la\n", start: 1.5, end: 1.7 },
          { text: "oh", start: 2, end: 3 },
        ],
        Ben: [
          { text: "oh\n", start: 2.1 },
          { text: "hm", start: 3, end: 4 },
        ],
      },
      settings: settingsFile(),
    };
    const back = kbpToProjectFiles(projectFilesToKbp({ ...project, audioName: null }).kbp, {
      fonts: FONTS,
    });

    // Export writes every line's display period, so they all come back stored.
    const withoutDisplayPeriods = ({ displayStart: _s, displayEnd: _e, ...rest }: TimedSegment) =>
      rest;
    expect(back.timings.Anna.map(withoutDisplayPeriods)).toEqual(project.timings.Anna);
    expect(back.timings.Ben.map(withoutDisplayPeriods)).toEqual(project.timings.Ben);
  });
});
