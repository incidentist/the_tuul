import { layOutVoices, VoiceTrack } from "./timing";
import { separableNeighbours, slotLines, songOffset } from "./screenSlots";
import { FontLibrary } from "./textWidth";

export { sameHeight } from "./screenSlots";

// Where and when the video draws a line. Heights are in subtitle canvas units, times in song time.
export interface LinePlacement {
  top: number;
  bottom: number;
  // Another line of any voice is shown at the same time and height, and neither can give way.
  overlaps: boolean;
  // The line's start and end can be dragged this far before they reach the timings or stored bounds
  // of a line at the same height.
  earliestStart: number;
  latestEnd: number;
  // Set when an automatic bound moved to make way for another line, or for a fade.
  startMoved?: number;
  endMoved?: number;
}

// In centiseconds, since that is all the video's timecodes can tell apart.
const centiseconds = (seconds: number) => Math.round(seconds * 100);

/**
 * Where the video draws each line of each voice, keyed by the index of the line's first segment.
 */
export function placeLines(
  tracks: VoiceTrack[],
  songDuration: number,
  title: string,
  artist: string,
  fonts: FontLibrary = new FontLibrary(),
): Record<string, Map<number, LinePlacement>> {
  const renders = layOutVoices(tracks, songDuration, title, artist, fonts);
  const offsets = renders.map(songOffset);
  const lines = slotLines(renders);
  const shown = lines.map(({ line, screen }) => ({
    start: centiseconds(line.customDisplayStartTime ?? screen.startTimestamp ?? 0),
    end: centiseconds(line.customDisplayEndTime ?? screen.endTimestamp),
  }));

  const placements: Record<string, Map<number, LinePlacement>> = Object.fromEntries(
    tracks.map((track) => [track.voice, new Map()]),
  );
  for (const [i, slotted] of lines.entries()) {
    const { line, voice, top, bottom } = slotted;
    const songTime = (time: number) => time - offsets[voice];
    const neighbours = separableNeighbours(slotted, lines);
    const overlaps = lines.some(
      (other, j) =>
        j !== i &&
        shown[j].start < shown[i].end &&
        shown[i].start < shown[j].end &&
        top < other.bottom &&
        other.top < bottom,
    );
    const before = neighbours.filter((other) => other.fixedEnd <= slotted.fixedStart);
    const after = neighbours.filter((other) => other.fixedStart >= slotted.fixedEnd);
    placements[tracks[voice].voice].set(line.headIndex ?? 0, {
      top,
      bottom,
      overlaps,
      earliestStart: Math.max(0, ...before.map((other) => songTime(other.fixedEnd))),
      latestEnd: Math.min(songDuration, ...after.map((other) => songTime(other.fixedStart))),
      startMoved: line.startMoved ? songTime(line.customDisplayStartTime!) : undefined,
      endMoved: line.endMoved ? songTime(line.customDisplayEndTime!) : undefined,
    });
  }
  return placements;
}
