import { describe, it, expect } from "vitest";
import {
  carryMovedLines,
  fromEvents,
  toEvents,
  reconcile,
  raisedFlags,
  ReviewFlag,
  isSpellingFix,
  clampDisplayPeriods,
  clampMuteBounds,
  normalizeDisplayPeriods,
  normalizeMuteBounds,
  TimedSegment,
} from "./timedSegments";
import { parseLyrics } from "./timing";
import { LyricEvent } from "./timing";
import { LYRIC_MARKERS } from "@/constants";
import { testLyrics, shortIntroTestEvents } from "./timing.spec";

const { SEGMENT_START, SEGMENT_END } = LYRIC_MARKERS;

describe("fromEvents", () => {
  it("pairs each segment with its own start and end", () => {
    const events: LyricEvent[] = [
      [1.0, SEGMENT_START],
      [2.0, SEGMENT_END],
      [3.0, SEGMENT_START],
    ];
    expect(fromEvents("hi_there", events)).toEqual([
      { text: "hi_", start: 1.0, end: 2.0 },
      { text: "there", start: 3.0 },
    ]);
  });

  it("leaves segments past the end of the events untimed", () => {
    expect(fromEvents("one_two_three", [[1.0, SEGMENT_START]])).toEqual([
      { text: "one_", start: 1.0 },
      { text: "two_" },
      { text: "three" },
    ]);
  });

  it("keeps events past the end of the lyrics, as textless segments", () => {
    const events: LyricEvent[] = [
      [1.0, SEGMENT_START],
      [2.0, SEGMENT_START],
      [3.0, SEGMENT_START],
    ];
    expect(fromEvents("only", events)).toEqual([
      { text: "only", start: 1.0 },
      { text: "", start: 2.0 },
      { text: "", start: 3.0 },
    ]);
  });

  it("keeps timings entered before any lyrics exist", () => {
    const events: LyricEvent[] = [
      [1.0, SEGMENT_START],
      [2.0, SEGMENT_END],
    ];
    expect(fromEvents("", events)).toEqual([{ text: "", start: 1.0, end: 2.0 }]);
  });

  it("keeps the lyrics' spacer counts", () => {
    expect(fromEvents("/\nfoo", [[1.0, SEGMENT_START]])).toEqual([
      { text: "foo", start: 1.0, spacersBefore: 1 },
    ]);
  });

  it("parses the shared fixture into one segment per lyric segment", () => {
    const segments = fromEvents(testLyrics, shortIntroTestEvents);
    expect(segments).toEqual([
      { text: "Be bop_", start: 1.0, end: 2.0 },
      { text: "a lu bop\n", start: 3.0 },
      { text: "She's my ba/", start: 4.0 },
      { text: "by\n\n", start: 5.0 },
      { text: "And_", start: 6.0 },
      { text: "here's_", start: 7.0 },
      { text: "screen_", start: 8.0 },
      { text: "two", start: 9.0 },
    ]);
  });

  it("returns untimed segments when there are no events", () => {
    expect(fromEvents("a_b", [])).toEqual([{ text: "a_" }, { text: "b" }]);
  });
});

describe("toEvents", () => {
  it("emits a start, and an end only when there is one", () => {
    const segments: TimedSegment[] = [
      { text: "hi_", start: 1.0, end: 2.0 },
      { text: "there", start: 3.0 },
    ];
    expect(toEvents(segments)).toEqual([
      [1.0, SEGMENT_START],
      [2.0, SEGMENT_END],
      [3.0, SEGMENT_START],
    ]);
  });

  it("skips an untimed segment, which is where the legacy form loses information", () => {
    const segments: TimedSegment[] = [
      { text: "one_", start: 1.0 },
      { text: "two_" },
      { text: "three", start: 3.0 },
    ];
    expect(toEvents(segments)).toEqual([
      [1.0, SEGMENT_START],
      [3.0, SEGMENT_START],
    ]);
  });

  it("drops an end whose segment has no start, rather than misattaching it", () => {
    const segments: TimedSegment[] = [
      { text: "one_", start: 1.0 },
      { text: "two", end: 5.0 },
    ];
    expect(toEvents(segments)).toEqual([[1.0, SEGMENT_START]]);
  });
});

describe("round trip", () => {
  it("is lossless for a fully-timed project", () => {
    expect(toEvents(fromEvents(testLyrics, shortIntroTestEvents))).toEqual(shortIntroTestEvents);
  });

  it("collapses a hole, so re-reading misattributes the timings that follow it", () => {
    const segments: TimedSegment[] = [
      { text: "one_", start: 1.0 },
      { text: "two_" },
      { text: "three", start: 3.0 },
    ];
    const reread = fromEvents("one_two_three", toEvents(segments));
    expect(reread).toEqual([
      { text: "one_", start: 1.0 },
      { text: "two_", start: 3.0 },
      { text: "three" },
    ]);
  });
});

describe("reconcile", () => {
  const lyrics = (text: string) => parseLyrics(text, true);
  const timed = (text: string, start?: number, end?: number): TimedSegment => {
    const segment: TimedSegment = { text };
    if (start !== undefined) segment.start = start;
    if (end !== undefined) segment.end = end;
    return segment;
  };
  const flag = (segment: TimedSegment, review: ReviewFlag): TimedSegment => ({
    ...segment,
    review,
  });

  it("a typo keeps every timing, because the count is unchanged", () => {
    const stored = [timed("recieve_", 1.0, 1.5), timed("the_", 2.0), timed("call", 3.0)];

    expect(reconcile(stored, lyrics("receive_the_call"))).toEqual([
      timed("receive_", 1.0, 1.5),
      timed("the_", 2.0),
      timed("call", 3.0),
    ]);
  });

  it("splitting a word keeps the outer bounds and leaves the middle untimed", () => {
    const stored = [timed("one_", 1.0), timed("alchemy_", 2.0, 2.9), timed("three", 3.0)];

    expect(reconcile(stored, lyrics("one_al/chem/y_three"))).toEqual([
      timed("one_", 1.0),
      timed("al/", 2.0),
      timed("chem/"),
      timed("y_", undefined, 2.9),
      timed("three", 3.0),
    ]);
  });

  it("joining syllables takes the first start and the last end", () => {
    const stored = [
      timed("one_", 1.0),
      timed("al/", 2.0),
      timed("che/", 2.3),
      timed("my_", 2.6, 2.9),
      timed("three", 3.0),
    ];

    expect(reconcile(stored, lyrics("one_alchemy_three"))).toEqual([
      timed("one_", 1.0),
      timed("alchemy_", 2.0, 2.9),
      timed("three", 3.0),
    ]);
  });

  it("an insertion at the head leaves the tail's timings untouched", () => {
    const stored = [timed("one_", 1.0), timed("two_", 2.0), timed("three", 3.0)];

    expect(reconcile(stored, lyrics("zero_one_two_three"))).toEqual([
      timed("zero_"),
      timed("one_", 1.0),
      timed("two_", 2.0),
      timed("three", 3.0),
    ]);
  });

  it("a deletion at the head leaves the tail's timings untouched", () => {
    const stored = [
      timed("zero_", 0.5),
      timed("one_", 1.0),
      timed("two_", 2.0),
      timed("three", 3.0),
    ];

    expect(reconcile(stored, lyrics("one_two_three"))).toEqual([
      timed("one_", 1.0),
      timed("two_", 2.0),
      timed("three", 3.0),
    ]);
  });

  it("a word replaced by two keeps its start on the first, flagged moved", () => {
    const stored = [timed("one_", 1.0), timed("two_", 2.0), timed("three", 3.0)];

    expect(reconcile(stored, lyrics("one_bravo_charlie_three"))).toEqual([
      timed("one_", 1.0),
      flag(timed("bravo_", 2.0), "moved"),
      timed("charlie_"),
      timed("three", 3.0),
    ]);
  });

  it("keeps the timings of the lines that edits on either side leave unchanged", () => {
    const stored = [
      timed("ka_", 1),
      timed("den\n", 2),
      timed("lu_", 3),
      timed("mo\n", 4),
      timed("ri_", 5),
      timed("sa\n", 6),
      timed("te_", 7),
      timed("vo", 8, 8.5),
    ];

    expect(reconcile(stored, lyrics("ka_den_xo\nlu_mo\nri_sa\nte_vo_zu"))).toEqual([
      timed("ka_", 1),
      timed("den_", 2),
      timed("xo\n"),
      timed("lu_", 3),
      timed("mo\n", 4),
      timed("ri_", 5),
      timed("sa\n", 6),
      timed("te_", 7),
      timed("vo_", 8, 8.5),
      timed("zu"),
    ]);
  });

  it("a matched line that only gained a split keeps its outer bounds", () => {
    const stored = [
      timed("ka_", 1),
      timed("den\n", 2),
      timed("lu_", 3),
      timed("mo\n", 4),
      timed("risa", 5, 5.5),
    ];

    expect(reconcile(stored, lyrics("ka_dun_po\nlu_mo\nri/sa"))).toEqual([
      timed("ka_", 1),
      flag(timed("dun_", 2), "moved"),
      timed("po\n"),
      timed("lu_", 3),
      timed("mo\n", 4),
      timed("ri/", 5),
      timed("sa", undefined, 5.5),
    ]);
  });

  it("reconciles a gap of as many lines on each side pair by pair", () => {
    const stored = [
      timed("ka_", 1),
      timed("den_", 2),
      timed("lu\n", 3),
      timed("mo_", 4),
      timed("ri", 5),
    ];

    expect(reconcile(stored, lyrics("ka_dun_xo_lu\nmo_ri_zu"))).toEqual([
      timed("ka_", 1),
      flag(timed("dun_", 2), "moved"),
      timed("xo_"),
      timed("lu\n", 3),
      timed("mo_", 4),
      timed("ri_", 5),
      timed("zu"),
    ]);
  });

  it("a line inserted between others un-times nothing else", () => {
    const stored = [timed("ka\n", 1), timed("den\n", 2), timed("lu\n", 3), timed("mo", 4)];

    expect(reconcile(stored, lyrics("kaa\nden\nxo\nlu\nmo"))).toEqual([
      flag(timed("kaa\n", 1), "moved"),
      timed("den\n", 2),
      timed("xo\n"),
      timed("lu\n", 3),
      timed("mo", 4),
    ]);
  });

  it("keeps the outer bounds of a gap whose line count changed", () => {
    const stored = [timed("ka\n", 1), timed("den\n", 2), timed("lu\n", 3), timed("mo", 4)];

    expect(reconcile(stored, lyrics("xo\nden\npi\nzu\nmo"))).toEqual([
      flag(timed("xo\n", 1), "moved"),
      timed("den\n", 2),
      flag(timed("pi\n", 3), "moved"),
      timed("zu\n"),
      timed("mo", 4),
    ]);
  });

  it("adding or removing a spacer keeps every timing and display period", () => {
    const stored: TimedSegment[] = [
      { text: "one\n", start: 1.0, displayStart: 0.5 },
      timed("two", 2.0),
    ];
    const spaced = reconcile(stored, lyrics("one\n/\ntwo"));

    expect(spaced).toEqual([
      { text: "one\n", start: 1.0, displayStart: 0.5 },
      { text: "two", start: 2.0, spacersBefore: 1 },
    ]);
    expect(reconcile(spaced, lyrics("one\ntwo"))).toEqual(stored);
  });

  it("takes the spacers of unchanged lines from the lyrics", () => {
    const stored: TimedSegment[] = [
      timed("one_", 1.0),
      timed("two\n", 2.0),
      { text: "three", start: 3.0, spacersBefore: 1 },
    ];

    expect(reconcile(stored, lyrics("/\nzero_one_two\nthree"))).toEqual([
      { text: "zero_", spacersBefore: 1 },
      timed("one_", 1.0),
      timed("two\n", 2.0),
      timed("three", 3.0),
    ]);
  });

  it("takes the spacers of a split line from the lyrics", () => {
    const stored = [timed("one\n", 1.0), timed("alchemy", 2.0, 2.9)];

    expect(reconcile(stored, lyrics("one\n/\nal/chemy"))).toEqual([
      timed("one\n", 1.0),
      { text: "al/", start: 2.0, spacersBefore: 1 },
      timed("chemy", undefined, 2.9),
    ]);
  });

  // The last segment of a lyric carries no trailing separator, so appending to the end rewrites it
  // (`three` -> `three_`) without changing the word. That must not cost it its timing.
  it("keeps the old last segment when a word is appended", () => {
    const stored = [timed("one_", 1.0), timed("two_", 2.0), timed("three", 3.0)];

    expect(reconcile(stored, lyrics("one_two_three_four"))).toEqual([
      timed("one_", 1.0),
      timed("two_", 2.0),
      timed("three_", 3.0),
      timed("four"),
    ]);
  });

  it("keeps the old last line when a line is appended", () => {
    const stored = [
      timed("one_", 1.0),
      timed("two\n", 2.0),
      timed("three_", 3.0),
      timed("four", 4.0),
    ];

    expect(reconcile(stored, lyrics("one_two\nthree_four\nfive_six"))).toEqual([
      timed("one_", 1.0),
      timed("two\n", 2.0),
      timed("three_", 3.0),
      timed("four\n", 4.0),
      timed("five_"),
      timed("six"),
    ]);
  });

  it("keeps the new last segment when the tail is deleted", () => {
    const stored = [timed("aa_", 1.0), timed("bb\n", 2.0), timed("cc_", 3.0), timed("dd", 4.0)];

    expect(reconcile(stored, lyrics("aa_bb"))).toEqual([timed("aa_", 1.0), timed("bb", 2.0)]);
  });

  it("seeds untimed segments when there is nothing stored yet", () => {
    expect(reconcile([], lyrics("one_two"))).toEqual([timed("one_"), timed("two")]);
  });

  it("drops everything when the lyrics are cleared", () => {
    expect(reconcile([timed("one_", 1.0), timed("two", 2.0)], lyrics(""))).toEqual([]);
  });

  it("always returns exactly the current lyric segments", () => {
    const stored = [timed("one_", 1.0), timed("two_", 2.0), timed("three", 3.0)];
    for (const text of ["one_two_three", "one_two", "a_b_c_d_e", "", "one_two_three_four"]) {
      const current = lyrics(text);
      const result = reconcile(stored, current);
      expect(result.map((s) => s.text)).toEqual(current.map((s) => s.text));
    }
  });

  describe("review flags", () => {
    it("flags a timing relabelled onto a different word as moved", () => {
      const stored = [timed("cat_", 1.0, 1.5), timed("sat_", 2.0), timed("down")];

      expect(reconcile(stored, lyrics("cut_sit_dawn"))).toEqual([
        flag(timed("cut_", 1.0, 1.5), "moved"),
        flag(timed("sit_", 2.0), "moved"),
        timed("dawn"),
      ]);
    });

    it("doesn't flag a spelling fix", () => {
      const stored = [timed("Wonder,_", 1.0), timed("colour_", 2.0), timed("recieve", 3.0)];

      expect(reconcile(stored, lyrics("wander_color_receive"))).toEqual([
        timed("wander_", 1.0),
        timed("color_", 2.0),
        timed("receive", 3.0),
      ]);
    });

    it("doesn't flag a timing tapped before the lyrics existed", () => {
      expect(reconcile([timed("", 1.0)], lyrics("one"))).toEqual([timed("one", 1.0)]);
    });

    it("flags the untimed middle of a join that lost timings", () => {
      const stored = [timed("al/", 2.0), timed("chemy", 2.4, 2.9)];

      expect(reconcile(stored, lyrics("a/lche/my"))).toEqual([
        timed("a/", 2.0),
        flag(timed("lche/"), "lost"),
        timed("my", undefined, 2.9),
      ]);
    });

    it("doesn't flag a split that keeps every timing", () => {
      const stored = [timed("one_", 1.0), timed("alchemy", 2.0, 2.9)];

      expect(reconcile(stored, lyrics("one_al/chem/y"))).toEqual([
        timed("one_", 1.0),
        timed("al/", 2.0),
        timed("chem/"),
        timed("y", undefined, 2.9),
      ]);
    });

    it("flags nothing for a deleted run", () => {
      const stored = [timed("one_", 1.0), flag(timed("two_", 2.0), "moved"), timed("three", 3.0)];

      expect(reconcile(stored, lyrics("one_three"))).toEqual([
        timed("one_", 1.0),
        timed("three", 3.0),
      ]);
    });

    it("keeps the flags of segments that only get relabelled", () => {
      const stored = [flag(timed("one_", 1.0), "moved"), flag(timed("two"), "lost")];

      expect(reconcile(stored, lyrics("one_two_three"))).toEqual([
        flag(timed("one_", 1.0), "moved"),
        flag(timed("two_"), "lost"),
        timed("three"),
      ]);
    });

    it("gives a replaced run the old segments' flags", () => {
      const stored = [timed("one_", 1.0), flag(timed("two_"), "lost"), timed("three", 3.0)];

      expect(reconcile(stored, lyrics("one_bravo_charlie_three"))).toEqual([
        timed("one_", 1.0),
        flag(timed("bravo_"), "lost"),
        flag(timed("charlie_"), "lost"),
        timed("three", 3.0),
      ]);
    });

    it("gives a split the old segment's flag", () => {
      const stored = [timed("one_", 1.0), flag(timed("alchemy", 2.0, 2.9), "moved")];

      expect(reconcile(stored, lyrics("one_al/chem/y"))).toEqual([
        timed("one_", 1.0),
        flag(timed("al/", 2.0), "moved"),
        flag(timed("chem/"), "moved"),
        flag(timed("y", undefined, 2.9), "moved"),
      ]);
    });

    it("prefers lost over moved", () => {
      const stored = [
        timed("one_", 1.0),
        flag(timed("two_", 2.0), "moved"),
        timed("three_", 3.0),
        timed("four", 4.0),
      ];

      expect(reconcile(stored, lyrics("one_ka_lu_mo_four"))).toEqual([
        timed("one_", 1.0),
        flag(timed("ka_", 2.0), "moved"),
        flag(timed("lu_"), "lost"),
        flag(timed("mo_"), "moved"),
        timed("four", 4.0),
      ]);
    });

    it("prefers lost and moved over doubtful", () => {
      const stored = [
        timed("one_", 1.0),
        flag(timed("two_", 2.0), "doubtful"),
        timed("three_", 3.0),
        timed("four", 4.0),
      ];

      expect(reconcile(stored, lyrics("one_ka_lu_mo_four"))).toEqual([
        timed("one_", 1.0),
        flag(timed("ka_", 2.0), "moved"),
        flag(timed("lu_"), "lost"),
        flag(timed("mo_"), "doubtful"),
        timed("four", 4.0),
      ]);
    });
  });

  describe("the diff", () => {
    it("moves nothing between an addition and a deletion in different lines", () => {
      const stored = [
        timed("ka_", 1),
        timed("den\n", 2),
        timed("lu_", 3),
        timed("mo\n", 4),
        timed("ri_", 5),
        timed("sa", 6),
      ];

      expect(reconcile(stored, lyrics("ka_den_xo\nlu_mo\nri"))).toEqual([
        timed("ka_", 1),
        timed("den_", 2),
        timed("xo\n"),
        timed("lu_", 3),
        timed("mo\n", 4),
        timed("ri", 5),
      ]);
    });

    it("anchors on a word whose case or punctuation changed", () => {
      const stored = [timed("Star,_", 1), timed("light", 2)];

      expect(reconcile(stored, lyrics("star_bright_light"))).toEqual([
        timed("star_", 1),
        timed("bright_"),
        timed("light", 2),
      ]);
    });

    it("replaces a rewritten gap as one run when it only shares a common word", () => {
      const stored = [
        timed("the_", 1),
        timed("ka_", 2),
        timed("den\n", 3),
        timed("lu_", 4),
        timed("mo", 5),
      ];

      expect(reconcile(stored, lyrics("xo_pi\nzu\nthe"))).toEqual([
        flag(timed("xo_", 1), "moved"),
        flag(timed("pi\n"), "lost"),
        flag(timed("zu\n"), "lost"),
        timed("the"),
      ]);
    });

    it("anchors on a lone common word inside a pair of lines", () => {
      const stored = [timed("one_", 1, 1.5), timed("two_", 2, 2.5), timed("three", 3, 3.5)];

      expect(reconcile(stored, lyrics("xa_ya_za_three"))).toEqual([
        flag(timed("xa_", 1), "moved"),
        flag(timed("ya_"), "lost"),
        flag(timed("za_", undefined, 2.5), "moved"),
        timed("three", 3, 3.5),
      ]);
    });

    it("flags nothing in a run that was never timed", () => {
      const stored = [timed("one_", 1), timed("two_"), timed("three", 3)];

      expect(reconcile(stored, lyrics("one_ka_lu_mo_three"))).toEqual([
        timed("one_", 1),
        timed("ka_"),
        timed("lu_"),
        timed("mo_"),
        timed("three", 3),
      ]);
    });

    describe("keeps a line's display period", () => {
      const stored: TimedSegment[] = [
        { text: "ka_", start: 1, displayStart: 0.5, displayEnd: 3 },
        timed("den\n", 2),
        timed("lu", 3),
      ];
      const period = { displayStart: 0.5, displayEnd: 3 };

      it("when its first segment is replaced", () => {
        expect(reconcile(stored, lyrics("xo_po_den\nlu"))[0]).toEqual({
          ...flag(timed("xo_", 1), "moved"),
          ...period,
        });
      });

      it("when its first segment is deleted", () => {
        expect(reconcile(stored, lyrics("den\nlu"))[0]).toEqual({
          ...timed("den\n", 2),
          ...period,
        });
      });

      it("when a segment is inserted before it", () => {
        const [inserted, kept] = reconcile(stored, lyrics("zo_ka_den\nlu"));
        expect(inserted).toEqual({ ...timed("zo_"), ...period });
        expect(kept).toEqual(timed("ka_", 1));
      });
    });

    it("keeps a line's muted period with its display period", () => {
      const stored: TimedSegment[] = [
        { text: "ka_", start: 1, displayStart: 0.5, muteStart: 0.2, muteEnd: 4 },
        timed("den\n", 2),
        timed("lu", 3),
      ];

      expect(reconcile(stored, lyrics("zo_ka_den\nlu")).slice(0, 2)).toEqual([
        { ...timed("zo_"), displayStart: 0.5, muteStart: 0.2, muteEnd: 4 },
        timed("ka_", 1),
      ]);
    });

    it("keeps the period of a line joined to the next one", () => {
      const stored: TimedSegment[] = [
        { text: "ka\n", start: 1, displayStart: 0.5 },
        { text: "den\n", start: 2, displayStart: 1.5 },
        timed("lu", 3),
      ];

      expect(reconcile(stored, lyrics("ka_den\nlu"))).toEqual([
        { text: "ka_", start: 1, displayStart: 0.5 },
        { text: "den\n", start: 2, displayStart: 1.5 },
        timed("lu", 3),
      ]);
    });
  });

  describe("raisedFlags", () => {
    it("counts the flags a diff raised", () => {
      const stored = [timed("one_", 1), timed("two_", 2), timed("three_", 3), timed("four", 4)];

      expect(raisedFlags(stored, lyrics("one_ka_lu_mo_four"))).toEqual({ lost: 1, moved: 1 });
    });

    it("raises none when a word break becomes a row break", () => {
      const stored = [timed("one_", 1), timed("two_", 2), timed("three", 3)];

      expect(raisedFlags(stored, lyrics("one|two_three"))).toEqual({ lost: 0, moved: 0 });
      expect(reconcile(stored, lyrics("one|two_three")).map(({ start }) => start)).toEqual([
        1, 2, 3,
      ]);
    });

    it("doesn't count flags that segments inherited", () => {
      const stored = [timed("one_", 1), flag(timed("two_", 2), "moved"), timed("three", 3)];

      expect(raisedFlags(stored, lyrics("one_too_three"))).toEqual({ lost: 0, moved: 0 });
      expect(raisedFlags(stored, lyrics("one_two_three_four"))).toEqual({ lost: 0, moved: 0 });
    });
  });
});

describe("carryMovedLines", () => {
  const lyrics = (text: string) => parseLyrics(text, true);

  it("moves a timed line to the voice that gained it, in its new place", () => {
    const stored = {
      lead: [
        { text: "one\n", start: 1 },
        { text: "three", start: 3 },
      ],
      choir: [
        { text: "two_", start: 2, displayStart: 1.5 },
        { text: "too", start: 2.5 },
      ],
    };

    expect(carryMovedLines(stored, { lead: lyrics("one\ntwo_too\nthree"), choir: [] })).toEqual({
      lead: [
        { text: "one\n", start: 1 },
        { text: "two_", start: 2, displayStart: 1.5 },
        { text: "too\n", start: 2.5 },
        { text: "three", start: 3 },
      ],
      choir: [],
    });
  });

  it("moves identical lines in order", () => {
    const stored = {
      lead: [{ text: "verse", start: 2 }],
      choir: [
        { text: "oh\n", start: 1 },
        { text: "hey\n", start: 1.5 },
        { text: "oh", start: 3 },
      ],
    };

    expect(
      carryMovedLines(stored, { lead: lyrics("oh\nverse\noh"), choir: lyrics("hey") }),
    ).toEqual({
      lead: [
        { text: "oh\n", start: 1 },
        { text: "verse\n", start: 2 },
        { text: "oh", start: 3 },
      ],
      choir: [{ text: "hey\n", start: 1.5 }],
    });
  });

  it("flags a line that lands out of time order", () => {
    const stored = {
      lead: [
        { text: "one\n", start: 1 },
        { text: "three", start: 3 },
      ],
      choir: [{ text: "four", start: 4 }],
    };

    expect(carryMovedLines(stored, { lead: lyrics("one\nfour\nthree"), choir: [] }).lead).toEqual([
      { text: "one\n", start: 1 },
      { text: "four\n", start: 4, review: "moved" },
      { text: "three", start: 3 },
    ]);
  });

  it("leaves an untimed line, and a line a voice kept, where they are", () => {
    const stored = {
      lead: [{ text: "one", start: 1 }],
      choir: [{ text: "one\n", start: 1.2 }, { text: "two" }],
    };

    expect(carryMovedLines(stored, { lead: lyrics("one\ntwo"), choir: lyrics("one") })).toBe(
      stored,
    );
  });

  it("moves a line into a voice that had no segments", () => {
    const stored = {
      choir: [
        { text: "one\n", start: 1 },
        { text: "two", start: 2 },
      ],
    };

    expect(carryMovedLines(stored, { choir: lyrics("one"), solo: lyrics("two") })).toEqual({
      choir: [{ text: "one\n", start: 1 }],
      solo: [{ text: "two", start: 2 }],
    });
  });
});

describe("clampDisplayPeriods", () => {
  it("stops an explicit end past the next start at that start", () => {
    const { segments, widened } = clampDisplayPeriods([
      { text: "a\n", start: 1, end: 5, displayEnd: 2.5 },
      { text: "b", start: 3 },
    ]);
    expect(segments[0].displayEnd).toBe(3);
    expect(widened).toBe(1);
  });

  it("leaves a period that already contains the timings alone", () => {
    const stored: TimedSegment[] = [
      { text: "a\n", start: 1, displayStart: 0, displayEnd: 9 },
      { text: "b", start: 3 },
    ];
    expect(clampDisplayPeriods(stored)).toEqual({ segments: stored, widened: 0 });
  });
});

describe("normalizeDisplayPeriods", () => {
  it("pushes a bound that a syllable has crossed, and never pulls it back", () => {
    const pushed = normalizeDisplayPeriods([
      { text: "a\n", start: 1, end: 4, displayStart: 2, displayEnd: 3 },
      { text: "b", start: 5 },
    ]);
    expect(pushed[0]).toMatchObject({ displayStart: 1, displayEnd: 4 });

    const movedBack = normalizeDisplayPeriods([{ ...pushed[0], start: 1.5, end: 2 }, pushed[1]]);
    expect(movedBack[0]).toMatchObject({ displayStart: 1, displayEnd: 4 });
  });

  it("clears the bounds of a segment that no longer starts a line", () => {
    expect(
      normalizeDisplayPeriods([
        { text: "a_", start: 1, displayStart: 0 },
        { text: "b", start: 2, displayStart: 1, displayEnd: 3 },
      ]),
    ).toEqual([
      { text: "a_", start: 1, displayStart: 0 },
      { text: "b", start: 2 },
    ]);
  });

  it("keeps the bounds of a line that isn't timed yet", () => {
    const untimed: TimedSegment[] = [
      { text: "a\n", displayStart: 1, displayEnd: 2 },
      { text: "b" },
    ];
    expect(normalizeDisplayPeriods(untimed)).toEqual(untimed);
  });
});

describe("clampMuteBounds", () => {
  it("lets the mute start up to 0.2 s into the line, but not past its first syllable", () => {
    const { segments, clamped } = clampMuteBounds([
      { text: "a_", start: 1, end: 1.1, muteStart: 1.5 },
      { text: "b\n", start: 2, end: 3 },
      { text: "c", start: 5, end: 6, muteStart: 5.5 },
    ]);
    expect(segments[0].muteStart).toBe(1.1);
    expect(segments[2].muteStart).toBe(5.2);
    expect(clamped).toBe(2);
  });

  it("keeps the mute end past the line's last end, even past the next start", () => {
    const { segments } = clampMuteBounds([
      { text: "a\n", start: 1, end: 5, muteEnd: 2 },
      { text: "b", start: 3, end: 4 },
    ]);
    expect(segments[0].muteEnd).toBe(5);
  });

  it("runs an open end to the next start", () => {
    const { segments } = clampMuteBounds([
      { text: "a\n", start: 1, muteEnd: 2 },
      { text: "b", start: 3, end: 4 },
    ]);
    expect(segments[0].muteEnd).toBe(3);
  });

  it("leaves a mute that already covers the line alone, within rounding", () => {
    const stored: TimedSegment[] = [
      { text: "a\n", start: 0.1, end: 1, muteStart: 0.3, muteEnd: 2 },
      { text: "b", start: 3 },
    ];
    expect(clampMuteBounds(stored)).toEqual({ segments: stored, clamped: 0 });
  });

  it("drops the bounds of a line with no timed syllable", () => {
    expect(clampMuteBounds([{ text: "a", muteStart: 1, muteEnd: 2 }]).segments).toEqual([
      { text: "a" },
    ]);
  });
});

describe("normalizeMuteBounds", () => {
  it("pushes a bound that a syllable has crossed, and never pulls it back", () => {
    const pushed = normalizeMuteBounds([
      { text: "a\n", start: 1, end: 4, muteStart: 2, muteEnd: 3 },
      { text: "b", start: 5 },
    ]);
    expect(pushed[0]).toMatchObject({ muteStart: 1.2, muteEnd: 4 });

    const movedBack = normalizeMuteBounds([{ ...pushed[0], start: 1.5, end: 2 }, pushed[1]]);
    expect(movedBack[0]).toMatchObject({ muteStart: 1.2, muteEnd: 4 });
  });

  it("clears the bounds of a segment that no longer starts a line", () => {
    expect(
      normalizeMuteBounds([
        { text: "a_", start: 1, muteStart: 0 },
        { text: "b", start: 2, muteStart: 1, muteEnd: 3 },
      ]),
    ).toEqual([
      { text: "a_", start: 1, muteStart: 0 },
      { text: "b", start: 2 },
    ]);
  });

  it("keeps the bounds of a line that isn't timed yet", () => {
    const untimed: TimedSegment[] = [{ text: "a\n", muteStart: 1, muteEnd: 2 }, { text: "b" }];
    expect(normalizeMuteBounds(untimed)).toEqual(untimed);
  });
});

describe("isSpellingFix", () => {
  it("accepts a change of case or punctuation at any length", () => {
    expect(isSpellingFix("Star,", "star")).toBe(true);
    expect(isSpellingFix("I", "i!")).toBe(true);
  });

  it("accepts one letter added, removed or replaced in words of four letters or more", () => {
    expect(isSpellingFix("fire", "fires")).toBe(true);
    expect(isSpellingFix("colour", "color")).toBe(true);
    expect(isSpellingFix("wonder", "wander")).toBe(true);
  });

  it("accepts two neighbouring letters swapped in words of four letters or more", () => {
    expect(isSpellingFix("recieve", "receive")).toBe(true);
  });

  it("rejects the same edits in shorter words", () => {
    expect(isSpellingFix("a", "an")).toBe(false);
    expect(isSpellingFix("cat", "cut")).toBe(false);
    expect(isSpellingFix("cat", "cta")).toBe(false);
    expect(isSpellingFix("fir", "fire")).toBe(false);
  });

  it("rejects two edits in any word", () => {
    expect(isSpellingFix("colour", "colors")).toBe(false);
    expect(isSpellingFix("wonderful", "wanderfull")).toBe(false);
  });
});
