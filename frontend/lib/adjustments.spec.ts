import { fromEvents, TimedSegment } from "./timedSegments";
import {
  addTitleScreen,
  addInstrumentalScreens,
  addQuickStartCountIn,
  addGapCountIns,
  addOverlappingCountIns,
  displayQuickLinesEarly,
  deferScreenStarts,
  unstagger,
} from "./adjustments";
import {
  compileLyricTimings,
  createMultiVoiceAssFile,
  createScreens,
  denormalizeTimestamps,
  LyricEvent,
  LyricSegment,
  LyricsLine,
  LyricsScreen,
  KaraokeOptions,
  CountInMode,
  VerticalAlignment,
} from "./timing";
import { testLyrics, shortIntroTestEvents } from "./timing.spec";
import { wrapScreens } from "./lineRows";
import { HALF_FONTS } from "./testFonts";
import {
  LYRIC_MARKERS,
  DEFAULT_COUNT_IN_THRESHOLD,
  DEFAULT_COUNT_IN_DURATION,
  TITLE_SCREEN_DURATION,
} from "@/constants";
import { default as BuefyColor } from "buefy/src/utils/color";

// Pinned rather than taken from the default, which is now empty and draws marks instead.
const TEST_COUNT_IN_TEXT = "••• ";
// A fixed count-in as it is drawn.
const FIXED_COUNT_IN = `{\\alpha&H00&}${TEST_COUNT_IN_TEXT}`;

const DEFAULT_OPTIONS: KaraokeOptions = {
  addTitleScreen: true,
  countInMode: "screen",
  countInText: TEST_COUNT_IN_TEXT,
  dynamicCountIns: false,
  countInThreshold: DEFAULT_COUNT_IN_THRESHOLD,
  countInDuration: DEFAULT_COUNT_IN_DURATION,
  instrumentalThreshold: 8,
  addStaggeredLines: true,
  useStoredDisplayPeriods: true,
  useBackground: false,
  backgroundFit: "fill",
  outputFormat: "mp4",
  resolution: "1080p",
  frameRate: 30,
  quality: "standard",
  verticalAlignment: VerticalAlignment.Middle,
  lineSpacing: 1.5,
  topMargin: 1.5,
  outlineWidth: 1,
  shadowX: 0,
  shadowY: 0,
  font: {
    size: 22,
    name: "Arial Narrow",
  },
  color: {
    background: BuefyColor.parse("black"),
    primary: BuefyColor.parse("#FF00FF"),
    secondary: BuefyColor.parse("#00FFFF"),
    outline: BuefyColor.parse("black"),
    shadow: BuefyColor.parse("black"),
  },
};

const DEFAULT_ASS_OPTIONS = {
  Fontsize: 20,
  Fontname: "Arial Narrow",
};

test("addTitleScreenToShortIntroSong", () => {
  const titleScreenAss = `Dialogue: 0,0:00:00.00,0:00:04.00,Default,Singer,0,0,118,,Tüülin' Around
Dialogue: 0,0:00:00.00,0:00:04.00,Default,Singer,0,0,148,,The Tüüls
`;
  const screens = denormalizeTimestamps(
    compileLyricTimings(fromEvents(testLyrics, shortIntroTestEvents)),
    60.0,
  );
  const screensWithTitle = addTitleScreen(screens, "Tüülin' Around", "The Tüüls");
  expect(screensWithTitle.length).toBe(3);
  expect(screensWithTitle[0].toAssEvents(DEFAULT_ASS_OPTIONS, DEFAULT_OPTIONS)).toBe(
    titleScreenAss,
  );
  expect(screensWithTitle[0].audioDelay).toBe(4);
});

test("count-ins use the configured text, threshold and duration", () => {
  const lyrics = "That was a long intro";
  const timings: LyricEvent[] = [
    [30.0, LYRIC_MARKERS.SEGMENT_START],
    [35.0, LYRIC_MARKERS.SEGMENT_END],
  ];
  const options: KaraokeOptions = {
    ...DEFAULT_OPTIONS,
    countInText: "1 2 3 ",
    countInThreshold: 5.0,
    countInDuration: 3.0,
  };

  const screens = addGapCountIns(
    denormalizeTimestamps(compileLyricTimings(fromEvents(lyrics, timings)), 60.0),
    options,
  );

  const countIn = screens[0].lines[0].segments[0];
  expect(countIn.text).toBe("{\\alpha&H00&}1 2 3 ");
  expect(countIn.timestamp).toBe(27.0);
  expect(countIn.endTimestamp).toBe(30.0);
});

test("no count-in when the gap is too short for a single mark", () => {
  const lyrics = "That was a long intro";
  const timings: LyricEvent[] = [
    [2.0, LYRIC_MARKERS.SEGMENT_START],
    [35.0, LYRIC_MARKERS.SEGMENT_END],
  ];
  // A full count-in of 9s puts the three marks 3s apart; the gap here is 2s.
  const options: KaraokeOptions = {
    ...DEFAULT_OPTIONS,
    dynamicCountIns: true,
    countInThreshold: 9.0,
  };

  const screens = addGapCountIns(
    denormalizeTimestamps(compileLyricTimings(fromEvents(lyrics, timings)), 60.0),
    options,
  );

  expect(screens[0].lines[0].segments[0].text).toBe(lyrics);
});

const MID_SCREEN_GAP_LYRICS = "first line\nsecond line";
const MID_SCREEN_GAP_TIMINGS: LyricEvent[] = [
  [1.0, LYRIC_MARKERS.SEGMENT_START],
  [2.0, LYRIC_MARKERS.SEGMENT_END],
  [20.0, LYRIC_MARKERS.SEGMENT_START],
  [21.0, LYRIC_MARKERS.SEGMENT_END],
];

function screenWithMidScreenGap(countInMode: CountInMode): LyricsScreen {
  const options: KaraokeOptions = {
    ...DEFAULT_OPTIONS,
    countInMode,
    countInThreshold: 5.0,
    countInDuration: 3.0,
  };
  return addGapCountIns(
    denormalizeTimestamps(
      compileLyricTimings(fromEvents(MID_SCREEN_GAP_LYRICS, MID_SCREEN_GAP_TIMINGS)),
      60.0,
    ),
    options,
  )[0];
}

test("line mode gives a mid-screen line its own count-in", () => {
  const screen = screenWithMidScreenGap("line");

  expect(screen.lines[0].segments[0].text).toBe("first line\n");
  const countIn = screen.lines[1].segments[0];
  expect(countIn.text).toBe(FIXED_COUNT_IN);
  expect(countIn.timestamp).toBe(17.0);
  expect(countIn.endTimestamp).toBe(20.0);
});

test("dynamic count-ins draw marks when there is no text", () => {
  const options: KaraokeOptions = {
    ...DEFAULT_OPTIONS,
    countInMode: "line",
    countInText: " ",
    dynamicCountIns: true,
    countInThreshold: 3.0,
  };
  const screen = addGapCountIns(
    denormalizeTimestamps(
      compileLyricTimings(fromEvents(MID_SCREEN_GAP_LYRICS, MID_SCREEN_GAP_TIMINGS)),
      60.0,
    ),
    options,
  )[0];

  // fontSize 22 => a 9x9 mark on the baseline via \pbo, fading in across the three.
  // The first two carry a bare move to x=14, widening the bounding box into a fixed gap.
  // The last takes a word space instead, since the lyrics follow it.
  const square = "m 0 0 l 9 0 9 -9 0 -9";
  const gap = " m 14 0";
  const segments = screen.lines[1].segments;
  // One segment per mark, so the sweep fills them one at a time over the 3s count-in.
  expect(segments.slice(0, 3).map((s) => s.text)).toEqual([
    `{\\alpha&H80&}{\\p1\\pbo9}${square}${gap}{\\p0}`,
    `{\\alpha&H40&}{\\p1\\pbo9}${square}${gap}{\\p0}`,
    `{\\alpha&H00&}{\\p1\\pbo9}${square}{\\p0} `,
  ]);
  expect(segments.slice(0, 3).map((s) => s.timestamp)).toEqual([17.0, 18.0, 19.0]);
  expect(segments[2].endTimestamp).toBe(20.0);
  expect(segments[3].text).toBe("second line");
});

/**
 * The marks a dynamic count-in splits the text into, with a gap long enough for all of them.
 */
function dynamicCountInMarks(countInText: string, countInThreshold = 3.0): LyricSegment[] {
  const options: KaraokeOptions = {
    ...DEFAULT_OPTIONS,
    countInMode: "line",
    countInText,
    dynamicCountIns: true,
    countInThreshold,
  };
  const screen = addGapCountIns(
    denormalizeTimestamps(
      compileLyricTimings(fromEvents(MID_SCREEN_GAP_LYRICS, MID_SCREEN_GAP_TIMINGS)),
      60.0,
    ),
    options,
  )[0];
  return screen.lines[1].segments.slice(0, -1);
}

const HALF_SPACE = "{\\fscx50} {\\fscx}";

const markTexts = (segments: LyricSegment[]) =>
  segments.map((segment) => segment.text.replace(/^\{\\alpha&H..&\}/, ""));

test("dynamic count-ins split the text by word when it has spaces", () => {
  const marks = dynamicCountInMarks("Ready, set, go! ");

  expect(markTexts(marks)).toEqual(["Ready, ", "set, ", "go! "]);
  expect(marks.map((s) => s.text.slice(0, 13))).toEqual([
    "{\\alpha&H80&}",
    "{\\alpha&H40&}",
    "{\\alpha&H00&}",
  ]);
  expect(marks.map((s) => s.timestamp)).toEqual([17.0, 18.0, 19.0]);
});

test("dynamic count-ins split the text by character when it has no spaces", () => {
  expect(markTexts(dynamicCountInMarks("♪♪♪"))).toEqual(["♪", "♪", `♪${HALF_SPACE}`]);
  expect(markTexts(dynamicCountInMarks("Hello"))).toEqual(["He", "ll", `o${HALF_SPACE}`]);
});

test("extra words go to the first marks", () => {
  expect(markTexts(dynamicCountInMarks("5 4 3 2 1 "))).toEqual(["5 4 ", "3 2 ", "1 "]);
});

test("the text's own leading and trailing spaces stay", () => {
  expect(markTexts(dynamicCountInMarks("  •••  "))).toEqual(["  •", "•", "•  "]);
});

test("the last mark gets a half-width space when the text has none", () => {
  expect(markTexts(dynamicCountInMarks("3 2 1"))).toEqual(["3 ", "2 ", `1${HALF_SPACE}`]);
  expect(markTexts(dynamicCountInMarks("•••"))).toEqual(["•", "•", `•${HALF_SPACE}`]);
});

test("a text too short for three marks spreads the fewer marks over the whole count-in", () => {
  const marks = dynamicCountInMarks("Go ", 4.0);

  expect(markTexts(marks)).toEqual(["G", "o "]);
  expect(marks.map((s) => s.timestamp)).toEqual([16.0, 18.0]);
  expect(marks.map((s) => s.text.slice(9, 11))).toEqual(["40", "00"]);
});

test("the number of marks follows the size of the gap", () => {
  // A full count-in of 3s puts the three marks 1s apart, so each whole second of gap earns one.
  const options: KaraokeOptions = {
    ...DEFAULT_OPTIONS,
    countInMode: "line",
    dynamicCountIns: true,
    countInThreshold: 3.0,
  };
  const countInFor = (gap: number) => {
    const timings: LyricEvent[] = [
      [10.0, LYRIC_MARKERS.SEGMENT_START],
      [11.0, LYRIC_MARKERS.SEGMENT_END],
      [11.0 + gap, LYRIC_MARKERS.SEGMENT_START],
      [12.0 + gap, LYRIC_MARKERS.SEGMENT_END],
    ];
    const screen = addGapCountIns(
      denormalizeTimestamps(compileLyricTimings(fromEvents(MID_SCREEN_GAP_LYRICS, timings)), 60.0),
      options,
    )[0];
    // Everything before the line's own text is a mark.
    return screen.lines[1].segments.slice(0, -1);
  };

  expect(countInFor(3.5).length).toBe(3);
  expect(countInFor(2.5).length).toBe(2);
  expect(countInFor(1.5).length).toBe(1);
  expect(countInFor(0.5).length).toBe(0);

  // Fewer marks drop the faintest, so the fade still ends opaque on the beat.
  const alphas = (gap: number) =>
    countInFor(gap).map((segment) => segment.text.match(/alpha&H(..)&/)?.[1]);
  expect(alphas(3.5)).toEqual(["80", "40", "00"]);
  expect(alphas(2.5)).toEqual(["40", "00"]);
  expect(alphas(1.5)).toEqual(["00"]);

  // Whatever the mark count, the count-in never reaches back past the previous line's end.
  expect(countInFor(2.5)[0].timestamp).toBe(11.5);
});

describe("overlapping count-ins", () => {
  // A full count-in of 3s puts the marks 1s apart, so a gap under 1s earns none from the gap alone.
  const options: KaraokeOptions = {
    ...DEFAULT_OPTIONS,
    countInMode: "line",
    dynamicCountIns: true,
    countInThreshold: 3.0,
  };
  const marksOf = (line: LyricsLine) =>
    line.segments.filter((s) => s.countIn).map((s) => [s.timestamp, s.endTimestamp]);
  const counted = (
    screens: LyricsScreen[],
    countInMode: CountInMode = "line",
    useStoredDisplayPeriods = true,
  ) => {
    const modeOptions = { ...options, countInMode, useStoredDisplayPeriods };
    return addOverlappingCountIns(addGapCountIns(screens, modeOptions), modeOptions);
  };
  const compiled = (segments: TimedSegment[]) =>
    denormalizeTimestamps(compileLyricTimings(segments), 60.0);
  // An empty first screen stands in for the title screen, which the staggered-lines pass skips.
  const staggered = (segments: TimedSegment[]) =>
    displayQuickLinesEarly(
      denormalizeTimestamps([new LyricsScreen(), ...compileLyricTimings(segments)], 60.0),
      options,
    );

  it("give a line too close to the previous one its last mark", () => {
    const [screen] = counted(
      compiled([
        { text: "first line\n", start: 10, end: 11 },
        { text: "second line", start: 11.5, end: 12.5 },
      ]),
    );

    expect(marksOf(screen.lines[1])).toEqual([[10.5, 11.5]]);
    expect(screen.lines[1].segments[0].text).toMatch(/alpha&H00&/);
  });

  it("never start before the previous line is sung", () => {
    const [screen] = counted(
      compiled([
        { text: "first line\n", start: 10, end: 10.3 },
        { text: "second line", start: 10.5, end: 11.5 },
      ]),
    );

    expect(marksOf(screen.lines[1])).toEqual([]);
  });

  it("leave out a screen's first line while the previous screen is shown", () => {
    const [, second] = counted(
      compiled([
        { text: "one\n\n", start: 10, end: 11 },
        { text: "two", start: 11.5, end: 12.5 },
      ]),
      "screen",
    );

    expect(marksOf(second.lines[0])).toEqual([]);
  });

  it("give a screen's first line its mark when its stored display start shows it in time", () => {
    const song = (displayStart: number) => [
      { text: "one\n\n", start: 10, end: 11 },
      { text: "two", start: 11.5, end: 12.5, displayStart },
    ];

    expect(marksOf(counted(compiled(song(10)), "screen")[1].lines[0])).toEqual([[10.5, 11.5]]);
    expect(marksOf(counted(compiled(song(10.75)), "screen")[1].lines[0])).toEqual([]);
    expect(marksOf(counted(compiled(song(10)), "screen", false)[1].lines[0])).toEqual([]);
  });

  it("give a staggered line its mark when it is shown early enough", () => {
    const [, , next] = counted(
      staggered([
        { text: "one\n", start: 1, end: 2 },
        { text: "two\n\n", start: 2, end: 5 },
        { text: "three", start: 5.5, end: 6 },
      ]),
      "screen",
    );

    expect(next.lines[0].customDisplayStartTime).toBe(4.25);
    expect(marksOf(next.lines[0])).toEqual([[4.5, 5.5]]);
  });

  it("are dropped when a staggered line is shown at the usual time again", () => {
    const [, previous, next] = counted(
      staggered([
        { text: "one\n", start: 1, end: 2 },
        { text: "two\n\n", start: 2, end: 5 },
        { text: "three", start: 5.5, end: 6 },
      ]),
      "screen",
    );
    unstagger(previous, next, options);

    expect(marksOf(next.lines[0])).toEqual([]);
    expect(next.lines[0].timestamp).toBe(5.5);
  });

  it("stay when a staggered line's stored display start still shows it in time", () => {
    const [, previous, next] = counted(
      staggered([
        { text: "one\n", start: 1, end: 2 },
        { text: "two\n\n", start: 2, end: 5 },
        { text: "three", start: 5.5, end: 6, displayStart: 4.5 },
      ]),
      "screen",
    );
    unstagger(previous, next, options);

    expect(marksOf(next.lines[0])).toEqual([[4.5, 5.5]]);
  });
});

test("screen mode leaves a mid-screen line alone", () => {
  const screen = screenWithMidScreenGap("screen");

  expect(screen.lines[1].segments[0].text).toBe("second line");
});

test("no count-in on a line that follows on from the previous one", () => {
  const lyrics = "first line\nsecond line";
  const timings: LyricEvent[] = [
    [10.0, LYRIC_MARKERS.SEGMENT_START],
    [11.0, LYRIC_MARKERS.SEGMENT_END],
    [12.0, LYRIC_MARKERS.SEGMENT_START],
    [13.0, LYRIC_MARKERS.SEGMENT_END],
  ];
  const options: KaraokeOptions = {
    ...DEFAULT_OPTIONS,
    countInMode: "line",
    countInThreshold: 5.0,
    countInDuration: 3.0,
  };

  const screens = addGapCountIns(
    denormalizeTimestamps(compileLyricTimings(fromEvents(lyrics, timings)), 60.0),
    options,
  );

  expect(screens[0].lines[0].segments[0].text).toBe(FIXED_COUNT_IN);
  expect(screens[0].lines[1].segments[0].text).toBe("second line");
});

test("quick start count-in uses the configured text and duration", () => {
  const options: KaraokeOptions = {
    ...DEFAULT_OPTIONS,
    countInText: "go! ",
    countInDuration: 3.0,
  };
  const screens = denormalizeTimestamps(
    compileLyricTimings(fromEvents(testLyrics, shortIntroTestEvents)),
    60.0,
  );

  const adjusted = addQuickStartCountIn(screens, options);

  const countIn = adjusted[0].lines[0].segments[0];
  expect(countIn.text).toBe("{\\alpha&H00&}go! ");
  expect(countIn.timestamp).toBe(0.0);
  expect(countIn.endTimestamp).toBe(3.0);
  expect(adjusted[0].audioDelay).toBe(3.0 - shortIntroTestEvents[0][0]);
});

test("addInstrumentalScreen", () => {
  const lyrics = "screen one\n\nscreen two";
  const timings: LyricEvent[] = [
    [1.0, LYRIC_MARKERS.SEGMENT_START],
    [2.0, LYRIC_MARKERS.SEGMENT_END],
    [20.0, LYRIC_MARKERS.SEGMENT_START],
    [21.0, LYRIC_MARKERS.SEGMENT_END],
  ];
  let screens = compileLyricTimings(fromEvents(lyrics, timings));

  screens = denormalizeTimestamps(addInstrumentalScreens(screens, DEFAULT_OPTIONS), 60.0);
  expect(screens.length).toBe(3);

  const ass = `Dialogue: 0,0:00:00.00,0:00:02.00,Default,Singer,0,0,133,,{\\k100}{\\kf100}screen one


Dialogue: 0,0:00:02.00,0:00:20.00,Default,Singer,0,0,133,,{\\k0}{\\kf1800}{\\p1}m 0 5 l 307 5 307 20 0 20{\\p0}
Dialogue: 0,0:00:20.00,0:00:21.00,Default,Singer,0,0,133,,{\\k0}{\\kf100}screen two
`;
  expect(screens.map((s) => s.toAssEvents(DEFAULT_ASS_OPTIONS, DEFAULT_OPTIONS)).join("")).toBe(
    ass,
  );
  const instrumentalScreen: LyricsScreen = screens[1];
  expect(instrumentalScreen.startTimestamp).toBeTruthy();
});

test("addInstrumentalScreenFor3ScreenSong", () => {
  const lyrics = "screen one\n\nscreen two\n\nscreen three";
  const timings: LyricEvent[] = [
    [1.0, LYRIC_MARKERS.SEGMENT_START],
    [2.0, LYRIC_MARKERS.SEGMENT_END],
    [20.0, LYRIC_MARKERS.SEGMENT_START],
    [21.0, LYRIC_MARKERS.SEGMENT_END],
    [30.0, LYRIC_MARKERS.SEGMENT_START],
    [31.0, LYRIC_MARKERS.SEGMENT_END],
  ];
  let screens = compileLyricTimings(fromEvents(lyrics, timings));
  screens = denormalizeTimestamps(addInstrumentalScreens(screens, DEFAULT_OPTIONS), 60.0);
  expect(screens.length).toBe(5);

  const ass = `Dialogue: 0,0:00:00.00,0:00:02.00,Default,Singer,0,0,133,,{\\k100}{\\kf100}screen one


Dialogue: 0,0:00:02.00,0:00:20.00,Default,Singer,0,0,133,,{\\k0}{\\kf1800}{\\p1}m 0 5 l 307 5 307 20 0 20{\\p0}
Dialogue: 0,0:00:20.00,0:00:21.00,Default,Singer,0,0,133,,{\\k0}{\\kf100}screen two


Dialogue: 0,0:00:21.00,0:00:30.00,Default,Singer,0,0,133,,{\\k0}{\\kf900}{\\p1}m 0 5 l 307 5 307 20 0 20{\\p0}
Dialogue: 0,0:00:30.00,0:00:31.00,Default,Singer,0,0,133,,{\\k0}{\\kf100}screen three
`;
  expect(screens.map((s) => s.toAssEvents(DEFAULT_ASS_OPTIONS, DEFAULT_OPTIONS)).join("")).toBe(
    ass,
  );
});

test("addInstrumentalScreens survives a gap that rounds past the next line", () => {
  const lyrics = "screen one\n\nscreen two";
  // 21.09 + (55.86000000000001 - 21.09) comes out one rounding step past 55.86000000000001.
  const timings: LyricEvent[] = [
    [1.0, LYRIC_MARKERS.SEGMENT_START],
    [21.09, LYRIC_MARKERS.SEGMENT_END],
    [55.86000000000001, LYRIC_MARKERS.SEGMENT_START],
    [56.5, LYRIC_MARKERS.SEGMENT_END],
  ];

  const screens = addInstrumentalScreens(
    denormalizeTimestamps(compileLyricTimings(fromEvents(lyrics, timings)), 60),
    DEFAULT_OPTIONS,
  );

  expect(screens.map(({ kind }) => kind)).toEqual(["lyrics", "instrumental", "lyrics"]);
  expect(screens[2].startTimestamp).toBe(55.86000000000001);
});

test("addInstrumentalScreens skips gaps shorter than the threshold", () => {
  const lyrics = "screen one\n\nscreen two";
  const timings: LyricEvent[] = [
    [1.0, LYRIC_MARKERS.SEGMENT_START],
    [2.0, LYRIC_MARKERS.SEGMENT_END],
    [20.0, LYRIC_MARKERS.SEGMENT_START],
    [21.0, LYRIC_MARKERS.SEGMENT_END],
  ];
  const withThreshold = (instrumentalThreshold: number) =>
    addInstrumentalScreens(compileLyricTimings(fromEvents(lyrics, timings)), {
      ...DEFAULT_OPTIONS,
      instrumentalThreshold,
    });

  expect(withThreshold(18.5)).toHaveLength(2);
  expect(withThreshold(18)).toHaveLength(3);
});

test("fast lines display early", () => {
  const screens = [
    new LyricsScreen(), // ignored title screen
    new LyricsScreen([
      new LyricsLine([new LyricSegment("one", 1.0)]),
      new LyricsLine([new LyricSegment("two", 2.0)]),
    ]),
    new LyricsScreen([
      new LyricsLine([new LyricSegment("three", 3.0)]),
      new LyricsLine([new LyricSegment("four", 4.0)]),
    ]),
  ];
  screens[1].startTimestamp = 0;
  const denormalizedScreens = denormalizeTimestamps(screens, 4);
  const adjustedScreens = displayQuickLinesEarly(denormalizedScreens, DEFAULT_OPTIONS);
  expect(adjustedScreens[1].lines[0].customDisplayEndTime).toBe(2.5);
  expect(adjustedScreens[2].lines[0].customDisplayStartTime).toBe(2.75);
});

describe("fast lines display early by slot", () => {
  const stagger = (segments: TimedSegment[]) => {
    const screens = denormalizeTimestamps(
      [new LyricsScreen(), ...compileLyricTimings(segments)],
      6,
    );
    return displayQuickLinesEarly(screens, DEFAULT_OPTIONS);
  };

  it("counts a spacer among the slots that leave early", () => {
    const [, first, second] = stagger([
      { text: "one\n", start: 1, spacersBefore: 1 },
      { text: "two\n\n", start: 2 },
      { text: "three\n", start: 3, spacersBefore: 1 },
      { text: "four", start: 4 },
    ]);
    expect(first.lines.map((line) => line.customDisplayEndTime)).toEqual([2.5, undefined]);
    expect(second.lines.map((line) => line.customDisplayStartTime)).toEqual([2.75, undefined]);
  });

  it("measures the gap between screens from the singing, not the count-in", () => {
    const options: KaraokeOptions = {
      ...DEFAULT_OPTIONS,
      countInMode: "line",
      dynamicCountIns: true,
      countInThreshold: 1,
    };
    const screens = addGapCountIns(
      denormalizeTimestamps(
        compileLyricTimings([
          { text: "one\n", start: 1, end: 2 },
          { text: "two\n\n", start: 2, end: 3 },
          { text: "three", start: 5.5, end: 6 },
        ]),
        7,
      ),
      options,
    );
    const [, first, second] = displayQuickLinesEarly([new LyricsScreen(), ...screens], options);
    expect(second.lines[0].timestamp).toBe(4.5);
    expect(first.lines[0].customDisplayEndTime).toBeUndefined();
    expect(second.staggered).toBe(false);
  });

  it("times the early lines from the singing, not the count-in", () => {
    const options: KaraokeOptions = {
      ...DEFAULT_OPTIONS,
      countInMode: "line",
      dynamicCountIns: true,
      countInThreshold: 1,
    };
    const screens = addGapCountIns(
      denormalizeTimestamps(
        compileLyricTimings([
          { text: "one\n", start: 1, end: 2 },
          { text: "two\n\n", start: 3, end: 4 },
          { text: "three", start: 5, end: 6 },
        ]),
        7,
      ),
      options,
    );
    const [, first, second] = displayQuickLinesEarly([new LyricsScreen(), ...screens], options);
    expect(first.lines[1].timestamp).toBe(2);
    expect(first.lines[0].customDisplayEndTime).toBe(3.5);
    expect(second.lines[0].customDisplayStartTime).toBe(3.75);
  });

  describe("after a taller screen", () => {
    const options = { ...DEFAULT_OPTIONS, verticalAlignment: VerticalAlignment.Middle };
    const { size } = options.font;
    const tops = (screen: LyricsScreen) =>
      screen.lines.map((_, i) =>
        screen.getLineY(screen.slotOf(i), size, options.verticalAlignment, options),
      );
    const [, taller, settling, next] = displayQuickLinesEarly(
      denormalizeTimestamps(
        [
          new LyricsScreen(),
          ...compileLyricTimings([
            { text: "one\n", start: 1 },
            { text: "two\n", start: 2 },
            { text: "three\n\n", start: 3 },
            { text: "four\n", start: 4 },
            { text: "five\n\n", start: 5 },
            { text: "six\n", start: 6 },
            { text: "seven", start: 7 },
          ]),
        ],
        8,
      ),
      options,
    );

    it("returns the screen after next to its own layout", () => {
      const own = new LyricsScreen(next.lines);
      expect(next.positionAsSlotCount).toBeUndefined();
      expect(tops(next)).toEqual(tops(own));
    });

    it("keeps the next screen's first line in the taller screen's first slot", () => {
      expect(tops(settling)[0]).toBe(tops(taller)[0]);
      expect(settling.lines[0].customDisplayStartTime).toBe(3.75);
    });

    it("lowers the next screen's second line and shows it once the taller screen ends", () => {
      expect(tops(settling)[1]).toBe(tops(next)[1]);
      expect(settling.lines[1].customDisplayStartTime).toBeUndefined();
      expect(taller.lines.map((line) => line.customDisplayEndTime)).toEqual([
        3.5,
        undefined,
        undefined,
      ]);
    });
  });

  it("leaves a screen alone when only spacers are in those slots", () => {
    const [, first, second] = stagger([
      { text: "one\n", start: 1, spacersBefore: 2 },
      { text: "two\n\n", start: 2 },
      { text: "three\n", start: 3 },
      { text: "four", start: 4 },
    ]);
    expect(first.lines.map((line) => line.customDisplayEndTime)).toEqual([undefined, undefined]);
    expect(second.staggered).toBe(false);
  });

  describe("with lines of several rows", () => {
    // At size 20, every character is 10 wide, so twelve of these words take two rows.
    const fonts = HALF_FONTS;
    const options: KaraokeOptions = { ...DEFAULT_OPTIONS, font: { name: "Half", size: 20 } };
    const words = (count: number) => Array(count).fill("word").join(" ");
    const staggerRows = (segments: TimedSegment[]) => {
      const screens = denormalizeTimestamps(
        [new LyricsScreen(), ...compileLyricTimings(segments)],
        6,
      );
      wrapScreens(screens, options, options, fonts);
      return displayQuickLinesEarly(screens, options);
    };

    it("lets a line leave with all its rows, and fills them with the next screen's lines", () => {
      const [, first, second] = staggerRows([
        { text: words(12) + "\n", start: 1 },
        { text: "two\n", start: 2 },
        { text: "three\n\n", start: 3 },
        { text: "four\n", start: 3.5 },
        { text: "five", start: 4 },
      ]);
      expect(first.lines.map((line) => line.customDisplayEndTime)).toEqual([
        2.5,
        undefined,
        undefined,
      ]);
      expect(second.lines.map((line) => line.customDisplayStartTime)).toEqual([2.75, 2.75]);
      expect(second.earlySlots).toBe(2);
    });

    it("leaves a screen alone when the next screen's first line doesn't fit the slots that leave", () => {
      const [, first, second] = staggerRows([
        { text: "one\n", start: 1 },
        { text: "two\n", start: 2 },
        { text: "three\n\n", start: 3 },
        { text: words(24) + "\n", start: 3.5 },
        { text: "five", start: 4 },
      ]);
      expect(first.lines.map((line) => line.customDisplayEndTime)).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
      expect(second.staggered).toBe(false);
    });
  });
});

describe("deferScreenStarts", () => {
  function screenStartingAt(displayStart: number, firstLineTime: number): LyricsScreen {
    const screen = new LyricsScreen([
      new LyricsLine([new LyricSegment("la", firstLineTime, firstLineTime + 1)]),
    ]);
    screen.startTimestamp = displayStart;
    return screen;
  }

  it("pulls a far-too-early display start to just before the first line", () => {
    // First line at 2:14 but display would start at 0 -> defer to leadIn before the line.
    const screens = deferScreenStarts([screenStartingAt(0, 134)]);
    expect(screens[0].startTimestamp).toBe(133); // 134 - 1s lead-in
  });

  it("leaves a screen that already displays close to its line alone", () => {
    const screens = deferScreenStarts([screenStartingAt(8, 10)]); // only 2s early
    expect(screens[0].startTimestamp).toBe(8);
  });
});

describe("the title screen", () => {
  const options: KaraokeOptions = {
    ...DEFAULT_OPTIONS,
    titleScreenDuration: 6,
    countInMode: "none",
    instrumentalThreshold: 0,
    addStaggeredLines: false,
  };
  const song = (start: number) => [
    { text: "a\n", start, end: start + 1 },
    { text: "b", start: start + 2, end: start + 3 },
  ];
  const songOffset = (screens: LyricsScreen[]) =>
    screens.reduce((sum, screen) => sum + screen.audioDelay, 0);

  it("lasts as long as it is set to, and delays a song with a shorter intro by that much", () => {
    const screens = createScreens(song(5), 30, "T", "A", options);

    expect(screens.map((screen) => screen.kind)).toEqual(["title", "lyrics"]);
    expect(screens[0].endTimestamp).toBe(6);
    expect(songOffset(screens)).toBe(6);
    expect(screens[1].lines[0].timestamp).toBe(11);
  });

  it("keeps the lyrics of a song with a longer intro until it has ended", () => {
    const screens = createScreens(song(8), 30, "T", "A", options);

    expect(songOffset(screens)).toBe(0);
    expect(screens[1].startTimestamp).toBe(6);
  });

  it("is followed by an instrumental screen until the lyrics, whether the title is shown or not", () => {
    const breaks: KaraokeOptions = { ...options, instrumentalThreshold: 8 };
    const bar = (screens: LyricsScreen[]) => {
      const screen = screens.find((s) => s.kind === "instrumental");
      return screen && [screen.startTimestamp, screen.lines[0].segments[0].endTimestamp];
    };

    expect(bar(createScreens(song(15), 30, "T", "A", breaks))).toEqual([6, 15]);
    expect(bar(createScreens(song(15), 30, "T", "A", { ...breaks, showTitle: false }))).toEqual([
      6, 15,
    ]);
    expect(bar(createScreens(song(12), 30, "T", "A", breaks))).toBeUndefined();
  });

  it("leaves an instrumental screen from the start when it is off", () => {
    const screens = createScreens(song(9), 30, "T", "A", {
      ...options,
      addTitleScreen: false,
      instrumentalThreshold: 8,
    });

    expect(screens.map((screen) => screen.kind)).toEqual(["instrumental", "lyrics"]);
    expect([screens[0].startTimestamp, screens[0].endTimestamp]).toEqual([0, 9]);
    expect(screens[1].startTimestamp).toBe(9);
  });

  it("stays blank without the title, and moves the song the same way", () => {
    const blank: KaraokeOptions = { ...options, showTitle: false };
    const short = createScreens(song(5), 30, "T", "A", blank);
    const long = createScreens(song(8), 30, "T", "A", blank);

    expect(short.map((screen) => screen.kind)).toEqual(["lyrics"]);
    expect(songOffset(short)).toBe(6);
    expect([short[0].startTimestamp, short[0].lines[0].timestamp]).toEqual([6, 11]);
    expect(songOffset(long)).toBe(0);
    expect(long[0].startTimestamp).toBe(6);
  });
});

describe("stored display periods", () => {
  const plain: KaraokeOptions = {
    ...DEFAULT_OPTIONS,
    addTitleScreen: false,
    countInMode: "none",
    instrumentalThreshold: 0,
    addStaggeredLines: false,
  };
  const lyricScreens = (screens: LyricsScreen[]) => screens.filter((s) => s.kind === "lyrics");
  const lines = (screens: LyricsScreen[]) => lyricScreens(screens).flatMap((s) => s.lines);
  const periods = (screens: LyricsScreen[]) =>
    lines(screens).map((line) => [line.customDisplayStartTime, line.customDisplayEndTime]);

  // Two screens: "a b" and "c", then "d" 3 s later.
  const song = (first: Partial<TimedSegment> = {}, fourth: Partial<TimedSegment> = {}) => [
    { text: "a_", start: 10, ...first },
    { text: "b\n", start: 11, end: 12 },
    { text: "c\n\n", start: 13, end: 14 },
    { text: "d", start: 17, end: 18, ...fourth },
  ];

  it("replace the automatic period, and leave the other lines automatic", () => {
    const screens = createScreens(song({ displayStart: 5, displayEnd: 20 }), 30, "T", "A", plain);

    expect(periods(screens)).toEqual([
      [5, 20],
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });

  it("are widened to contain the line's timings", () => {
    const screens = createScreens(
      song({ displayStart: 10.5, displayEnd: 11 }),
      30,
      "T",
      "A",
      plain,
    );

    expect(periods(screens)[0]).toEqual([10, 12]);
  });

  it("are widened to contain a count-in, and released when count-ins are off", () => {
    const stored = song({ displayStart: 9.5 });
    const withCountIns = createScreens(stored, 30, "T", "A", { ...plain, countInMode: "screen" });
    const without = createScreens(stored, 30, "T", "A", plain);

    expect(lines(withCountIns)[0].customDisplayStartTime).toBe(10 - DEFAULT_COUNT_IN_DURATION);
    expect(lines(without)[0].customDisplayStartTime).toBe(9.5);
  });

  it("move with a title screen that delays the song", () => {
    const screens = createScreens(
      song({ start: 1.5, displayStart: 1, displayEnd: 13 }),
      30,
      "T",
      "A",
      { ...plain, addTitleScreen: true },
    );

    expect(periods(screens)[0]).toEqual([1 + TITLE_SCREEN_DURATION, 13 + TITLE_SCREEN_DURATION]);
  });

  it("move with a quick-start count-in", () => {
    const options: KaraokeOptions = { ...plain, countInMode: "screen" };
    const screens = createScreens(song({ start: 0.5, displayEnd: 13 }), 30, "T", "A", options);
    const shift = DEFAULT_COUNT_IN_DURATION - 0.5;

    expect(lines(screens)[0].customDisplayEndTime).toBe(13 + shift);
  });

  it("replace what the staggered-lines pass set", () => {
    const segments = [
      { text: "a\n", start: 10, end: 11, displayEnd: 20 },
      { text: "b\n", start: 11, end: 12 },
      { text: "c\n\n", start: 12, end: 13 },
      { text: "d\n", start: 13.5, end: 14 },
      { text: "e", start: 14, end: 15 },
    ];
    const options: KaraokeOptions = { ...plain, addTitleScreen: true, addStaggeredLines: true };
    const [a, b] = lines(createScreens(segments, 30, "T", "A", options));

    expect([a.customDisplayEndTime, b.customDisplayEndTime]).toEqual([20, 12.5]);
  });

  it("end the title screen at the earliest stored start", () => {
    const options: KaraokeOptions = { ...plain, addTitleScreen: true };
    const [title] = createScreens(song({ displayStart: 2 }), 30, "T", "A", options);

    expect(title.lines.map((line) => line.customDisplayEndTime)).toEqual([2, 2]);
  });

  it("keep a title screen that loses every line, with its audio delay", () => {
    const options: KaraokeOptions = { ...plain, addTitleScreen: true };
    const [title] = createScreens(song({ start: 1.5, displayStart: 0 }), 30, "T", "A", options);

    // The song is delayed by the title screen, so a stored 0 still shows after it.
    expect(title.lines).toHaveLength(2);

    const [early] = createScreens(song({ displayStart: 0 }), 30, "T", "A", options);
    expect(early.kind).toBe("title");
    expect(early.lines).toHaveLength(0);
  });

  it("shorten an instrumental screen, or remove it", () => {
    // Above the 10 s intro, so only the break between the screens is added.
    const options: KaraokeOptions = { ...plain, instrumentalThreshold: 12 };
    const bar = (screens: LyricsScreen[]) => {
      const screen = screens.find((s) => s.kind === "instrumental");
      return screen && [screen.startTimestamp, screen.lines[0].segments[0].endTimestamp];
    };
    const late = (displayStart: number) => song({}, { start: 30, end: 31, displayStart });

    expect(bar(createScreens(song({}, { start: 30, end: 31 }), 40, "T", "A", options))).toEqual([
      14, 30,
    ]);
    expect(bar(createScreens(late(20), 40, "T", "A", options))).toEqual([14, 20]);
    expect(bar(createScreens(late(14), 40, "T", "A", options))).toBeUndefined();
  });

  it("are ignored when the option is off, along with the screens giving way", () => {
    const options: KaraokeOptions = {
      ...plain,
      addTitleScreen: true,
      instrumentalThreshold: 8,
      useStoredDisplayPeriods: false,
    };
    const screens = createScreens(
      song({ displayStart: 2, displayEnd: 20 }, { start: 30, end: 31, displayStart: 14 }),
      40,
      "T",
      "A",
      options,
    );

    expect(periods(screens)[0]).toEqual([undefined, undefined]);
    expect(screens[0].lines.map((line) => line.customDisplayEndTime)).toEqual([
      undefined,
      undefined,
    ]);
    expect(screens.some((screen) => screen.kind === "instrumental")).toBe(true);
  });

  it("end the title screen at another voice's stored start", () => {
    const tracks = [
      { voice: "Anna", segments: song(), options: { ...plain, addTitleScreen: true } },
      { voice: "Ben", segments: [{ text: "hm", start: 12, displayStart: 3 }], options: plain },
    ];
    const ass = createMultiVoiceAssFile(tracks, 30, "Title", "Artist");
    const titleEvent = ass.split("\n").find((row) => row.endsWith("}Title"));

    expect(titleEvent?.split(",")[2]).toBe("0:00:03.00");
  });
});

describe("LyricsLine.adjustTimestamps", () => {
  it("shifts the display times and keeps the fades", () => {
    const line = new LyricsLine([new LyricSegment("a", 1, 2)]);
    Object.assign(line, {
      customDisplayStartTime: 0.5,
      customDisplayEndTime: 3,
      storedDisplayStart: 0.25,
      storedDisplayEnd: 4,
      fadeInDuration: 0.1,
      fadeOutDuration: 0.2,
    });

    expect(line.adjustTimestamps(10)).toMatchObject({
      customDisplayStartTime: 10.5,
      customDisplayEndTime: 13,
      storedDisplayStart: 10.25,
      storedDisplayEnd: 14,
      fadeInDuration: 0.1,
      fadeOutDuration: 0.2,
    });
  });

  it("draws a stored display start of 0 from 0", () => {
    const line = new LyricsLine([new LyricSegment("a", 1, 2)]);
    line.customDisplayStartTime = 0;

    expect(line.toAssEvents(5, 10, "Default", [0])[0]).toMatch(/^Dialogue: 0,0:00:00\.00,/);
  });
});
