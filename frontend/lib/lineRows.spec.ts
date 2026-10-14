import { describe, expect, test } from "vitest";
import { rowBudget, wrapScreens } from "./lineRows";
import { HALF, HALF_FONTS } from "./testFonts";
import { FontLibrary } from "./textWidth";
import {
  DEFAULT_KARAOKE_OPTIONS,
  KaraokeOptions,
  LyricSegment,
  LyricsLine,
  LyricsScreen,
} from "./timing";

// At size 20, every character is 10 wide and a space 5.
const fonts = HALF_FONTS;
const options: KaraokeOptions = {
  ...DEFAULT_KARAOKE_OPTIONS,
  font: { name: "Half", size: 20 },
  countInMode: "none",
};

/**
 * A line with one segment per word, a second each.
 */
function wordLine(text: string, start = 0): LyricsLine {
  const words = text.split(/(?<= )/);
  return new LyricsLine(words.map((word, i) => new LyricSegment(word, start + i, start + i + 1)));
}

function wrapped(lines: LyricsLine[], kind: LyricsScreen["kind"] = "lyrics"): LyricsScreen {
  const screen = new LyricsScreen(lines);
  screen.kind = kind;
  wrapScreens([screen], options, { ...options, font: { name: "Half", size: 40 } }, fonts);
  return screen;
}

const rowTexts = (line: LyricsLine) => line.rows.map((row) => row.map((s) => s.text).join(""));

// Twelve words of 45 with their spaces, 535 in all, which takes two rows of a budget of 505.
const TWELVE_WORDS = "pale moon ride slow over dark hill when snow hush fell down";

describe("wrapScreens", () => {
  test("leaves a line that fits as it is", () => {
    const line = wordLine("pale moon rising");
    const segments = line.segments;
    wrapped([line]);
    expect(line.rowCount).toBe(1);
    expect(line.segments).toBe(segments);
  });

  test("wraps a line too wide into even rows, and moves the lines below down", () => {
    const long = wordLine(TWELVE_WORDS);
    const below = wordLine("lanterns home", 20);
    const screen = wrapped([long, below]);
    expect(rowTexts(long)).toEqual([
      "pale moon ride slow over dark ",
      "hill when snow hush fell down",
    ]);
    expect(long.segments[6].rowStart).toBe("wrap");
    expect([screen.slotOf(0), screen.slotOf(1)]).toEqual([0, 2]);
    expect(screen.slots).toBe(3);
  });

  test("breaks a line that fits where its lyrics break it", () => {
    const line = wordLine("pale moon rising");
    line.segments[2].rowStart = "break";
    wrapped([line]);
    expect(rowTexts(line)).toEqual(["pale moon ", "rising"]);
    expect(line.segments[2].rowStart).toBe("break");
  });

  test("still wraps a part between two breaks that is too wide", () => {
    const line = wordLine("so " + TWELVE_WORDS);
    line.segments[1].rowStart = "break";
    wrapped([line]);
    expect(rowTexts(line)).toEqual([
      "so ",
      "pale moon ride slow over dark ",
      "hill when snow hush fell down",
    ]);
    expect(line.segments.map((segment) => segment.rowStart).filter(Boolean)).toEqual([
      "break",
      "wrap",
    ]);
  });

  test("keeps the spacers around the lines", () => {
    const long = wordLine(TWELVE_WORDS);
    const below = wordLine("lanterns home", 20);
    long.slot = 1;
    below.slot = 3;
    const screen = new LyricsScreen([long, below]);
    screen.slotCount = 5;
    wrapScreens([screen], options, options, fonts);
    expect([screen.slotOf(0), screen.slotOf(1), screen.slots]).toEqual([1, 4, 6]);
  });

  test("splits a syllable a row starts inside, so that its sweep keeps its pace", () => {
    const line = new LyricsLine([new LyricSegment(TWELVE_WORDS, 10, 20)]);
    wrapped([line]);
    const [first, second] = line.segments;
    expect([first.text, second.text]).toEqual([
      "pale moon ride slow over dark ",
      "hill when snow hush fell down",
    ]);
    expect(second.rowStart).toBe("wrapInSyllable");
    expect(first.timestamp).toBe(10);
    expect(first.endTimestamp).toBeCloseTo(10 + (10 * 270) / 535);
    expect(second.timestamp).toBe(first.endTimestamp);
    expect(second.endTimestamp).toBe(20);
  });

  test("keeps a count-in with the first word", () => {
    const line = wordLine("o " + TWELVE_WORDS);
    line.segments[0].countIn = true;
    line.segments[0].text = "{\\alpha&H00&}" + "•".repeat(40) + " ";
    wrapped([line]);
    expect(line.rows[0].length).toBeGreaterThan(1);
  });

  test("wraps CJK text between characters, but not before its punctuation", () => {
    const text = "漢".repeat(30) + "。" + "漢".repeat(30);
    const line = new LyricsLine([new LyricSegment(text, 0, 61)]);
    wrapped([line]);
    expect(rowTexts(line)).toEqual(["漢".repeat(30) + "。", "漢".repeat(30)]);
  });

  test("leaves room for the ink of a font whose outlines it can't read", () => {
    const unread = new FontLibrary({}, { Half: { ...HALF, ink: undefined } });
    // Eleven words take 490 of 505, and the ink may reach 0.47 of the size out on each side.
    const line = wordLine("aaaa ".repeat(11).trim());
    wrapScreens([new LyricsScreen([line])], options, options, unread);
    expect(line.rowCount).toBe(2);
  });

  test("measures the title in the title's style", () => {
    const title = new LyricsLine([new LyricSegment("A rather longer title of some length", 0, 2)]);
    wrapped([title], "title");
    expect(title.rowCount).toBe(2);
  });

  test("leaves room for a count-in the line may still get", () => {
    // The words take 490, and the mark 13 more, of a budget of 491.
    const counted: KaraokeOptions = {
      ...options,
      countInMode: "screen",
      dynamicCountIns: true,
      countInText: "",
      outlineWidth: 0,
      shadowX: 16,
    };
    expect(rowBudget(counted)).toBe(491);
    const text = "aaaa ".repeat(11).trim();
    const screen = new LyricsScreen([wordLine(text), wordLine(text, 20)]);
    wrapScreens([screen], counted, counted, fonts);
    expect(screen.lines.map((line) => line.rowCount)).toEqual([2, 1]);
  });
});
