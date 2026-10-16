import { readFileSync } from "node:fs";
import path from "node:path";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { useTimingsStore } from "./timings";
import { useLyricsStore } from "./lyrics";
import { useMediaStore } from "./media";
import { useSettingsStore } from "./settings";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { LYRIC_MARKERS } from "@/constants";
import { createAssFile } from "@/lib/timing";
import { DEFAULT_VOICE_ID } from "@/lib/voices";
import { TimedSegment } from "@/lib/timedSegments";
import { parseTimingsText } from "@/lib/timingsText";
import { startPass, tapStart, tapSteps } from "@/lib/tapPass";
import { pendingSync } from "@/lib/alignment";
import { useHistoryStore } from "./history";
import { useAdvancedStore } from "./advanced";

// Mock the createAssFile function
vi.mock("@/lib/timing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/timing")>()),
  createAssFile: vi.fn().mockReturnValue("mock subtitles content"),
  DEFAULT_KARAOKE_OPTIONS: {},
}));

describe("Timings Store", () => {
  beforeEach(() => {
    localStorage.clear();
    // Create a fresh pinia instance for each test
    setActivePinia(createPinia());
  });

  test("should initialize with empty timings", () => {
    const timingsStore = useTimingsStore();
    expect(timingsStore.length).toBe(0);
    expect(timingsStore.rawTimings).toEqual([]);
  });

  test("should add timing events", () => {
    const timingsStore = useTimingsStore();
    timingsStore.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);

    expect(timingsStore.length).toBe(1);
    expect(timingsStore.rawTimings).toEqual([[1.0, LYRIC_MARKERS.SEGMENT_START]]);
  });

  test("conflicts should be resolved", () => {
    const timings = useTimingsStore();

    timings.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);
    timings.add(1, LYRIC_MARKERS.SEGMENT_END, 3.0);
    timings.add(2, LYRIC_MARKERS.SEGMENT_START, 2.5);

    expect(timings.rawTimings[1]).toStrictEqual([2.5, LYRIC_MARKERS.SEGMENT_START]);
  });

  test("length should reflect the number of timings", () => {
    const timings = useTimingsStore();

    expect(timings.length).toBe(0);

    timings.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);
    expect(timings.length).toBe(1);

    timings.add(1, LYRIC_MARKERS.SEGMENT_END, 3.0);
    expect(timings.length).toBe(2);
  });

  test("last should return the most recent timing", () => {
    const timings = useTimingsStore();

    // Initial state should return null
    expect(timings.last).toStrictEqual(null);

    timings.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);
    expect(timings.last).toStrictEqual([1.0, LYRIC_MARKERS.SEGMENT_START]);

    timings.add(0, LYRIC_MARKERS.SEGMENT_END, 3.0);
    expect(timings.last).toStrictEqual([3.0, LYRIC_MARKERS.SEGMENT_END]);
  });

  test("resetTimings should replace all timings", () => {
    const timings = useTimingsStore();

    timings.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);
    expect(timings.length).toBe(1);

    const newTimings: [number, number][] = [
      [2.0, LYRIC_MARKERS.SEGMENT_START],
      [5.0, LYRIC_MARKERS.SEGMENT_END],
    ];
    timings.resetTimings(newTimings);

    expect(timings.length).toBe(2);
    expect(timings.rawTimings).toStrictEqual(newTimings);
  });

  test("timingForSegmentNum should find the correct segment start time", () => {
    const timings = useTimingsStore();

    timings.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);
    timings.add(0, LYRIC_MARKERS.SEGMENT_END, 2.0);
    timings.add(1, LYRIC_MARKERS.SEGMENT_START, 3.0);
    timings.add(1, LYRIC_MARKERS.SEGMENT_END, 4.0);

    expect(timings.timingForSegmentNum(0)).toBe(1.0);
    expect(timings.timingForSegmentNum(1)).toBe(3.0);
    // Segment that doesn't exist should return 0
    expect(timings.timingForSegmentNum(2)).toBe(0);
  });

  test("setCurrentSegment should truncate timings to the specified segment", () => {
    const timings = useTimingsStore();

    timings.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);
    timings.add(0, LYRIC_MARKERS.SEGMENT_END, 2.0);
    timings.add(1, LYRIC_MARKERS.SEGMENT_START, 3.0);
    timings.add(1, LYRIC_MARKERS.SEGMENT_END, 4.0);
    timings.add(2, LYRIC_MARKERS.SEGMENT_START, 5.0);

    expect(timings.length).toBe(5);

    // Set back to segment 1
    timings.setCurrentSegment(1);

    // Should have removed the last timing (segment 2 start)
    expect(timings.length).toBe(2);
    expect(timings.last).toStrictEqual([2.0, LYRIC_MARKERS.SEGMENT_END]);

    // Set back to segment 0
    timings.setCurrentSegment(0);

    // Should have removed segment 1 timings
    expect(timings.length).toBe(0);
    expect(timings.last).toStrictEqual(null);
  });

  test("subtitles should return empty string if timings is empty", () => {
    const timingsStore = useTimingsStore();
    expect(timingsStore.subtitles()).toBe("");
  });

  test("migrates a legacy single-voice array into the default voice", () => {
    const legacy = [
      [1.0, LYRIC_MARKERS.SEGMENT_START],
      [2.0, LYRIC_MARKERS.SEGMENT_END],
    ];
    localStorage.setItem("timings._timings", JSON.stringify(legacy));

    const timingsStore = useTimingsStore();

    // With no lyrics the active voice falls back to the default, where the legacy array landed.
    expect(timingsStore.rawTimings).toStrictEqual(legacy);
    expect(timingsStore.length).toBe(2);
  });

  test("migration attaches the stored lyrics to the segments it rebuilds", () => {
    localStorage.setItem("lyrics.lyricText", JSON.stringify("hi_there"));
    localStorage.setItem(
      "timings._timings",
      JSON.stringify([
        [1.0, LYRIC_MARKERS.SEGMENT_START],
        [2.0, LYRIC_MARKERS.SEGMENT_END],
        [3.0, LYRIC_MARKERS.SEGMENT_START],
      ]),
    );

    const timingsStore = useTimingsStore();

    expect(timingsStore.activeSegments).toEqual([
      { text: "hi_", start: 1.0, end: 2.0 },
      { text: "there", start: 3.0 },
    ]);
  });

  test("migration leaves the legacy key in place", () => {
    const legacy = JSON.stringify([[1.0, LYRIC_MARKERS.SEGMENT_START]]);
    localStorage.setItem("timings._timings", legacy);

    useTimingsStore();

    expect(localStorage.getItem("timings._timings")).toBe(legacy);
  });

  test("a segment can be left untimed between two timed ones", () => {
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();

    lyricsStore.setLyrics("one_two_three");
    timingsStore.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);
    timingsStore.add(2, LYRIC_MARKERS.SEGMENT_START, 3.0);

    expect(timingsStore.activeSegments).toEqual([
      { text: "one_", start: 1.0 },
      { text: "two_" },
      { text: "three", start: 3.0 },
    ]);
    // The hole survives in the store even though the event projection can't express it.
    expect(timingsStore.rawTimings).toEqual([
      [1.0, LYRIC_MARKERS.SEGMENT_START],
      [3.0, LYRIC_MARKERS.SEGMENT_START],
    ]);
  });

  test("the audio waits out the title screen when a second voice starts during it", () => {
    useLyricsStore().setLyrics("[Anna] hello\n[Ben] world");
    const timingsStore = useTimingsStore();
    timingsStore.setAllSegments({
      Anna: [{ text: "hello", start: 10 }],
      Ben: [{ text: "world", start: 2 }],
    });

    expect(timingsStore.audioDelay).toBe(4);
  });

  // The point of the whole exercise: editing the words no longer costs the timing work around them.
  describe("lyric edits", () => {
    const timeThreeWords = () => {
      const timings = useTimingsStore();
      const lyrics = useLyricsStore();

      lyrics.setLyrics("one_alchemy_three");
      timings.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);
      timings.add(1, LYRIC_MARKERS.SEGMENT_START, 2.0);
      timings.add(2, LYRIC_MARKERS.SEGMENT_START, 3.0);
      timings.setupSegmentReconciliation();

      return { timings, lyrics };
    };

    test("splitting a word into syllables keeps every other timing", async () => {
      const { timings, lyrics } = timeThreeWords();

      lyrics.setLyrics("one_al/chem/y_three");
      await nextTick();

      expect(timings.activeSegments).toEqual([
        { text: "one_", start: 1.0 },
        { text: "al/", start: 2.0 },
        { text: "chem/" },
        { text: "y_" },
        { text: "three", start: 3.0 },
      ]);
    });

    test("joining syllables back up restores the word's own start", async () => {
      const { timings, lyrics } = timeThreeWords();

      lyrics.setLyrics("one_al/chem/y_three");
      await nextTick();
      lyrics.setLyrics("one_alchemy_three");
      await nextTick();

      expect(timings.activeSegments).toEqual([
        { text: "one_", start: 1.0 },
        { text: "alchemy_", start: 2.0 },
        { text: "three", start: 3.0 },
      ]);
    });

    test("fixing a typo keeps all the timings", async () => {
      const { timings, lyrics } = timeThreeWords();

      lyrics.setLyrics("one_alchemys_three");
      await nextTick();

      expect(timings.activeSegments).toEqual([
        { text: "one_", start: 1.0 },
        { text: "alchemys_", start: 2.0 },
        { text: "three", start: 3.0 },
      ]);
    });

    test("a word replaced by two passes its start to the first, flagged moved", async () => {
      const { timings, lyrics } = timeThreeWords();

      lyrics.setLyrics("one_bravo_charlie_three");
      await nextTick();

      expect(timings.activeSegments).toEqual([
        { text: "one_", start: 1.0 },
        { text: "bravo_", start: 2.0, review: "moved" },
        { text: "charlie_" },
        { text: "three", start: 3.0 },
      ]);
    });

    test("splitting a timed word leaves the song still finishable", async () => {
      const { timings, lyrics } = timeThreeWords();
      timings.add(2, LYRIC_MARKERS.SEGMENT_END, 3.5);
      expect(timings.areTimingsFinished).toBe(true);

      lyrics.setLyrics("one_al/chem/y_three");
      await nextTick();

      // The new syllables have no timing of their own, but they interpolate, so Submit stays open
      // instead of demanding the whole song be re-timed.
      expect(timings.activeSegments.filter((s) => s.start === undefined)).toHaveLength(2);
      expect(timings.areTimingsFinished).toBe(true);
    });

    // Reconciliation is lossy, so running it on its own output once per keystroke used to destroy
    // timings that the finished edit keeps perfectly well.
    test("typing a word one letter at a time keeps the timings around it", async () => {
      const timings = useTimingsStore();
      const lyrics = useLyricsStore();

      lyrics.setLyrics("one_three");
      timings.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);
      timings.add(1, LYRIC_MARKERS.SEGMENT_START, 3.0);
      timings.setupSegmentReconciliation();

      // The cursor sits after "one_" and the user types "two_".
      for (const text of ["one_tthree", "one_twthree", "one_twothree", "one_two_three"]) {
        lyrics.setLyrics(text);
        await nextTick();
      }

      expect(timings.activeSegments).toEqual([
        { text: "one_", start: 1.0 },
        { text: "two_" },
        { text: "three", start: 3.0 },
      ]);
    });

    test("a timing written between two lyric edits survives the second one", async () => {
      const timings = useTimingsStore();
      const lyrics = useLyricsStore();

      lyrics.setLyrics("one_three");
      timings.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);
      timings.setupSegmentReconciliation();

      lyrics.setLyrics("one_two_three");
      await nextTick();
      // The Adjust tab writes the whole array back after a drag.
      timings.resetSegments([
        { text: "one_", start: 1.0 },
        { text: "two_", start: 2.0 },
        { text: "three" },
      ]);

      // The drag has to move the baseline forward, or this edit reconciles against "one_three"
      // again and throws the 2.0 away.
      lyrics.setLyrics("one_two_threes");
      await nextTick();

      expect(timings.activeSegments).toEqual([
        { text: "one_", start: 1.0 },
        { text: "two_", start: 2.0 },
        { text: "threes" },
      ]);
    });

    test("an untimed tail still counts as unfinished", () => {
      const timings = useTimingsStore();
      const lyrics = useLyricsStore();

      lyrics.setLyrics("one_two_three");
      timings.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);
      timings.add(0, LYRIC_MARKERS.SEGMENT_END, 1.5);

      expect(timings.areTimingsUsable).toBe(false);
    });

    describe("a tag change that moves lines to another voice", () => {
      const load = () => {
        const timings = useTimingsStore();
        const lyrics = useLyricsStore();
        lyrics.setLyrics("[lead] one\n[choir] two_too\nthree");
        timings.setAllSegments({
          lead: [{ text: "one", start: 1 }],
          choir: [
            { text: "two_", start: 2 },
            { text: "too\n", start: 2.5 },
            { text: "three", start: 3 },
          ],
        });
        timings.setupSegmentReconciliation();
        return { timings, lyrics };
      };
      const edit = (text: string) =>
        useHistoryStore().record({ label: "Typing", tab: "lyrics" }, () =>
          useLyricsStore().setLyrics(text),
        );

      test("keeps their timings, and one undo puts them back", () => {
        const { timings } = load();

        edit("[lead] one\ntwo_too\n[choir] three");

        expect(timings.segmentsByVoice).toEqual({
          lead: [
            { text: "one\n", start: 1 },
            { text: "two_", start: 2 },
            { text: "too", start: 2.5 },
          ],
          choir: [{ text: "three", start: 3 }],
        });

        useHistoryStore().undo();

        expect(timings.segmentsByVoice.choir).toEqual([
          { text: "two_", start: 2 },
          { text: "too\n", start: 2.5 },
          { text: "three", start: 3 },
        ]);
      });

      test("keeps them when every line of a voice moves", async () => {
        const { timings, lyrics } = load();

        lyrics.setLyrics("[lead] one\ntwo_too\nthree");
        await nextTick();

        expect(timings.segmentsByVoice.lead).toEqual([
          { text: "one\n", start: 1 },
          { text: "two_", start: 2 },
          { text: "too\n", start: 2.5 },
          { text: "three", start: 3 },
        ]);
      });
    });

    test("a voice the lyrics no longer mention keeps its timings parked", async () => {
      const timings = useTimingsStore();
      const lyrics = useLyricsStore();

      lyrics.setLyrics("[Anna] hello\n[Ben] world");
      timings.setActiveVoice("Ben");
      timings.add(0, LYRIC_MARKERS.SEGMENT_START, 5.0);
      timings.setupSegmentReconciliation();

      lyrics.setLyrics("[Anna] hello");
      await nextTick();

      expect(timings.allTimings.Ben).toEqual([[5.0, LYRIC_MARKERS.SEGMENT_START]]);
    });
  });

  // A timings.json exported by any earlier version has to keep loading,
  // and what we export has to keep loading into those versions.
  // Both directions are the [time, marker] event form.
  describe("review flags", () => {
    const flagged = (): TimedSegment[] => [
      { text: "one_", start: 1, end: 1.5 },
      { text: "two_", start: 2, end: 2.5, review: "moved" },
      { text: "three", review: "lost" },
    ];
    const load = () => {
      const timings = useTimingsStore();
      useLyricsStore().setLyrics("one_two_three");
      timings.setAllSegments({ [DEFAULT_VOICE_ID]: flagged() });
      return timings;
    };
    const withSegment = (index: number, fields: Partial<TimedSegment>) =>
      flagged().map((segment, i) => (i === index ? { ...segment, ...fields } : segment));

    test("a drag of a flagged segment clears its flag", () => {
      const timings = load();

      timings.applyAdjustEdit(withSegment(1, { end: 2.7 }), "Drag");

      expect(timings.activeSegments[1]).toEqual({ text: "two_", start: 2, end: 2.7 });
    });

    test("a drag of a neighbour keeps the flag", () => {
      const timings = load();

      timings.applyAdjustEdit(withSegment(0, { start: 0.5 }), "Drag");

      expect(timings.activeSegments[1].review).toBe("moved");
    });

    test("Shift keeps every flag", () => {
      const timings = load();
      const shifted = flagged().map((segment) => ({
        ...segment,
        ...(segment.start !== undefined && { start: segment.start + 1 }),
        ...(segment.end !== undefined && { end: segment.end + 1 }),
      }));

      timings.applyAdjustEdit(shifted, "Shift", { keepReview: true });

      expect(timings.activeSegments.map(({ review }) => review)).toEqual([
        undefined,
        "moved",
        "lost",
      ]);
    });

    test("a sync writes its doubtful flags and is one undo entry", () => {
      const timings = load();
      const pending = pendingSync(timings.activeSegments, "fill");
      const result = {
        aligner: "fake@1",
        segments: [{ start: 1.1 }, { start: 2.1 }, { start: 3, doubtful: true }],
      };

      expect(timings.applySegmentTimes(DEFAULT_VOICE_ID, pending, result)).toBe(true);
      expect(timings.activeSegments.map(({ start, review }) => [start, review])).toEqual([
        [1.1, undefined],
        [2.1, undefined],
        [3, "doubtful"],
      ]);

      useHistoryStore().undo();

      expect(timings.activeSegments).toEqual(flagged());
    });

    test("a sync for a voice that has changed since writes nothing", () => {
      const timings = load();
      const pending = pendingSync(timings.activeSegments, "fill");
      timings.applyAdjustEdit(withSegment(0, { start: 0.5 }), "Drag");
      const result = { aligner: "fake@1", segments: [{}, {}, { start: 3, doubtful: true }] };

      expect(timings.applySegmentTimes(DEFAULT_VOICE_ID, pending, result)).toBe(false);
      expect(timings.activeSegments[2]).toEqual({ text: "three", review: "lost" });
    });

    test("a tap clears the flag of the segment it times", () => {
      const timings = load();

      timings.add(2, LYRIC_MARKERS.SEGMENT_START, 3);

      expect(timings.activeSegments[2]).toEqual({ text: "three", start: 3 });
      expect(timings.activeSegments[1].review).toBe("moved");
    });

    test("a tapped end clears the flag of the segment it ends", () => {
      const timings = load();

      timings.add(1, LYRIC_MARKERS.SEGMENT_END, 2.8);

      expect(timings.activeSegments[1]).toEqual({ text: "two_", start: 2, end: 2.8 });
    });

    test("a pass of taps clears the flag of every segment it retimes", () => {
      const timings = useTimingsStore();
      useLyricsStore().setLyrics("one_two_three");
      timings.setAllSegments({
        [DEFAULT_VOICE_ID]: [
          { text: "one_", start: 1, review: "moved" },
          { text: "two_", start: 2, review: "moved" },
          { text: "three", start: 3, review: "moved" },
        ],
      });
      let pass = startPass(timings.activeSegments, 0);
      pass = tapStart(tapStart(tapStart(pass, 1.1), 2.1), 3.1);

      timings.applyVoiceEdits(DEFAULT_VOICE_ID, tapSteps(pass), "Tap");

      expect(timings.activeSegments).toEqual([
        { text: "one_", start: 1.1 },
        { text: "two_", start: 2.1 },
        { text: "three", start: 3.1 },
      ]);
    });

    test("resuming the timing from a segment clears the flags from there on", () => {
      const timings = load();

      timings.setCurrentSegment(1);

      expect(timings.activeSegments.map(({ review }) => review)).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    });
  });

  describe("display periods", () => {
    const periodsOf = (timings: ReturnType<typeof useTimingsStore>) =>
      timings.activeSegments.map(({ text, displayStart, displayEnd }) => [
        text,
        displayStart,
        displayEnd,
      ]);

    test("a tap before a line's stored start pushes it", () => {
      const timings = useTimingsStore();
      useLyricsStore().setLyrics("one_two");
      timings.setAllSegments({
        [DEFAULT_VOICE_ID]: [{ text: "one_", start: 2, displayStart: 1.5 }, { text: "two" }],
      });

      timings.add(0, LYRIC_MARKERS.SEGMENT_START, 1);

      expect(timings.activeSegments[0].displayStart).toBe(1);
    });

    const withPeriods = (lyricText: string, segments: TimedSegment[]) => {
      const timings = useTimingsStore();
      const lyrics = useLyricsStore();
      lyrics.setLyrics(lyricText);
      timings.setAllSegments({ [DEFAULT_VOICE_ID]: segments });
      timings.setupSegmentReconciliation();
      return { timings, lyrics };
    };

    test("joining two lines keeps the first line's period, until the join is undone", async () => {
      const { timings, lyrics } = withPeriods("one\ntwo\nthree", [
        { text: "one\n", start: 1, displayStart: 0.5 },
        { text: "two\n", start: 2, displayStart: 1.5 },
        { text: "three", start: 3, displayStart: 2.5 },
      ]);

      lyrics.setLyrics("one_two\nthree");
      await nextTick();
      expect(periodsOf(timings)).toEqual([
        ["one_", 0.5, undefined],
        ["two\n", undefined, undefined],
        ["three", 2.5, undefined],
      ]);

      // Edits reconcile from the last timing write, as timings do, so the period comes back.
      lyrics.setLyrics("one\ntwo\nthree");
      await nextTick();
      expect(periodsOf(timings)[1]).toEqual(["two\n", 1.5, undefined]);
    });

    test("splitting a line leaves its period on the first half", async () => {
      const { timings, lyrics } = withPeriods("one_two\nthree", [
        { text: "one_", start: 1, displayStart: 0.5 },
        { text: "two\n", start: 2 },
        { text: "three", start: 3, displayStart: 2.5 },
      ]);

      lyrics.setLyrics("one\ntwo\nthree");
      await nextTick();
      expect(periodsOf(timings)).toEqual([
        ["one\n", 0.5, undefined],
        ["two\n", undefined, undefined],
        ["three", 2.5, undefined],
      ]);
    });

    test("clearing a voice's periods drops its bounds, keeps its timings and leaves the others", () => {
      const timings = useTimingsStore();
      useLyricsStore().setLyrics("[Anna] hello\n[Ben] world");
      timings.setAllSegments({
        Anna: [{ text: "hello", start: 1, end: 2, displayStart: 0.5, displayEnd: 3 }],
        Ben: [{ text: "world", start: 5, displayEnd: 7 }],
      });

      timings.clearDisplayPeriods("Anna");

      expect(timings.segmentsByVoice).toEqual({
        Anna: [{ text: "hello", start: 1, end: 2 }],
        Ben: [{ text: "world", start: 5, displayEnd: 7 }],
      });
    });

    test("flags the active voice's lines that the video shows in the same place", () => {
      const timings = useTimingsStore();
      useMediaStore().songDuration = 30;
      useLyricsStore().setLyrics("a\n\nb");
      timings.setAllSegments({
        [DEFAULT_VOICE_ID]: [
          { text: "a\n\n", start: 1, end: 2, displayEnd: 4 },
          { text: "b", start: 3, end: 4 },
        ],
      });

      const overlaps = () =>
        [...timings.activeLinePlacements.values()].map((line) => line.overlaps);
      expect(overlaps()).toEqual([true, true]);

      useSettingsStore().videoOptions.useStoredDisplayPeriods = false;
      expect(overlaps()).toEqual([false, false]);
    });

    test("deleting a line drops its period with it", async () => {
      const { timings, lyrics } = withPeriods("one\ntwo\nthree", [
        { text: "one\n", start: 1, displayStart: 0.5 },
        { text: "two\n", start: 2, displayStart: 1.5 },
        { text: "three", start: 3, displayStart: 2.5 },
      ]);

      lyrics.setLyrics("one\nthree");
      await nextTick();
      expect(periodsOf(timings)).toEqual([
        ["one\n", 0.5, undefined],
        ["three", 2.5, undefined],
      ]);
    });
  });

  describe("muted periods", () => {
    test("a tap past a line's stored mute end pushes it", () => {
      const timings = useTimingsStore();
      useLyricsStore().setLyrics("one_two");
      timings.setAllSegments({
        [DEFAULT_VOICE_ID]: [{ text: "one_", start: 1, end: 2, muteEnd: 3 }, { text: "two" }],
      });

      timings.add(1, LYRIC_MARKERS.SEGMENT_START, 2.5);
      timings.add(1, LYRIC_MARKERS.SEGMENT_END, 4);

      expect(timings.activeSegments[0].muteEnd).toBe(4);
    });

    test("a lyric edit keeps a line's mute on the line, and a split on its first half", async () => {
      const timings = useTimingsStore();
      const lyrics = useLyricsStore();
      lyrics.setLyrics("one_two\nthree");
      timings.setAllSegments({
        [DEFAULT_VOICE_ID]: [
          { text: "one_", start: 1, muteStart: 0.5, muteEnd: 2.5 },
          { text: "two\n", start: 2, end: 2.4 },
          { text: "three", start: 3 },
        ],
      });
      timings.setupSegmentReconciliation();

      lyrics.setLyrics("one\ntwo\nthree");
      await nextTick();
      expect(timings.activeSegments.map(({ muteStart, muteEnd }) => [muteStart, muteEnd])).toEqual([
        [0.5, 2.5],
        [undefined, undefined],
        [undefined, undefined],
      ]);
    });

    test("clearing drops every voice's mute bounds and keeps everything else", () => {
      const timings = useTimingsStore();
      useLyricsStore().setLyrics("[Anna] hello\n[Ben] world");
      timings.setAllSegments({
        Anna: [{ text: "hello", start: 1, end: 2, displayStart: 0.5, muteStart: 0.5 }],
        Ben: [{ text: "world", start: 5, muteEnd: 7 }],
      });

      timings.clearMuteBounds();

      expect(timings.segmentsByVoice).toEqual({
        Anna: [{ text: "hello", start: 1, end: 2, displayStart: 0.5 }],
        Ben: [{ text: "world", start: 5 }],
      });
      expect(timings.hasMuteBounds).toBe(false);
    });
  });

  describe("restored gaps", () => {
    test("are none outside advanced mode, even with the switch on", () => {
      const timings = useTimingsStore();
      useLyricsStore().setLyrics("one\ntwo");
      timings.setAllSegments({
        [DEFAULT_VOICE_ID]: [
          { text: "one\n", start: 1, end: 2 },
          { text: "two", start: 20, end: 21 },
        ],
      });
      useMediaStore().songDuration = 30;
      useSettingsStore().videoOptions.restoreGaps = true;
      expect(timings.gapPlan.gaps.length).toBeGreaterThan(0);

      useAdvancedStore().isAdvanced = false;
      expect(timings.restoredGaps).toEqual([]);
      useAdvancedStore().isAdvanced = true;
      expect(timings.restoredGaps).toEqual(timings.gapPlan.gaps);
    });
  });

  describe("existing projects", () => {
    test("a legacy single-voice timings.json still loads", () => {
      const timings = useTimingsStore();
      const lyrics = useLyricsStore();

      lyrics.setLyrics("Be bop_a lu bop\nShe's my ba/by");
      const fileContents: [number, number][] = [
        [1.0, LYRIC_MARKERS.SEGMENT_START],
        [2.0, LYRIC_MARKERS.SEGMENT_END],
        [3.0, LYRIC_MARKERS.SEGMENT_START],
        [4.0, LYRIC_MARKERS.SEGMENT_START],
        [5.0, LYRIC_MARKERS.SEGMENT_START],
      ];

      timings.resetTimings(fileContents);

      expect(timings.rawTimings).toEqual(fileContents);
      expect(timings.activeSegments).toEqual([
        { text: "Be bop_", start: 1.0, end: 2.0 },
        { text: "a lu bop\n", start: 3.0 },
        { text: "She's my ba/", start: 4.0 },
        { text: "by", start: 5.0 },
      ]);
    });

    test("a multi-voice timings.json still loads and re-exports identically", () => {
      const timings = useTimingsStore();
      const lyrics = useLyricsStore();

      lyrics.setLyrics("[Anna] hello\n[Ben] world");
      const fileContents = {
        Anna: [[1.0, LYRIC_MARKERS.SEGMENT_START]] as [number, number][],
        Ben: [[2.0, LYRIC_MARKERS.SEGMENT_START]] as [number, number][],
      };

      timings.setAllTimings(fileContents);

      expect(timings.allTimings).toEqual(fileContents);
    });

    test("a partly-timed project loads from a versioned timings.json", () => {
      const timings = useTimingsStore();
      const lyrics = useLyricsStore();

      lyrics.setLyrics("one_two_three");
      const file = JSON.parse(
        '{"version": 2, "voices": {"Voice 1": ' +
          '[{"text": "one_", "start": 1}, {"text": "two_"}, {"text": "three", "start": 3}]}}',
      );
      timings.setAllSegments(file.voices);

      expect(timings.activeSegments).toEqual([
        { text: "one_", start: 1.0 },
        { text: "two_" },
        { text: "three", start: 3.0 },
      ]);
    });

    test("a partly-timed multi-voice project survives the timings.txt round trip", () => {
      const timings = useTimingsStore();
      const lyrics = useLyricsStore();

      lyrics.setLyrics("[Anna] one_two\n[Ben] three");
      timings.setActiveVoice("Anna");
      timings.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);
      timings.setActiveVoice("Ben");
      timings.add(0, LYRIC_MARKERS.SEGMENT_START, 3.0);

      const text = timings.timingsText;
      expect(text).toMatch(/^Toul timings 3\n\nvoice "Anna"\n/);

      timings.clear();
      timings.setAllSegments(parseTimingsText(text).voices);

      expect(timings.timedSegmentsForVoice("Anna")).toEqual([
        { text: "one_", start: 1.0 },
        { text: "two" },
      ]);
      expect(timings.timedSegmentsForVoice("Ben")).toEqual([{ text: "three", start: 3.0 }]);
    });

    test("the exported timings.json keeps the old shape", () => {
      const timings = useTimingsStore();
      const lyrics = useLyricsStore();

      lyrics.setLyrics("one_two");
      timings.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);
      timings.add(0, LYRIC_MARKERS.SEGMENT_END, 1.5);
      timings.add(1, LYRIC_MARKERS.SEGMENT_START, 2.0);

      expect(JSON.parse(JSON.stringify(timings.allTimings))).toEqual({
        "Voice 1": [
          [1.0, LYRIC_MARKERS.SEGMENT_START],
          [1.5, LYRIC_MARKERS.SEGMENT_END],
          [2.0, LYRIC_MARKERS.SEGMENT_START],
        ],
      });
    });
  });

  test("re-timing one segment leaves its neighbours alone", () => {
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();

    lyricsStore.setLyrics("one_two_three");
    timingsStore.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);
    timingsStore.add(1, LYRIC_MARKERS.SEGMENT_START, 2.0);
    timingsStore.add(2, LYRIC_MARKERS.SEGMENT_START, 3.0);

    timingsStore.add(1, LYRIC_MARKERS.SEGMENT_START, 2.5);

    expect(timingsStore.activeSegments).toEqual([
      { text: "one_", start: 1.0 },
      { text: "two_", start: 2.5 },
      { text: "three", start: 3.0 },
    ]);
  });

  test("active voice follows the lyrics voices and can be switched", () => {
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();

    lyricsStore.setLyrics("[Anna] hello\n[Ben] world");

    // Defaults to the first voice
    expect(timingsStore.activeVoice).toBe("Anna");

    timingsStore.setActiveVoice("Ben");
    expect(timingsStore.activeVoice).toBe("Ben");

    // An invalid/stale active voice falls back to the first voice
    timingsStore.setActiveVoice("Nobody");
    expect(timingsStore.activeVoice).toBe("Anna");
  });

  test("timings are isolated per voice", () => {
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();

    lyricsStore.setLyrics("[Anna] hello\n[Ben] world");

    timingsStore.setActiveVoice("Anna");
    timingsStore.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);

    timingsStore.setActiveVoice("Ben");
    expect(timingsStore.rawTimings).toEqual([]); // Ben untouched
    timingsStore.add(0, LYRIC_MARKERS.SEGMENT_START, 5.0);

    // Each voice kept its own timings
    timingsStore.setActiveVoice("Anna");
    expect(timingsStore.rawTimings).toEqual([[1.0, LYRIC_MARKERS.SEGMENT_START]]);
    timingsStore.setActiveVoice("Ben");
    expect(timingsStore.rawTimings).toEqual([[5.0, LYRIC_MARKERS.SEGMENT_START]]);
  });

  test("setAllTimings replaces all voices and allTimings returns the map", () => {
    const timingsStore = useTimingsStore();
    timingsStore.setAllTimings({
      Anna: [[1.0, LYRIC_MARKERS.SEGMENT_START]],
      Ben: [[2.0, LYRIC_MARKERS.SEGMENT_START]],
    });

    expect(timingsStore.allTimings).toEqual({
      Anna: [[1.0, LYRIC_MARKERS.SEGMENT_START]],
      Ben: [[2.0, LYRIC_MARKERS.SEGMENT_START]],
    });
  });

  test("clear removes timings for all voices", () => {
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();

    lyricsStore.setLyrics("[Anna] hello\n[Ben] world");
    timingsStore.setActiveVoice("Anna");
    timingsStore.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);
    timingsStore.setActiveVoice("Ben");
    timingsStore.add(0, LYRIC_MARKERS.SEGMENT_START, 5.0);

    timingsStore.clear();

    timingsStore.setActiveVoice("Anna");
    expect(timingsStore.rawTimings).toEqual([]);
    timingsStore.setActiveVoice("Ben");
    expect(timingsStore.rawTimings).toEqual([]);
  });

  describe("voice reconciliation", () => {
    // Timings tapped out before any voice tag existed live under the default voice.
    // Adding a tag renames that voice, and the timings must follow it.
    const timeSingleVoice = (lyrics = "hello\nworld") => {
      const timingsStore = useTimingsStore();
      const lyricsStore = useLyricsStore();

      lyricsStore.setLyrics(lyrics);
      timingsStore.resetTimings([
        [1.0, LYRIC_MARKERS.SEGMENT_START],
        [2.0, LYRIC_MARKERS.SEGMENT_END],
      ]);
      expect(timingsStore.activeVoice).toBe(DEFAULT_VOICE_ID);

      return { timingsStore, lyricsStore };
    };

    test("tagging untagged lyrics carries the timings over to the tagged voice", async () => {
      const { timingsStore, lyricsStore } = timeSingleVoice();
      const timings = timingsStore.rawTimings;
      timingsStore.setupVoiceReconciliation();

      lyricsStore.setLyrics("[Anna] hello\nworld");
      await nextTick();

      expect(lyricsStore.voices).toEqual(["Anna"]);
      expect(timingsStore.activeVoice).toBe("Anna");
      expect(timingsStore.rawTimings).toStrictEqual(timings);
      expect(timingsStore.allTimings).toEqual({ Anna: timings });
    });

    test("the timings keep following the tag as it is typed out", async () => {
      const { timingsStore, lyricsStore } = timeSingleVoice();
      const timings = timingsStore.rawTimings;
      timingsStore.setupVoiceReconciliation();

      for (const tag of ["[A]", "[An]", "[Ann]", "[Anna]"]) {
        lyricsStore.setLyrics(`${tag} hello\nworld`);
        await nextTick();
      }

      expect(timingsStore.allTimings).toEqual({ Anna: timings });
    });

    test("a second voice added afterwards is timed from scratch", async () => {
      const { timingsStore, lyricsStore } = timeSingleVoice();
      const timings = timingsStore.rawTimings;
      timingsStore.setupVoiceReconciliation();

      lyricsStore.setLyrics("[Anna] hello\nworld");
      await nextTick();
      lyricsStore.setLyrics("[Anna] hello\nworld\n[Ben] backing");
      await nextTick();

      expect(lyricsStore.voices).toEqual(["Anna", "Ben"]);
      // Anna kept the original timings; Ben starts empty.
      expect(timingsStore.timingsForVoice("Anna")).toStrictEqual(timings);
      expect(timingsStore.timingsForVoice("Ben")).toEqual([]);
      expect(timingsStore.voicesWithTimings).toEqual(["Anna"]);
    });

    test("the voice style follows the rename", async () => {
      const { timingsStore, lyricsStore } = timeSingleVoice();
      const settingsStore = useSettingsStore();
      settingsStore.setVoiceStyleField(DEFAULT_VOICE_ID, "fontName", "Impact");
      timingsStore.setupVoiceReconciliation();

      lyricsStore.setLyrics("[Anna] hello\nworld");
      await nextTick();

      expect(settingsStore.getVoiceStyle("Anna")).toEqual({ fontName: "Impact" });
      expect(settingsStore.getVoiceStyle(DEFAULT_VOICE_ID)).toBeUndefined();
    });

    test("an ambiguous change leaves the timings parked and recoverable", async () => {
      const { timingsStore, lyricsStore } = timeSingleVoice();
      const timings = timingsStore.rawTimings;
      timingsStore.setupVoiceReconciliation();

      // Two new voices at once: there is no telling which one owns the old timings.
      lyricsStore.setLyrics("[Anna] hello\n[Ben] world");
      await nextTick();

      expect(timingsStore.rawTimings).toEqual([]);
      expect(timingsStore.allTimings[DEFAULT_VOICE_ID]).toStrictEqual(timings);

      // Undoing the edit brings them back.
      lyricsStore.setLyrics("hello\nworld");
      await nextTick();
      expect(timingsStore.rawTimings).toStrictEqual(timings);
    });

    test("does not move timings onto a voice that already has its own", async () => {
      const timingsStore = useTimingsStore();
      const lyricsStore = useLyricsStore();
      timingsStore.setupVoiceReconciliation();

      lyricsStore.setLyrics("[Anna] hello\n[Ben] world");
      await nextTick();
      timingsStore.setActiveVoice("Anna");
      timingsStore.add(0, LYRIC_MARKERS.SEGMENT_START, 1.0);
      timingsStore.setActiveVoice("Ben");
      timingsStore.add(0, LYRIC_MARKERS.SEGMENT_START, 5.0);

      // Dropping Ben's tag merges his line into Anna, who is already timed.
      lyricsStore.setLyrics("[Anna] hello\nworld");
      await nextTick();

      expect(timingsStore.timingsForVoice("Anna")).toEqual([[1.0, LYRIC_MARKERS.SEGMENT_START]]);
      expect(timingsStore.allTimings.Ben).toEqual([[5.0, LYRIC_MARKERS.SEGMENT_START]]);
    });

    test("setAllTimings adopts an imported default-voice map into the sole tagged voice", () => {
      const timingsStore = useTimingsStore();
      const lyricsStore = useLyricsStore();

      lyricsStore.setLyrics("[Anna] hello\nworld");
      const timings: [number, number][] = [[1.0, LYRIC_MARKERS.SEGMENT_START]];
      timingsStore.setAllTimings({ [DEFAULT_VOICE_ID]: timings });

      expect(timingsStore.allTimings).toEqual({ Anna: timings });
    });
  });

  test("subtitles should call createAssFile with correct parameters when timings exist", () => {
    // Setup the stores
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    const mediaStore = useMediaStore();
    const settingsStore = useSettingsStore();

    // Mock the store data
    lyricsStore.setLyrics("Test lyrics");
    timingsStore.resetTimings([
      [1.0, LYRIC_MARKERS.SEGMENT_START],
      [2.0, LYRIC_MARKERS.SEGMENT_END],
    ]);
    // @ts-ignore - Mocking private properties
    mediaStore.songDuration = 10;
    mediaStore.songTitle = "Test Song";
    mediaStore.songArtist = "Test Artist";
    settingsStore.videoOptions.font.name = "Impact";

    // Check the result
    expect(timingsStore.subtitles()).toBe("mock subtitles content");

    // Verify that createAssFile was called with the correct parameters
    expect(createAssFile).toHaveBeenCalledWith(
      timingsStore.activeSegments,
      10,
      "Test Song",
      "Test Artist",
      expect.objectContaining({ font: expect.objectContaining({ name: "Impact" }) }),
      settingsStore.fonts,
    );
  });

  test("subtitles draw in the uploaded face a style picks, and in the default font without it", async () => {
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    const settingsStore = useSettingsStore();

    lyricsStore.setLyrics("Test lyrics");
    timingsStore.resetTimings([
      [1.0, LYRIC_MARKERS.SEGMENT_START],
      [2.0, LYRIC_MARKERS.SEGMENT_END],
    ]);
    settingsStore.videoOptions.font.name = "Noto Sans Bold";

    timingsStore.subtitles();
    expect(vi.mocked(createAssFile).mock.lastCall?.[4]?.font.name).toBe("Trebuchet MS");

    const fontData = readFileSync(
      path.resolve(__dirname, "../../tests/fixtures/fonts/NotoSans-Bold.ttf"),
    );
    await settingsStore.addFonts([new File([new Uint8Array(fontData)], "uploaded.ttf")]);
    timingsStore.subtitles();

    expect(vi.mocked(createAssFile).mock.lastCall?.[4]?.font.name).toBe("Noto Sans Bold");
  });
});
