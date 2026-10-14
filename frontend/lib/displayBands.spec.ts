import { describe, expect, it } from "vitest";
import {
  clampBandShift,
  clampEdgeShift,
  DisplayBand,
  displayBands,
  nearestTarget,
  snapTargets,
} from "./displayBands";
import { DEFAULT_KARAOKE_OPTIONS, KaraokeOptions } from "./timing";

const options: KaraokeOptions = {
  ...DEFAULT_KARAOKE_OPTIONS,
  instrumentalThreshold: 0,
  addStaggeredLines: false,
};

describe("displayBands", () => {
  it("keeps a syllable a row starts inside whole", () => {
    const text = "Pale moon rising slow over the quiet hill, lanterns drifting home";
    const [band] = displayBands([{ text, start: 10, end: 20 }], 30, {
      ...options,
      font: { name: "Georgia", size: 30 },
    });
    expect(band.text).toBe(text);
    expect(band.syllables).toEqual([{ start: 10, end: 20 }]);
  });

  it("gives each line its period, its row, its text and the segment that stores it", () => {
    const bands = displayBands(
      [
        { text: "a_", start: 10 },
        { text: "b\n", start: 11, end: 12 },
        { text: "c\n\n", start: 13, end: 14, displayEnd: 20 },
        { text: "d", start: 16, end: 17, displayStart: 15 },
      ],
      30,
      options,
    );

    expect(bands).toEqual([
      {
        segmentIndex: 0,
        row: 0,
        text: "a b",
        syllables: [
          { start: 10, end: 11 },
          { start: 11, end: 12 },
        ],
        start: 0,
        end: 14,
        startStored: false,
        endStored: false,
        latestStart: 10,
        earliestEnd: 12,
      },
      {
        segmentIndex: 2,
        row: 1,
        text: "c",
        syllables: [{ start: 13, end: 14 }],
        start: 0,
        end: 20,
        startStored: false,
        endStored: true,
        latestStart: 13,
        earliestEnd: 14,
      },
      {
        segmentIndex: 3,
        row: 2,
        text: "d",
        syllables: [{ start: 16, end: 17 }],
        start: 15,
        end: 17,
        startStored: true,
        endStored: false,
        latestStart: 16,
        earliestEnd: 17,
      },
    ]);
  });

  it("gives each line the placement stored under its first segment", () => {
    const segments = [
      { text: "a\n", start: 1, end: 2 },
      { text: "b_", start: 3 },
      { text: "c", start: 4, end: 5 },
    ];
    const placement = { top: 10, bottom: 30, overlaps: true, earliestStart: 0, latestEnd: 30 };
    const bands = displayBands(segments, 30, options, new Map([[1, placement]]));
    expect(bands.map((band) => band.placement)).toEqual([undefined, placement]);
  });

  it("moves a bound that gave way to another line", () => {
    const segments = [{ text: "a", start: 3, end: 4 }];
    const placement = {
      top: 10,
      bottom: 30,
      overlaps: false,
      earliestStart: 2,
      latestEnd: 30,
      startMoved: 2,
    };
    const [band] = displayBands(segments, 30, options, new Map([[0, placement]]));
    expect(band.start).toBe(2);
    expect(band.end).toBe(4);
  });

  it("puts every fifth line back in the first row", () => {
    const segments = Array.from({ length: 6 }, (_, i) => ({ text: `l${i}\n`, start: i }));
    expect(displayBands(segments, 30, options).map((band) => band.row)).toEqual([0, 1, 2, 3, 4, 0]);
  });

  it("leaves out the title screen, so the bands stay in song time", () => {
    const [band] = displayBands([{ text: "a", start: 1.5, displayStart: 1 }], 30, {
      ...options,
      addTitleScreen: true,
    });

    expect(band.start).toBe(1);
  });
});

describe("snapTargets", () => {
  const band = (row: number, start: number, end: number, latestStart: number): DisplayBand => ({
    segmentIndex: 0,
    row,
    text: "",
    syllables: [],
    start,
    end,
    startStored: false,
    endStored: false,
    latestStart,
    earliestEnd: latestStart + 1,
  });
  const bands = [band(0, 1, 5, 2), band(1, 3, 8, 4), band(2, 6, 11, 7), band(0, 9, 14, 10)];

  it("takes the edges of the lines in other rows, and the next line's first syllable", () => {
    expect(snapTargets(bands, bands[1])).toEqual([1, 5, 6, 11, 9, 14, 7]);
  });

  it("leaves out the lines in the band's own row", () => {
    expect(snapTargets(bands, bands[0])).toEqual([3, 8, 6, 11, 4]);
  });

  it("has no next line after the last one", () => {
    expect(snapTargets(bands, bands[3])).toEqual([3, 8, 6, 11]);
  });

  it("leaves out the lines moving along with the band", () => {
    expect(snapTargets(bands, bands[1], [bands[1], bands[2]])).toEqual([1, 5, 9, 14, 7]);
  });
});

describe("nearestTarget", () => {
  it("picks the nearest target within the tolerance", () => {
    expect(nearestTarget(10, [9.7, 10.2, 12], 0.5, 0, 30)).toBe(10.2);
  });

  it("finds none beyond the tolerance", () => {
    expect(nearestTarget(10, [9, 11], 0.5, 0, 30)).toBeUndefined();
  });

  it("skips a target the edge can't reach", () => {
    expect(nearestTarget(10, [10.1, 9.8], 0.5, 0, 10)).toBe(9.8);
    expect(nearestTarget(10, [10.1], 0.5, 0, 10)).toBeUndefined();
  });
});

describe("clampEdgeShift", () => {
  const DURATION = 100;
  // A line sung from 10 to 12 s and shown from 8 to 15 s, between lines at its height that hold
  // on to 5 s and from 20 s.
  const band = (overrides: Partial<DisplayBand> = {}): DisplayBand => ({
    segmentIndex: 0,
    row: 0,
    text: "",
    syllables: [],
    start: 8,
    end: 15,
    startStored: false,
    endStored: false,
    latestStart: 10,
    earliestEnd: 12,
    placement: {
      top: 0,
      bottom: 1,
      overlaps: false,
      earliestStart: 5,
      latestEnd: 20,
    },
    ...overrides,
  });

  it("passes a shift through when nothing is in the way", () => {
    expect(clampEdgeShift([band()], "start", -1, DURATION)).toBe(-1);
    expect(clampEdgeShift([band()], "end", 2, DURATION)).toBe(2);
  });

  it("stops a start at the line's first syllable and at the line before at its height", () => {
    expect(clampEdgeShift([band()], "start", 5, DURATION)).toBe(2);
    expect(clampEdgeShift([band()], "start", -5, DURATION)).toBe(-3);
  });

  it("stops an end at the line's last syllable and at the line after at its height", () => {
    expect(clampEdgeShift([band()], "end", -5, DURATION)).toBe(-3);
    expect(clampEdgeShift([band()], "end", 10, DURATION)).toBe(5);
  });

  it("stops every band where the first of them is stopped", () => {
    const roomy = band();
    const tight = band({ start: 9.5, end: 12.5 });
    expect(clampEdgeShift([roomy, tight], "start", 2, DURATION)).toBe(0.5);
    expect(clampEdgeShift([roomy, tight], "end", -2, DURATION)).toBe(-0.5);
  });

  it("keeps an edge already past a line at its height from going further in", () => {
    const overlapping = band({ start: 4 });
    expect(clampEdgeShift([overlapping], "start", -1, DURATION)).toBe(0);
    expect(clampEdgeShift([overlapping], "start", 3, DURATION)).toBe(3);
  });

  it("falls back to the song's bounds without a placement", () => {
    const unplaced = band({ placement: undefined });
    expect(clampEdgeShift([unplaced], "start", -20, DURATION)).toBe(-8);
    expect(clampEdgeShift([unplaced], "end", 200, DURATION)).toBe(85);
  });
});

describe("clampBandShift", () => {
  const band = (start: number, end: number, latestStart: number, earliestEnd: number) =>
    ({ start, end, latestStart, earliestEnd }) as DisplayBand;

  it("stops a band at whichever of its edges is stopped first", () => {
    // The start can go 3 s back and 1 s on, the end 6 s back and 2 s on.
    const shown = band(3, 8, 4, 2);
    expect(clampBandShift([shown], -5, 10)).toBe(-3);
    expect(clampBandShift([shown], 5, 10)).toBe(1);
  });

  it("stops every band where the first of them is stopped", () => {
    expect(clampBandShift([band(3, 8, 4, 2), band(1, 6, 5, 4)], -5, 10)).toBe(-1);
  });
});
