import { describe, expect, test } from "vitest";
import {
  BRACKETS_REMOVED,
  DISPLAY_PERIOD_WIDENED,
  MARKUP_REMOVED,
  MUTE_PERIOD_WIDENED,
  SPACER_BOUNDS_DROPPED,
  SPACER_MUTE_DROPPED,
  SPACER_PAGE_DROPPED,
} from "./importWarnings";
import { parseLyrics } from "./timing";
import { TimedSegment, fromLyric } from "./timedSegments";
import {
  TimingsTextError,
  formatTimecode,
  isTimingsText,
  parseTimingsText,
  parseVoiceTimingsText,
  writeTimingsText,
  writeVoiceTimingsText,
} from "./timingsText";

const file = (...rows: string[]) => rows.join("\n") + "\n";
const signed = (...rows: string[]) => file("Toul timings 3", ...rows);
const voice = (text: string, name = "Voice 1") => parseTimingsText(text).voices[name];
const texts = (segments: TimedSegment[]) => segments.map(({ text }) => text);

describe("isTimingsText", () => {
  test("recognises the signature, whatever its version", () => {
    expect(isTimingsText(file("Toul timings 1"))).toBe(true);
    expect(isTimingsText("\uFEFF\r\n# exported\r\n  Toul timings 7  \r\n")).toBe(true);
  });

  test("doesn't take lyrics or JSON for timings", () => {
    expect(isTimingsText("[Anna] Toul timings 1")).toBe(false);
    expect(isTimingsText("Hel/lo_world\nToul timings 1")).toBe(false);
    expect(isTimingsText('{"version": 2, "voices": {}}')).toBe(false);
    expect(isTimingsText("")).toBe(false);
  });
});

describe("parseTimingsText", () => {
  test("reads the example of the format", () => {
    const { voices, warnings } = parseTimingsText(
      file(
        "Toul timings 1",
        "",
        'voice "Voice 1"',
        "",
        "page",
        "",
        "00:25.33",
        '"▅▅▅▅▅▅▅▅▅▅▅"  00:25.87',
        "00:28.09",
        "",
        "00:25.33",
        '"Been "  00:27.99',
        '"a "     00:28.37',
        '"fol"    00:30.52',
        '"low"    00:31.01  00:31.77',
        "00:35.71",
        "",
        "page",
        "",
        "-",
        "-",
        "",
        "00:40.15",
        '"▅▅▅▅▅▅▅▅▅▅▅"  00:40.57',
        "00:42.29",
      ),
    );
    expect(voices["Voice 1"]).toEqual([
      { text: "▅▅▅▅▅▅▅▅▅▅▅\n", start: 25.87, displayStart: 25.33, displayEnd: 28.09 },
      { text: "Been_", start: 27.99, displayStart: 25.33, displayEnd: 35.71 },
      { text: "a_", start: 28.37 },
      { text: "fol/", start: 30.52 },
      { text: "low\n\n", start: 31.01, end: 31.77 },
      {
        text: "▅▅▅▅▅▅▅▅▅▅▅",
        start: 40.57,
        displayStart: 40.15,
        displayEnd: 42.29,
        spacersBefore: 1,
      },
    ]);
    expect(warnings).toEqual([]);
  });

  test("puts rows before any voice row in the default voice", () => {
    expect(texts(voice(signed("-", '"hi"', "-")))).toEqual(["hi"]);
  });

  test("reads several voices, with escaped quotes in their names", () => {
    const { voices } = parseTimingsText(
      signed('voice "Anna"', "-", '"one"  00:01.00', "-", 'voice "Ben \\"B\\""', "-", '"two"', "-"),
    );
    expect(voices).toEqual({
      Anna: [{ text: "one", start: 1 }],
      'Ben "B"': [{ text: "two" }],
    });
  });

  test("reads every form of a syllable row", () => {
    const segments = voice(
      signed(
        "-",
        '"a "  00:01.00  00:01.50',
        '"b "  00:02.00',
        '"c "  -  00:03.50',
        '"d "',
        '"e "  -  -',
        '"f"  00:04.00  -',
        "-",
      ),
    );
    expect(segments).toEqual([
      { text: "a_", start: 1, end: 1.5 },
      { text: "b_", start: 2 },
      { text: "c_", end: 3.5 },
      { text: "d_" },
      { text: "e_" },
      { text: "f", start: 4 },
    ]);
  });

  test("reads escapes, and keeps a backslash before anything else", () => {
    expect(texts(voice(signed("-", '"say \\"hi\\" \\\\ \\n"', "-")))).toEqual(['say "hi" \\ \\n']);
  });

  test("ignores comments outside quotes only", () => {
    const segments = voice(
      signed("# a comment", "-  # automatic", '"a # b"  00:01.00  # the first', "-"),
    );
    expect(segments).toEqual([{ text: "a # b", start: 1 }]);
  });

  test("reads one to three digit minutes", () => {
    const segments = voice(signed("-", '"a "  1:02.03', '"b "  12:00.00', '"c"  123:00.00', "-"));
    expect(segments.map(({ start }) => start)).toEqual([62.03, 720, 7380]);
  });

  test("reads CRLF rows, a BOM, and indented rows", () => {
    const text = '﻿Toul timings 1\r\n\r\n  -\r\n  "a"  00:01.00  \r\n-\r\n';
    expect(voice(text)).toEqual([{ text: "a", start: 1 }]);
  });

  test("ignores a page with no lines", () => {
    expect(
      texts(voice(signed("page", "page", "-", '"a"', "-", "page", "page", "-", '"b"', "-"))),
    ).toEqual(["a\n\n", "b"]);
  });

  test("reads an empty voice", () => {
    expect(parseTimingsText(signed('voice "Anna"')).voices).toEqual({ Anna: [] });
    expect(parseTimingsText(file("Toul timings 1")).voices).toEqual({});
  });

  describe("errors", () => {
    const rowOf = (text: string) => {
      try {
        parseTimingsText(text);
      } catch (e) {
        expect(e).toBeInstanceOf(TimingsTextError);
        return (e as TimingsTextError).row;
      }
      throw new Error("No error was thrown");
    };

    test("requires the signature", () => {
      expect(() => parseTimingsText(file("", "-", '"a"', "-"))).toThrow(
        'Row 2: A timings file starts with "Toul timings 3".',
      );
      expect(() => parseTimingsText("")).toThrow("Row 1:");
    });

    test("refuses an unknown version", () => {
      expect(() => parseTimingsText(file("Toul timings 4"))).toThrow(
        "Row 1: Version 4 of the timings format isn't supported.",
      );
    });

    test("refuses a row it doesn't know", () => {
      expect(() => parseTimingsText(signed("-", "a", "-"))).toThrow(
        "Row 3: This row isn't a voice, a page, a time, a syllable or a break.",
      );
      expect(rowOf(signed("-", '"a" 1.00', "-"))).toBe(3);
      expect(rowOf(signed("-", '"a" 00:60.00', "-"))).toBe(3);
      expect(rowOf(signed("-", '"a" 00:01.00 00:02.00 00:03.00', "-"))).toBe(3);
      expect(rowOf(signed("-", '"a', "-"))).toBe(3);
    });

    test("refuses a voice with no name, or two sections for one voice", () => {
      expect(() => parseTimingsText(signed('voice ""'))).toThrow("Row 2: A voice needs a name.");
      expect(() => parseTimingsText(signed('voice "A"', 'voice "B"', 'voice "A"'))).toThrow(
        'Row 4: The voice "A" already has a section.',
      );
      expect(rowOf(signed("-", '"a"', "-", 'voice "Voice 1"'))).toBe(5);
    });

    test("refuses a syllable outside a line", () => {
      expect(() => parseTimingsText(signed("page", '"a"'))).toThrow(
        "Row 3: A syllable has to be inside a line, between a header and a footer.",
      );
      expect(() => parseTimingsText(signed("page", '"a"'))).not.toThrow("missing its footer");
    });

    test("points at the line before when a footer seems missing", () => {
      expect(() => parseTimingsText(signed("-", '"a"', "-", '"b"', "-"))).toThrow(
        "Row 5: A syllable has to be inside a line, between a header and a footer. The line before may be missing its footer.",
      );
    });

    test("names the header of a line left open", () => {
      expect(rowOf(signed("page", "00:01.00", '"a"', "page"))).toBe(3);
      expect(rowOf(signed("-", '"a"', 'voice "Anna"'))).toBe(2);
      expect(() => parseTimingsText(signed("", "-", '"a"'))).toThrow(
        "Row 3: This line has no footer.",
      );
    });

    test("refuses times that go backwards, naming the row", () => {
      expect(() =>
        parseTimingsText(signed("-", '"a "  00:02.00', "-", "-", '"b"  00:01.00', "-")),
      ).toThrow("Row 6: Timecodes must not go backwards: 00:02.00 is followed by 00:01.00.");
      expect(rowOf(signed("-", '"a"  00:02.00  00:01.00', "-"))).toBe(3);
      expect(rowOf(signed("-", '"a "  00:01.00  00:03.00', '"b"  00:02.00', "-"))).toBe(4);
    });

    test("leaves an end with no start out of the check", () => {
      expect(
        voice(signed("-", '"a "  00:02.00', '"b "  -  00:01.00', '"c"  00:03.00', "-")),
      ).toEqual([
        { text: "a_", start: 2 },
        { text: "b_", end: 1 },
        { text: "c", start: 3 },
      ]);
    });

    test("refuses an empty syllable before the last one with text", () => {
      expect(() => parseTimingsText(signed("-", '"a "', '""', '"b"', "-"))).toThrow(
        "Row 4: A syllable needs text, unless it comes after the voice's last syllable with text.",
      );
      expect(rowOf(signed("-", '" "', "-", "-", '"b"', "-"))).toBe(3);
    });
  });

  test("keeps empty syllables after the last one with text", () => {
    const segments = voice(
      signed("-", '"a"  00:01.00', '""  00:02.00', "-", "-", '""  00:03.00', "-"),
    );
    expect(segments).toEqual([
      { text: "a", start: 1 },
      { text: "", start: 2 },
      { text: "", start: 3 },
    ]);
  });

  describe("separators", () => {
    test("come from the structure and the trailing spaces", () => {
      const segments = voice(
        signed(
          "page",
          "-",
          '"to"',
          '"mor"',
          '"row "',
          '"night "',
          "-",
          "-",
          '"again"',
          "-",
          "page",
          "-",
          '"end"',
          "-",
        ),
      );
      expect(texts(segments)).toEqual(["to/", "mor/", "row_", "night\n", "again\n\n", "end"]);
    });

    test("move a leading space to the previous syllable", () => {
      expect(texts(voice(signed("-", '"to"', '" mor"', '"row"', "-")))).toEqual([
        "to_",
        "mor/",
        "row",
      ]);
    });

    test("ignore spaces around a line", () => {
      expect(texts(voice(signed("-", '"a "', "-", "-", '" b "', "-")))).toEqual(["a\n", "b"]);
    });
  });

  describe("spacers", () => {
    test("are counted on the line below them", () => {
      const segments = voice(
        signed("-", "-", "-", '"a"', "-", "-", "-", "-", "-", "-", '"b"', "-"),
      );
      expect(segments).toEqual([
        { text: "a\n", spacersBefore: 1 },
        { text: "b", spacersBefore: 2 },
      ]);
    });

    test("at the bottom of a page are counted on its last line", () => {
      const segments = voice(
        signed("-", '"a "', '"b"', "-", "-", "-", "page", "-", "-", "-", '"c"', "-", "-", "-"),
      );
      expect(segments).toEqual([
        { text: "a_", spacersAfter: 1 },
        { text: "b\n\n" },
        { text: "c", spacersBefore: 1, spacersAfter: 1 },
      ]);
    });
  });

  describe("removes what the lyrics can't hold", () => {
    test("a / or _ in the text", () => {
      const { voices, warnings } = parseTimingsText(signed("-", '"a/b "', '"c_d"', "-"));
      expect(texts(voices["Voice 1"])).toEqual(["ab_", "cd"]);
      expect(warnings).toEqual([`${MARKUP_REMOVED} (×2)`]);
    });

    test("brackets starting a line", () => {
      const { voices, warnings } = parseTimingsText(
        signed("-", '"[Anna] "', '"sings"', "-", "-", '"a [b]"', "-"),
      );
      expect(texts(voices["Voice 1"])).toEqual(["Anna_", "sings\n", "a [b]"]);
      expect(warnings).toEqual([BRACKETS_REMOVED]);
    });

    test("the display period of a spacer", () => {
      const { voices, warnings } = parseTimingsText(
        signed("00:01.00", "00:02.00", "-", '"a"  00:03.00', "-"),
      );
      expect(voices["Voice 1"]).toEqual([{ text: "a", start: 3, spacersBefore: 1 }]);
      expect(warnings).toEqual([SPACER_BOUNDS_DROPPED]);
    });

    test("a page holding only spacers", () => {
      const { voices, warnings } = parseTimingsText(
        signed("-", '"a"', "-", "page", "-", "-", "-", "-", "page", "-", '"b"', "-"),
      );
      expect(voices["Voice 1"]).toEqual([{ text: "a\n\n" }, { text: "b" }]);
      expect(warnings).toEqual([SPACER_PAGE_DROPPED]);
    });
  });

  describe("row breaks", () => {
    test("follow the syllable before them, at a word break or within a word", () => {
      expect(
        texts(voice(signed("-", '"home "  00:01.00', "|", '"o"  00:02.00', "|", '"ver"', "-"))),
      ).toEqual(["home|", "o/|", "ver"]);
    });

    test("count once when repeated", () => {
      expect(texts(voice(signed("-", '"a "', "|", "|", '"b"', "-")))).toEqual(["a|", "b"]);
    });

    test("are refused before a line's first syllable or after its last, naming the row", () => {
      expect(() => parseTimingsText(signed("-", "|", '"a"', "-"))).toThrow(
        "Row 3: A break has to come after a syllable of its line.",
      );
      expect(() => parseTimingsText(signed("-", '"a"', "|", "-"))).toThrow(
        "Row 4: A break has to come before a syllable of its line.",
      );
      expect(() => parseTimingsText(signed("|"))).toThrow(
        "Row 2: A break has to come after a syllable of its line.",
      );
    });

    test("are removed from a syllable's text", () => {
      const { voices, warnings } = parseTimingsText(signed("-", '"a|b"', "-"));
      expect(texts(voices["Voice 1"])).toEqual(["ab"]);
      expect(warnings).toEqual([MARKUP_REMOVED]);
    });
  });

  describe("display periods", () => {
    test("are widened to contain the line's timings, with one warning", () => {
      const { voices, warnings } = parseTimingsText(
        signed(
          "00:02.00",
          '"a "  00:01.00',
          '"b"   00:01.50',
          "00:01.20",
          "00:02.50",
          '"c"  00:03.00  00:03.50',
          "00:03.20",
        ),
      );
      // The open end of "b" runs to the start of "c".
      expect(voices["Voice 1"]).toEqual([
        { text: "a_", start: 1, displayStart: 1, displayEnd: 3 },
        { text: "b\n", start: 1.5 },
        { text: "c", start: 3, end: 3.5, displayStart: 2.5, displayEnd: 3.5 },
      ]);
      expect(warnings).toEqual([`${DISPLAY_PERIOD_WIDENED} (×2)`]);
    });

    test("leave the last line's open end alone", () => {
      const { voices, warnings } = parseTimingsText(signed("-", '"a"  00:01.00', "00:01.00", ""));
      expect(voices["Voice 1"][0].displayEnd).toBe(1);
      expect(warnings).toEqual([]);
    });

    test("are dropped on a line that draws nothing", () => {
      const [segment] = voice(signed("00:01.00", '"a"', "00:02.00"));
      expect(segment).not.toHaveProperty("displayStart");
      expect(segment).not.toHaveProperty("displayEnd");
    });

    test("count an interpolated hole as drawn", () => {
      const { voices } = parseTimingsText(
        signed("-", '"a"  00:01.00', "-", "00:01.50", '"b"', "00:01.60", "-", '"c"  00:03.00', "-"),
      );
      expect(voices["Voice 1"][1].displayStart).toBe(1.5);
      expect(voices["Voice 1"][1].displayEnd).toBe(3);
    });
  });

  describe("muted periods", () => {
    test("follow the display bounds in the header and footer", () => {
      const { voices, warnings } = parseTimingsText(
        signed(
          "00:25.33  00:25.10",
          '"Been "  00:27.99',
          '"a "     00:28.37',
          '"long "  00:28.74  00:29.50',
          "-  00:31.20",
        ),
      );
      expect(voices["Voice 1"][0]).toEqual({
        text: "Been_",
        start: 27.99,
        displayStart: 25.33,
        muteStart: 25.1,
        muteEnd: 31.2,
      });
      expect(warnings).toEqual([]);
    });

    test("are automatic in a version 1 file", () => {
      const [segment] = voice(file("Toul timings 1", "00:00.50", '"a"  00:01.00', "-"));
      expect(segment).toEqual({ text: "a", start: 1, displayStart: 0.5 });
    });

    test("are clamped to the line's timings, with one warning", () => {
      const { voices, warnings } = parseTimingsText(
        signed(
          "-  00:01.50",
          '"a "  00:01.00  00:01.10',
          '"b"   00:01.20  00:02.00',
          "-  00:01.80",
          "-  00:03.50",
          '"c"  00:03.00  00:04.00',
          "-",
        ),
      );
      expect(voices["Voice 1"][0]).toMatchObject({ muteStart: 1.1, muteEnd: 2 });
      expect(voices["Voice 1"][2]).toMatchObject({ muteStart: 3.2 });
      expect(warnings).toEqual([`${MUTE_PERIOD_WIDENED} (×2)`]);
    });

    test("are dropped on a spacer", () => {
      const { voices, warnings } = parseTimingsText(
        signed("-  00:01.00", "-", "-", '"a"  00:03.00', "-"),
      );
      expect(voices["Voice 1"]).toEqual([{ text: "a", start: 3, spacersBefore: 1 }]);
      expect(warnings).toEqual([SPACER_MUTE_DROPPED]);
    });
  });
});

describe("writeTimingsText", () => {
  test("writes a stored mute bound after the display bound, and leaves out an automatic one", () => {
    const segments: TimedSegment[] = [
      { text: "Been_", start: 27.99, displayStart: 25.33, muteStart: 25.1, muteEnd: 31.2 },
      { text: "long", start: 28.74, end: 29.5 },
    ];
    expect(writeVoiceTimingsText(segments)).toBe(
      file(
        "page",
        "",
        "00:25.33  00:25.10",
        '"Been "  00:27.99',
        '"long"   00:28.74  00:29.50',
        "-  00:31.20",
      ),
    );
  });

  test("lays out pages and lines, aligning the times per line", () => {
    const segments: TimedSegment[] = [
      { text: "Been_", start: 27.99, displayStart: 25.33, displayEnd: 35.71 },
      { text: "a_", start: 28.37 },
      { text: "fol/", start: 30.52 },
      { text: "low\n\n", start: 31.01, end: 31.77 },
      { text: "Some/", start: 70.15 },
      { text: "thing_" },
      { text: "some/", start: 70.87 },
      { text: "where", start: 71.9, end: 72.39 },
    ];
    expect(writeTimingsText({ "Voice 1": segments }, ["Voice 1"])).toBe(
      file(
        "Toul timings 3",
        "",
        'voice "Voice 1"',
        "",
        "page",
        "",
        "00:25.33",
        '"Been "  00:27.99',
        '"a "     00:28.37',
        '"fol"    00:30.52',
        '"low"    00:31.01  00:31.77',
        "00:35.71",
        "",
        "page",
        "",
        "-",
        '"Some"    01:10.15',
        '"thing "',
        '"some"    01:10.87',
        '"where"   01:11.90  01:12.39',
        "-",
      ),
    );
  });

  test("writes an end with no start, and escapes quotes and backslashes", () => {
    const text = writeTimingsText({ 'A "b"': [{ text: 'x"\\', end: 1 }] }, ['A "b"']);
    expect(text).toBe(
      file(
        "Toul timings 3",
        "",
        'voice "A \\"b\\""',
        "",
        "page",
        "",
        "-",
        '"x\\"\\\\"  -  00:01.00',
        "-",
      ),
    );
  });

  test("writes the lyrics' voices in order, then the timed voices they no longer name", () => {
    const text = writeTimingsText(
      {
        Old: [{ text: "a", start: 1 }],
        Anna: [{ text: "b" }],
        Gone: [{ text: "c" }],
        Ben: [{ text: "d", start: 2 }],
      },
      ["Ben", "Anna", "Cleo"],
    );
    expect(text.split("\n").filter((row) => row.startsWith("voice"))).toEqual([
      'voice "Ben"',
      'voice "Anna"',
      'voice "Old"',
    ]);
  });

  test("writes spacers as a header followed directly by its footer", () => {
    expect(
      writeVoiceTimingsText([
        { text: "a\n", start: 1, spacersBefore: 1 },
        { text: "b", start: 2, spacersBefore: 1, spacersAfter: 2 },
      ]),
    ).toBe(
      file(
        "page",
        "",
        "-",
        "-",
        "",
        "-",
        '"a"  00:01.00',
        "-",
        "",
        "-",
        "-",
        "",
        "-",
        '"b"  00:02.00',
        "-",
        "",
        "-",
        "-",
        "",
        "-",
        "-",
      ),
    );
  });

  test("puts empty syllables on the line of the last one with text", () => {
    const text = writeTimingsText(
      {
        "Voice 1": [
          { text: "a", start: 1 },
          { text: "", start: 2 },
        ],
      },
      ["Voice 1"],
    );
    expect(text).toContain(file("-", '"a"  00:01.00', '""   00:02.00', "-"));
  });

  test("writes segments stored before parseLyrics collapsed separators as what they draw", () => {
    const legacy: TimedSegment[] = [
      { text: "foo_\n", start: 1 },
      { text: "_", start: 1.5 },
      { text: "bar\n\n\n", start: 2 },
      { text: "", start: 2.5 },
      { text: "baz \n", start: 3 },
      { text: "al/", start: 3.5 },
      { text: "so /", start: 3.7 },
      { text: "qux\n", start: 4 },
    ];
    const { voices } = parseTimingsText(writeTimingsText({ "Voice 1": legacy }, ["Voice 1"]));
    expect(voices["Voice 1"]).toEqual([
      { text: "foo\n", start: 1 },
      { text: "bar\n\n", start: 2 },
      { text: "baz\n", start: 3 },
      { text: "al/", start: 3.5 },
      { text: "so_", start: 3.7 },
      { text: "qux", start: 4 },
    ]);
  });
});

describe("round trip", () => {
  const lyricSegments = (lyrics: string): TimedSegment[] =>
    parseLyrics(lyrics, true).map(fromLyric);

  test("keeps holes, open ends, ends with no start, textless timings, display and muted periods, and spacers", () => {
    const anna = lyricSegments("/\nHel/lo_world\n/\nsec/ond_line\n/\n\nnext_page\n/");
    Object.assign(anna[0], { start: 1, displayStart: 0.5, muteStart: 0.25, muteEnd: 2.5 });
    Object.assign(anna[1], { start: 1.25 });
    Object.assign(anna[2], { start: 1.5, end: 1.75 });
    Object.assign(anna[3], { end: 2.1, displayEnd: 4 });
    Object.assign(anna[4], { start: 2.5 });
    Object.assign(anna[5], { start: 3, end: 3.5 });
    Object.assign(anna[6], { start: 5, displayStart: 4.5, displayEnd: 6 });
    anna.push({ text: "", start: 7 }, { text: "" });
    const ben = lyricSegments("[not a tag]_just_words");
    ben[0].text = "not a tag_";
    ben[1].start = 1;
    const byVoice = { Anna: anna, Ben: ben };

    const { voices, warnings } = parseTimingsText(writeTimingsText(byVoice, ["Anna", "Ben"]));
    expect(voices).toEqual(byVoice);
    expect(warnings).toEqual([]);
  });

  test("keeps row breaks", () => {
    const segments = lyricSegments("Lan/terns_drift|home_o/|ver_the\nhill");
    segments.forEach((segment, i) => (segment.start = i));
    const written = writeTimingsText({ "Voice 1": segments }, ["Voice 1"]);
    expect(written).toContain('"drift "  00:02.00\n|\n"home "');
    expect(parseTimingsText(written).voices["Voice 1"]).toEqual(segments);
  });

  test("rounds times to the centisecond", () => {
    const { voices } = parseTimingsText(
      writeTimingsText({ "Voice 1": [{ text: "a", start: 1.23456, end: 2.005 }] }, ["Voice 1"]),
    );
    expect(voices["Voice 1"]).toEqual([{ text: "a", start: 1.23, end: 2.01 }]);
  });
});

describe("the section of one voice", () => {
  const segments: TimedSegment[] = [
    { text: "Been_", start: 27.99, displayStart: 25.33 },
    { text: "a\n\n", start: 28.37, end: 28.6 },
    { text: "road", start: 29.81 },
  ];
  const section = file(
    "page",
    "",
    "00:25.33",
    '"Been "  00:27.99',
    '"a"      00:28.37  00:28.60',
    "-",
    "",
    "page",
    "",
    "-",
    '"road"  00:29.81',
    "-",
  );

  test("is written without the signature or a voice row", () => {
    expect(writeVoiceTimingsText(segments)).toBe(section);
    expect(writeVoiceTimingsText([])).toBe("");
  });

  test("reads back what it wrote", () => {
    expect(parseVoiceTimingsText(section)).toEqual({ segments, warnings: [] });
    expect(parseVoiceTimingsText("")).toEqual({ segments: [], warnings: [] });
  });

  test("spells out the lyrics the lyric parser reads", () => {
    const lyrics = "Be bop_a lu bop\n/\nShe's my ba/by\n\nAnd_here's_screen_two";
    const lyricSegments = parseLyrics(lyrics, true).map(fromLyric);
    const { segments } = parseVoiceTimingsText(writeVoiceTimingsText(lyricSegments));
    expect(segments).toEqual(lyricSegments);
  });

  test("rejects the rows of a whole file, naming them", () => {
    expect(() => parseVoiceTimingsText(file("Toul timings 1", "-", '"a"', "-"))).toThrow(
      "Row 1: This row belongs to the whole timings file, not to one voice's section.",
    );
    expect(() => parseVoiceTimingsText(file("-", '"a"', "-", 'voice "Anna"'))).toThrow(
      "Row 4: This row belongs to the whole timings file",
    );
    expect(() => parseVoiceTimingsText(file("-", "a", "-"))).toThrow(
      "Row 2: This row isn't a page, a time, a syllable or a break.",
    );
  });

  test("returns its warnings", () => {
    const { warnings } = parseVoiceTimingsText(file("00:05.00", '"a"  00:01.00', "-"));
    expect(warnings).toEqual([DISPLAY_PERIOD_WIDENED]);
  });
});

describe("formatTimecode", () => {
  test("formats seconds as MM:SS.cc", () => {
    expect(formatTimecode(0)).toBe("00:00.00");
    expect(formatTimecode(65.07)).toBe("01:05.07");
    expect(formatTimecode(9.5)).toBe("00:09.50");
  });

  test("carries a rounded centisecond into the seconds and minutes", () => {
    expect(formatTimecode(59.999)).toBe("01:00.00");
  });
});
