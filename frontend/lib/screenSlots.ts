import { displayEndOf, displayStartOf } from "./adjustments";
import {
  VerticalAlignment,
  type LyricsLine,
  type LyricsScreen,
  type ScreenKind,
  type Timestamp,
  type VoiceTrackRender,
} from "./timing";

// A lyrics line where the video draws it, in subtitle canvas units, and when, in the render's time.
export interface SlottedLine {
  line: LyricsLine;
  screen: LyricsScreen;
  // The index of the line's voice among the renders.
  voice: number;
  top: number;
  bottom: number;
  // The part of the display period that can't give way to another line: the timings and the stored bounds.
  fixedStart: Timestamp;
  fixedEnd: Timestamp;
  startStored: boolean;
  endStored: boolean;
}

/**
 * Whether two lines are drawn at heights that overlap.
 */
export function sameHeight(
  a: { top: number; bottom: number },
  b: { top: number; bottom: number },
): boolean {
  return a.top < b.bottom && b.top < a.bottom;
}

/**
 * Every line of every voice on screens of the given kinds, placed as the video draws it.
 */
export function slotLines(
  renders: VoiceTrackRender[],
  kinds: ScreenKind[] = ["lyrics"],
): SlottedLine[] {
  return renders.flatMap((render, voice) => {
    const { size } = render.options.font;
    const stored = render.options.useStoredDisplayPeriods;
    return render.screens
      .filter((screen) => kinds.includes(screen.kind))
      .flatMap((screen) =>
        screen.lines.map((line, lineInScreen) => {
          const title = screen.kind === "title";
          const { top, bottom } = screen.getLineBounds(
            lineInScreen,
            size,
            title ? VerticalAlignment.Middle : render.options.verticalAlignment,
            render.options,
          );
          const startStored = stored && line.storedDisplayStart !== undefined;
          // The title's end is only set when a stored display period cuts it short.
          const endStored = title
            ? line.customDisplayEndTime !== undefined
            : stored && line.storedDisplayEnd !== undefined;
          return {
            line,
            screen,
            voice,
            top,
            bottom,
            fixedStart: startStored ? displayStartOf(line, screen) : line.timestamp,
            fixedEnd: endStored ? displayEndOf(line, screen) : line.endTimestamp,
            startStored,
            endStored,
          };
        }),
      );
  });
}

/**
 * The lines at `line`'s height whose fixed parts don't overlap its own.
 * The ones that do can't be separated, so they are left overlapping.
 */
export function separableNeighbours(line: SlottedLine, lines: SlottedLine[]): SlottedLine[] {
  return lines.filter(
    (other) =>
      other !== line &&
      sameHeight(line, other) &&
      !(other.fixedStart < line.fixedEnd && line.fixedStart < other.fixedEnd),
  );
}

/**
 * An automatic bound gives way to the fixed part of any line at its height, in any voice,
 * so the line appears once that line has ended, or disappears as it appears.
 * A bound only ever moves towards the line's own timings, so giving way never makes a new overlap.
 */
export function giveWayToStoredPeriods(renders: VoiceTrackRender[]): void {
  const lines = slotLines(renders);
  if (!lines.some((line) => line.startStored || line.endStored)) {
    return;
  }
  for (const slotted of lines) {
    const { line, screen } = slotted;
    const neighbours = separableNeighbours(slotted, lines);
    const start = displayStartOf(line, screen);
    const end = displayEndOf(line, screen);
    if (!slotted.startStored) {
      const before = neighbours.filter(
        (other) => other.fixedStart < slotted.fixedStart && other.fixedEnd > start,
      );
      if (before.length > 0) {
        line.customDisplayStartTime = Math.max(...before.map((other) => other.fixedEnd));
        line.startMoved = true;
      }
    }
    if (!slotted.endStored) {
      const after = neighbours.filter(
        (other) => other.fixedEnd > slotted.fixedEnd && other.fixedStart < end,
      );
      if (after.length > 0) {
        line.customDisplayEndTime = Math.min(...after.map((other) => other.fixedStart));
        line.endMoved = true;
      }
    }
  }
}

// The longest a line takes to fade in or out.
export const LINE_FADE: Timestamp = 0.15;

/**
 * How far the title screen and a quick-start count-in delay a voice's song in the render.
 */
export function songOffset(render: VoiceTrackRender): Timestamp {
  return render.screens.reduce((sum, screen) => sum + screen.audioDelay, 0);
}

/**
 * The middle of the time the title and artist are both shown, or null when there is no title
 * screen or nothing written on it.
 */
export function titleFrameTime(render: VoiceTrackRender): Timestamp | null {
  const screen = render.screens.find(({ kind }) => kind === "title");
  const lines = screen?.lines.filter((line) => line.segments.some(({ text }) => text.trim())) ?? [];
  if (!screen || lines.length === 0) {
    return null;
  }
  const start = Math.max(...lines.map((line) => displayStartOf(line, screen)));
  const end = Math.min(...lines.map((line) => displayEndOf(line, screen)));
  return end > start ? (start + end) / 2 : null;
}

/**
 * Fade every lyrics line in before it animates and out after it has been sung.
 * The title lines fade in and out all together, as the title screen starts and ends.
 * A fade never overlaps the line's own animation, so it may be shorter than LINE_FADE, or absent.
 */
export function fadeLines(renders: VoiceTrackRender[], songDuration: Timestamp): void {
  const lines = slotLines(renders, ["lyrics", "title"]);
  const songEnds = renders.map((render) => songDuration + songOffset(render));
  for (const slotted of lines) {
    if (slotted.screen.kind === "lyrics") {
      makeRoomToFadeOut(slotted, lines, songEnds[slotted.voice]);
    }
  }
  const fade = (room: Timestamp) => Math.min(LINE_FADE, Math.max(0, room));
  for (const { line, screen } of lines) {
    const start = displayStartOf(line, screen);
    const end = displayEndOf(line, screen);
    if (screen.kind === "lyrics") {
      line.fadeInDuration = fade(line.timestamp - start);
      line.fadeOutDuration = fade(end - line.endTimestamp);
    } else {
      line.fadeInDuration = line.fadeOutDuration = fade((end - start) / 2);
    }
  }
}

/**
 * Fade every instrumental bar in and out while it sweeps, since the sweep lasts its whole screen.
 */
export function fadeInstrumentalScreens(screens: LyricsScreen[]): void {
  for (const screen of screens.filter(({ kind }) => kind === "instrumental")) {
    const length = screen.endTimestamp - (screen.startTimestamp ?? 0);
    screen.lines[0].fadeInDuration = screen.lines[0].fadeOutDuration = Math.min(
      LINE_FADE,
      length / 2,
    );
  }
}

/**
 * Keep a line whose automatic end comes right after its singing shown long enough to fade out.
 * The line at its height that appears next gives way, but only to the midpoint of the time
 * between the two lines' animations, so that it keeps as much room to fade in.
 */
function makeRoomToFadeOut(slotted: SlottedLine, lines: SlottedLine[], songEnd: Timestamp): void {
  const { line, screen } = slotted;
  const end = displayEndOf(line, screen);
  const wanted = Math.min(line.endTimestamp + LINE_FADE, songEnd);
  if (slotted.endStored || end >= wanted) {
    return;
  }
  const inTheWay = lines
    .filter((other) => other !== slotted && sameHeight(slotted, other))
    .map((other) => ({
      other,
      start: displayStartOf(other.line, other.screen),
      end: displayEndOf(other.line, other.screen),
    }))
    .filter((shown) => shown.start < wanted && shown.end > end);
  // A line already shown with this one, or with a stored start, stays where it is.
  const limits = inTheWay.map(({ other, start }) =>
    start < end || other.startStored
      ? start
      : Math.max(start, (line.endTimestamp + other.line.timestamp) / 2),
  );
  const newEnd = Math.min(wanted, ...limits);
  if (newEnd <= end) {
    return;
  }
  line.customDisplayEndTime = newEnd;
  line.endMoved = true;
  for (const { other, start } of inTheWay) {
    if (start < newEnd) {
      other.line.customDisplayStartTime = newEnd;
      other.line.startMoved = true;
    }
  }
}
