import { minBy } from "lodash-es";
import { createScreens, KaraokeOptions, LyricsLine } from "./timing";
import { TimedSegment } from "./timedSegments";
import { LinePlacement } from "./linePlacements";
import { FontLibrary } from "./textWidth";

// One line's display period as the Adjust tab draws it, in song time.
export interface DisplayBand {
  // The index of the segment that holds the line's stored period.
  segmentIndex: number;
  // The waveform row the line is drawn in.
  row: number;
  text: string;
  syllables: { start: number; end: number }[];
  start: number;
  end: number;
  startStored: boolean;
  endStored: boolean;
  // A period always contains the line's timings, so its edges can't be dragged past them.
  latestStart: number;
  earliestEnd: number;
  // Where and when the video draws the line, when it is known.
  // It also holds the automatic bounds the video moves for another line or for a fade,
  // which this layout alone can't tell.
  placement?: LinePlacement;
}

// The new edges of a line's display period. An edge left out stays as it was.
export interface BandUpdate {
  segmentIndex: number;
  start?: number;
  end?: number;
}

// The number of rows the Adjust tab lays regions out in.
const ROWS = 5;

/**
 * Every line's display period, automatic or stored, as the render computes it.
 * The title screen and count-ins are left out, since they move the song away from song time.
 * `placements` are keyed by the index of each line's first segment.
 */
export function displayBands(
  segments: TimedSegment[],
  songDuration: number,
  options: KaraokeOptions,
  placements: ReadonlyMap<number, LinePlacement> = new Map(),
  fonts: FontLibrary = new FontLibrary(),
): DisplayBand[] {
  const screens = createScreens(
    segments,
    songDuration,
    "",
    "",
    { ...options, addTitleScreen: false, countInMode: "none", useStoredDisplayPeriods: true },
    fonts,
  );
  const placement = (line: LyricsLine) => placements.get(line.headIndex ?? 0);
  return screens
    .filter((screen) => screen.kind === "lyrics")
    .flatMap((screen) => screen.lines.map((line) => ({ screen, line })))
    .map(({ screen, line }, index) => ({
      segmentIndex: line.headIndex ?? 0,
      // Consecutive lines never share a row, so lines on neighbouring screens can overlap in time.
      row: index % ROWS,
      text: line.segments
        .map((segment) => segment.text)
        .join("")
        .trim(),
      syllables: syllablesOf(line),
      start:
        placement(line)?.startMoved ?? line.customDisplayStartTime ?? screen.startTimestamp ?? 0,
      end: placement(line)?.endMoved ?? line.customDisplayEndTime ?? screen.endTimestamp,
      startStored: line.storedDisplayStart !== undefined,
      endStored: line.storedDisplayEnd !== undefined,
      latestStart: line.timestamp,
      earliestEnd: line.endTimestamp,
      placement: placement(line),
    }));
}

/**
 * The times a dragged edge of `band` snaps to: the edges of the lines in other rows,
 * and the first syllable of the next line. The edges of the `moving` bands are left out.
 */
export function snapTargets(
  bands: DisplayBand[],
  band: DisplayBand,
  moving: DisplayBand[] = [],
): number[] {
  const next = bands[bands.indexOf(band) + 1];
  return [
    // Two edges at the same time in one row can't be told apart, so the band's own row is left out.
    ...bands
      .filter((other) => other.row !== band.row && !moving.includes(other))
      .flatMap((other) => [other.start, other.end]),
    ...(next ? [next.latestStart] : []),
  ];
}

/**
 * The target nearest `time`, if one is within `tolerance` of it and between `min` and `max`.
 */
export function nearestTarget(
  time: number,
  targets: number[],
  tolerance: number,
  min: number,
  max: number,
): number | undefined {
  const distance = (target: number) => Math.abs(target - time);
  return minBy(
    targets.filter((target) => target >= min && target <= max && distance(target) <= tolerance),
    distance,
  );
}

/**
 * Cut `delta` back so that one edge of every band can be moved by it together. A start can't pass
 * its line's first syllable, and an end its last. Neither can reach a line at the same height,
 * unless the two overlap already, and the edge is then only kept from going further in.
 */
export function clampEdgeShift(
  bands: DisplayBand[],
  side: "start" | "end",
  delta: number,
  duration: number,
): number {
  let min = -Infinity;
  let max = Infinity;
  for (const band of bands) {
    const { earliestStart = 0, latestEnd = duration } = band.placement ?? {};
    const [lowest, highest] =
      side === "start" ? [earliestStart, band.latestStart] : [band.earliestEnd, latestEnd];
    min = Math.max(min, Math.min(0, lowest - band[side]));
    max = Math.min(max, Math.max(0, highest - band[side]));
  }
  return Math.min(max, Math.max(min, delta));
}

/**
 * Cut `delta` back so that every band can be moved by it together, both edges at once.
 */
export function clampBandShift(bands: DisplayBand[], delta: number, duration: number): number {
  // Each side allows a range around 0, so clamping to one and then the other lands in both.
  return clampEdgeShift(bands, "end", clampEdgeShift(bands, "start", delta, duration), duration);
}

/**
 * The line's syllables, with the halves of one a row starts inside joined back together.
 */
function syllablesOf(line: LyricsLine): { start: number; end: number }[] {
  const syllables: { start: number; end: number }[] = [];
  for (const segment of line.segments) {
    const end = segment.endTimestamp ?? segment.timestamp;
    if (segment.rowStart === "wrapInSyllable") {
      syllables[syllables.length - 1].end = end;
    } else {
      syllables.push({ start: segment.timestamp, end });
    }
  }
  return syllables;
}
