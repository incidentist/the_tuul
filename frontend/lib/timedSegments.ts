// This is the stored form of one voice's timings.
// Every segment carries its own text, so lyrics and timings cannot drift apart.

import { range } from "lodash-es";
import { GAP_MAX_LEAD, LYRIC_MARKERS } from "@/constants";
import { LyricEvent, Segment, parseLyrics, displayText, resolveStarts } from "@/lib/timing";
import { VoiceId } from "@/lib/voices";

export interface TimedSegment {
  // The text includes the trailing `_`, `/`, `\n` or `\n\n` separator, as
  // `parseLyrics(..., true)` yields it.
  text: string;
  start?: number;
  end?: number;
  // A line's display period, only read on the line's first segment.
  // A missing bound is automatic.
  displayStart?: number;
  displayEnd?: number;
  // A line's muted period, when gap restore plays the backing track, only read on the line's
  // first segment. A missing bound is automatic.
  muteStart?: number;
  muteEnd?: number;
  // A line's spacer counts, only read on its first segment.
  // They come from the lyrics, like the text.
  spacersBefore?: number;
  spacersAfter?: number;
  // A lyric edit or a sync put this segment's timing in doubt, and nobody has retimed or checked
  // it since.
  // "lost": the segment took the place of timed words, and their timings were dropped.
  // "moved": the segment's start or end came from a different word.
  // "doubtful": a sync placed the segment, and the aligner wasn't sure of it.
  review?: ReviewFlag;
}

export type ReviewFlag = "lost" | "moved" | "doubtful";

// From the flag that asks for the most attention to the least.
const FLAGS_BY_URGENCY: ReviewFlag[] = ["lost", "moved", "doubtful"];

/**
 * The flag that asks for more attention. A lost timing is worse than a moved one, and a moved one
 * is worse than one the aligner placed without being sure.
 */
function strongerFlag(a?: ReviewFlag, b?: ReviewFlag): ReviewFlag | undefined {
  return FLAGS_BY_URGENCY.find((flag) => flag === a || flag === b);
}

/**
 * The segment without its review flag.
 */
export function unflagged({ review: _review, ...segment }: TimedSegment): TimedSegment {
  return segment;
}

function isTimedSegment({ start, end }: TimedSegment): boolean {
  return start !== undefined || end !== undefined;
}

/**
 * The word compared without case or punctuation.
 */
function spellingKey(word: string): string[] {
  return [...word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")];
}

/**
 * The optimal string alignment distance:
 * the Levenshtein distance, with a swap of two neighbouring letters counted as one edit.
 */
function alignmentDistance(a: string[], b: string[]): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * Whether replacing one word with the other corrects its spelling rather than changing the word.
 * A short word changed by one letter is usually a different word, such as `cat` and `cut`.
 */
export function isSpellingFix(from: string, to: string): boolean {
  const a = spellingKey(from);
  const b = spellingKey(to);
  if (a.join("") === b.join("")) {
    return true;
  }
  return Math.min(a.length, b.length) >= 4 && alignmentDistance(a, b) <= 1;
}

/**
 * The segments of `after`, without the flags of those the user has retimed:
 * those whose start or end differs from the segment at the same index in `before`.
 */
export function clearRetimedFlags(before: TimedSegment[], after: TimedSegment[]): TimedSegment[] {
  return after.map((segment, i) =>
    segment.review && (segment.start !== before[i]?.start || segment.end !== before[i]?.end)
      ? unflagged(segment)
      : segment,
  );
}

/**
 * A lyric segment as an untimed segment, with its text and spacer counts.
 */
export function fromLyric({ text, spacersBefore, spacersAfter }: Segment): TimedSegment {
  return {
    text,
    ...(spacersBefore ? { spacersBefore } : {}),
    ...(spacersAfter ? { spacersAfter } : {}),
  };
}

/**
 * The stored segment with its text and spacer counts replaced by the lyric segment's.
 */
function relabel(stored: TimedSegment, lyric: Segment): TimedSegment {
  const { spacersBefore: _before, spacersAfter: _after, ...timings } = stored;
  return { ...timings, ...fromLyric(lyric) };
}

/**
 * An event past the end of the lyrics gets a textless segment rather than being dropped.
 * Timings are entered before lyrics exist, so losing one is worse than carrying an empty text.
 */
export function fromEvents(lyricText: string, events: LyricEvent[]): TimedSegment[] {
  const segments: TimedSegment[] = parseLyrics(lyricText, true).map(fromLyric);

  let index = -1;
  for (const [time, marker] of events) {
    if (marker === LYRIC_MARKERS.SEGMENT_START) {
      index++;
      if (index === segments.length) {
        segments.push({ text: "" });
      }
      segments[index].start = time;
    } else if (marker === LYRIC_MARKERS.SEGMENT_END && index >= 0) {
      segments[index].end = time;
    }
  }
  return segments;
}

export function toEvents(segments: TimedSegment[]): LyricEvent[] {
  const events: LyricEvent[] = [];
  for (const { start, end } of segments) {
    if (start === undefined) {
      // An end without a start would attach to the *previous* segment once the join goes back to being positional,
      // moving a timing onto the wrong words.
      continue;
    }
    events.push([start, LYRIC_MARKERS.SEGMENT_START]);
    if (end !== undefined) {
      events.push([end, LYRIC_MARKERS.SEGMENT_END]);
    }
  }
  return events;
}

/**
 * The last segment of a lyric has no trailing separator, so appending to the end rewrites it and
 * `three` becomes `three_`. The same word in the same place must not read as a different one.
 */
export function segmentWord(text: string): string {
  return text.replace(/(\n\n|\/\||[\n/_|])$/, "");
}

// A reconciled segment, with the flag the diff raised on it over the one it inherited.
type Carried = { segment: TimedSegment; raised?: ReviewFlag };

/**
 * This carries one voice's timings across an edit to its lyrics.
 *
 * The lines are aligned by their drawn text,
 * and the words of each pair of lines, or of each gap between matched lines, by a word diff
 * (see `diffSegments`).
 * A matched word keeps its timing, an inserted one is untimed,
 * and a replaced run keeps what it can, flagging what the user should check
 * (see `TimedSegment.review`).
 */
export function reconcile(stored: TimedSegment[], current: Segment[]): TimedSegment[] {
  return reconcileLines(stored, current).map(({ segment }) => segment);
}

/**
 * How many segments reconciling raised a flag on, over the flags they inherited.
 */
export function raisedFlags(
  stored: TimedSegment[],
  current: Segment[],
): { lost: number; moved: number } {
  const raised = reconcileLines(stored, current).map(({ raised }) => raised);
  return {
    lost: raised.filter((flag) => flag === "lost").length,
    moved: raised.filter((flag) => flag === "moved").length,
  };
}

/**
 * Each voice's stored segments, with the lines that a change of voice tags moved carried along.
 * A timed line that one voice lost moves to a voice that gained a line drawn the same way.
 * It goes where the new lyrics put it, so `reconcile` pairs it with that line like an unchanged one.
 * A moved line out of time order with its new neighbours is flagged for review, not reordered.
 * `lyricsByVoice` holds the lyric segments of every voice that a line can leave or join.
 */
export function carryMovedLines(
  storedByVoice: Record<VoiceId, TimedSegment[]>,
  lyricsByVoice: Record<VoiceId, Segment[]>,
): Record<VoiceId, TimedSegment[]> {
  const diffs = Object.entries(lyricsByVoice).map(([voice, lyrics]) => {
    const stored = splitLines(storedByVoice[voice] ?? []);
    const current = splitLines(lyrics);
    const matches = commonSubsequence(stored.map(lineKey), current.map(lineKey));
    return { voice, stored, current, matches };
  });

  const lost = diffs.flatMap(({ voice, stored, matches }) => {
    const kept = new Set(matches.map(([i]) => i));
    return stored.flatMap((segments, line) =>
      !kept.has(line) && lineKey(segments) !== "" && segments.some(isTimedSegment)
        ? [{ voice, segments, line, key: lineKey(segments) }]
        : [],
    );
  });
  const taken = new Set<(typeof lost)[number]>();
  const arrivals = new Map<VoiceId, Map<number, TimedSegment[]>>();
  for (const { voice, current, matches } of diffs) {
    const kept = new Set(matches.map(([, j]) => j));
    current.forEach((segments, j) => {
      const source = kept.has(j)
        ? undefined
        : lost.find(
            (candidate) =>
              !taken.has(candidate) &&
              candidate.voice !== voice &&
              candidate.key === lineKey(segments),
          );
      if (source) {
        taken.add(source);
        arrivals.set(voice, (arrivals.get(voice) ?? new Map()).set(j, source.segments));
      }
    });
  }
  if (taken.size === 0) {
    return storedByVoice;
  }

  const result = { ...storedByVoice };
  for (const { voice, stored, current, matches } of diffs) {
    const leaving = new Set([...taken].filter((s) => s.voice === voice).map(({ line }) => line));
    const incoming = arrivals.get(voice) ?? new Map<number, TimedSegment[]>();
    if (leaving.size === 0 && incoming.size === 0) {
      continue;
    }
    const matchedAt = new Map(matches.map(([i, j]) => [j, i]));
    const lines: TimedSegment[][] = [];
    const arrived = new Set<number>();
    let next = 0;
    const keepUpTo = (end: number) => {
      for (; next < end; next++) {
        if (!leaving.has(next)) {
          lines.push(stored[next]);
        }
      }
    };
    for (let j = 0; j < current.length; j++) {
      const i = matchedAt.get(j);
      if (i !== undefined) {
        keepUpTo(i + 1);
      } else if (incoming.has(j)) {
        arrived.add(lines.length);
        lines.push(incoming.get(j) as TimedSegment[]);
      }
    }
    keepUpTo(stored.length);
    result[voice] = joinLines(
      lines.map((line, k) => (arrived.has(k) ? flagIfOutOfOrder(lines, k) : line)),
    );
  }
  return result;
}

/**
 * The line at `index`, flagged for review if its starts don't fall between those of the lines
 * around it.
 */
function flagIfOutOfOrder(lines: TimedSegment[][], index: number): TimedSegment[] {
  const starts = (segments: TimedSegment[]) =>
    segments.flatMap(({ start }) => (start === undefined ? [] : [start]));
  const own = starts(lines[index]);
  const inOrder =
    Math.max(...lines.slice(0, index).flatMap(starts)) <= Math.min(...own) &&
    Math.max(...own) <= Math.min(...lines.slice(index + 1).flatMap(starts));
  return inOrder
    ? lines[index]
    : lines[index].map((segment) =>
        isTimedSegment(segment)
          ? { ...segment, review: strongerFlag(segment.review, "moved") }
          : segment,
      );
}

/**
 * The lines as one voice's segments.
 * A line that was last in another voice has no line break, so it gains one unless it is last here
 * too.
 */
function joinLines(lines: TimedSegment[][]): TimedSegment[] {
  return lines.flatMap((segments, k) => {
    const last = segments[segments.length - 1];
    if (k === lines.length - 1 || last.text.endsWith("\n")) {
      return segments;
    }
    return [...segments.slice(0, -1), { ...last, text: last.text + "\n" }];
  });
}

/**
 * The segments split into lines, each ending at a segment whose text ends in a line break.
 * What follows the last line break is a line of its own.
 */
function splitLines<T extends { text: string }>(segments: T[]): T[][] {
  const lines: T[][] = [];
  let line: T[] = [];
  for (const segment of segments) {
    line.push(segment);
    if (segment.text.endsWith("\n")) {
      lines.push(line);
      line = [];
    }
  }
  if (line.length > 0) {
    lines.push(line);
  }
  return lines;
}

/**
 * A line as drawn, without its line break, so that a line which only gained a split, or moved to
 * another screen, still matches.
 */
function lineKey(line: { text: string }[]): string {
  return line
    .map(({ text }) => displayText(text))
    .join("")
    .trim();
}

/**
 * The index pairs of a longest common subsequence of `a` and `b`, in order.
 * Where several exist, equal items are matched from the front.
 */
function commonSubsequence(a: string[], b: string[]): Array<[number, number]> {
  // The table is quadratic,
  // so the equal head and tail, which most edits leave long, stay out of it.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    head++;
  }
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const middleA = a.slice(head, a.length - tail);
  const middleB = b.slice(head, b.length - tail);

  const lengths = Array.from(
    { length: middleA.length + 1 },
    () => new Int32Array(middleB.length + 1),
  );
  for (let i = middleA.length - 1; i >= 0; i--) {
    for (let j = middleB.length - 1; j >= 0; j--) {
      lengths[i][j] =
        middleA[i] === middleB[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = Array.from({ length: head }, (_, k) => [k, k]);
  let i = 0;
  let j = 0;
  while (i < middleA.length && j < middleB.length) {
    if (middleA[i] === middleB[j]) {
      pairs.push([head + i, head + j]);
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  for (let k = tail; k > 0; k--) {
    pairs.push([a.length - k, b.length - k]);
  }
  return pairs;
}

/**
 * The lines the edit left unchanged are matched by their drawn text,
 * and each pair is diffed on its own.
 * Between two matches, as many lines on each side are diffed pair by pair,
 * and any other gap as one run.
 */
function reconcileLines(stored: TimedSegment[], current: Segment[]): Carried[] {
  const storedLines = splitLines(stored);
  const currentLines = splitLines(current);
  const result: Carried[] = [];
  let storedNext = 0;
  let currentNext = 0;
  const reconcileGap = (storedEnd: number, currentEnd: number) => {
    const storedGap = storedLines.slice(storedNext, storedEnd);
    const currentGap = currentLines.slice(currentNext, currentEnd);
    if (storedGap.length === currentGap.length) {
      storedGap.forEach((line, k) => result.push(...reconcileLine(line, currentGap[k])));
    } else {
      // These lines have no counterparts,
      // so a period stays on the segment that carried it,
      // and the normalising functions clear it if that segment no longer starts a line.
      result.push(...diffSegments(storedGap.flat(), currentGap.flat(), true));
    }
  };
  const matches = commonSubsequence(storedLines.map(lineKey), currentLines.map(lineKey));
  for (const [i, j] of matches) {
    reconcileGap(i, j);
    result.push(...reconcileLine(storedLines[i], currentLines[j]));
    storedNext = i + 1;
    currentNext = j + 1;
  }
  reconcileGap(storedLines.length, currentLines.length);
  return result;
}

/**
 * A pair of lines.
 * The old line's display and muted periods go to the new line's first segment,
 * whatever became of the old first segment.
 */
function reconcileLine(stored: TimedSegment[], current: Segment[]): Carried[] {
  const carried = diffSegments(stored, current, false).map(withoutLineBounds);
  if (carried.length > 0) {
    carried[0].segment = { ...carried[0].segment, ...lineBounds(stored[0]) };
  }
  return carried;
}

const LINE_BOUNDS = ["displayStart", "displayEnd", "muteStart", "muteEnd"] as const;

/**
 * The segment's stored line bounds, without those left automatic.
 */
function lineBounds(segment: TimedSegment): Partial<TimedSegment> {
  return Object.fromEntries(
    LINE_BOUNDS.filter((key) => segment[key] !== undefined).map((key) => [key, segment[key]]),
  );
}

function withoutLineBounds({ segment, raised }: Carried): Carried {
  const rest = { ...segment };
  LINE_BOUNDS.forEach((key) => delete rest[key]);
  return { segment: rest, raised };
}

/**
 * Align the words of a pair of lines, or of a gap,
 * and carry each run between the matches by its shape (see `replaceRun`).
 * Words are compared without case or punctuation, so that a change of either still anchors.
 *
 * In a gap whose line count changed,
 * a common word can match one on another line and keep a time far from where it is now sung.
 * So there, an alignment that matches fewer than half the words on its shorter side
 * is taken for a rewrite, and the whole gap is replaced instead.
 */
function diffSegments(stored: TimedSegment[], current: Segment[], isGap: boolean): Carried[] {
  const key = ({ text }: { text: string }) => spellingKey(segmentWord(text)).join("");
  let matches = commonSubsequence(stored.map(key), current.map(key));
  if (isGap && matches.length * 2 < Math.min(stored.length, current.length)) {
    matches = [];
  }
  const result: Carried[] = [];
  let storedNext = 0;
  let currentNext = 0;
  for (const [i, j] of [...matches, [stored.length, current.length]]) {
    result.push(...replaceRun(stored.slice(storedNext, i), current.slice(currentNext, j)));
    if (i < stored.length) {
      result.push({ segment: relabel(stored[i], current[j]) });
    }
    storedNext = i + 1;
    currentNext = j + 1;
  }
  return result;
}

/**
 * A run of stored segments that the edit replaced with lyric segments.
 * As many segments on each side are carried position by position.
 * Otherwise the run keeps its outer start and end,
 * since the new words are sung over the same stretch of the song as the old ones.
 * The new segments take the old run's flags, and a flag is only raised on a timing that existed.
 */
function replaceRun(stored: TimedSegment[], current: Segment[]): Carried[] {
  if (stored.length === 0 || current.length === 0) {
    return current.map((lyric) => ({ segment: fromLyric(lyric) }));
  }

  if (stored.length === current.length) {
    return current.map((lyric, i) => {
      const word = segmentWord(stored[i].text);
      // A textless segment holds a timing tapped before the lyrics existed,
      // so it had no word to move from.
      const moved =
        word !== "" && isTimedSegment(stored[i]) && !isSpellingFix(word, segmentWord(lyric.text));
      return raise(relabel(stored[i], lyric), moved ? "moved" : undefined);
    });
  }

  const inherited = stored.reduce<ReviewFlag | undefined>(
    (flag, { review }) => strongerFlag(flag, review),
    undefined,
  );
  const segments: TimedSegment[] = current.map((lyric) => ({
    ...fromLyric(lyric),
    ...(inherited && { review: inherited }),
  }));
  const { start } = stored[0];
  const { end } = stored[stored.length - 1];
  if (start !== undefined) {
    segments[0].start = start;
  }
  if (end !== undefined) {
    segments[segments.length - 1].end = end;
  }

  // Compared as drawn, not as stored:
  // a split inserts the very `/` or `_` being compared, so the raw texts always differ.
  // A split or join keeps the words, and only its divisions are unknown.
  const drawn = (list: { text: string }[]) => list.map(({ text }) => displayText(text)).join("");
  const rewritten = drawn(stored) !== drawn(current);
  const timingCount = (list: TimedSegment[]) =>
    list.filter(({ start }) => start !== undefined).length +
    list.filter(({ end }) => end !== undefined).length;
  const lost = timingCount(stored) > timingCount(segments);
  return segments.map((segment, i) => {
    if (i > 0 && i < segments.length - 1) {
      return raise(segment, lost ? "lost" : undefined);
    }
    return raise(segment, rewritten && isTimedSegment(segment) ? "moved" : undefined);
  });
}

/**
 * The segment with `flag` raised over the one it carries.
 */
function raise(segment: TimedSegment, flag?: ReviewFlag): Carried {
  const review = strongerFlag(segment.review, flag);
  if (review === segment.review) {
    return { segment };
  }
  return { segment: { ...segment, review }, raised: review };
}

/**
 * Widen each line's stored display period until it contains what the renderer draws for the line.
 * That runs from the line's first drawn start to its last drawn end,
 * where an open end, or one past the next start, stops at the next drawn start.
 * A line that draws nothing has no period, so its bounds are dropped.
 * Count-ins come from the settings, so they're left to the render.
 */
export function clampDisplayPeriods(segments: TimedSegment[]): {
  segments: TimedSegment[];
  widened: number;
} {
  return widenDisplayPeriods(segments, true);
}

/**
 * Keep the stored display periods valid after a timing write.
 * Bounds on a segment that no longer starts a line are cleared.
 * A period that a syllable has crossed is widened, and never narrowed back afterwards.
 * Unlike the load clamp, a line that draws nothing keeps its bounds, since it may be timed again.
 */
export function normalizeDisplayPeriods(segments: TimedSegment[]): TimedSegment[] {
  const cleared = segments.map((segment, i) => {
    const startsLine = i === 0 || segments[i - 1].text.endsWith("\n");
    if (startsLine || !hasDisplayPeriod(segment)) {
      return segment;
    }
    const { displayStart: _start, displayEnd: _end, ...rest } = segment;
    return rest;
  });
  return widenDisplayPeriods(cleared, false).segments;
}

export function hasDisplayPeriod(segment: TimedSegment): boolean {
  return segment.displayStart !== undefined || segment.displayEnd !== undefined;
}

function widenDisplayPeriods(
  segments: TimedSegment[],
  dropUndrawn: boolean,
): { segments: TimedSegment[]; widened: number } {
  const resolved = resolveStarts(segments);
  const drawnStart = (i: number) => (resolved[i].text === "" ? undefined : resolved[i].start);
  const result = segments.map((segment) => ({ ...segment }));
  let widened = 0;

  let first = 0;
  for (let i = 0; i < segments.length; i++) {
    if (!segments[i].text.endsWith("\n") && i < segments.length - 1) {
      continue;
    }
    const head = result[first];
    const drawn = range(first, i + 1).filter((j) => drawnStart(j) !== undefined);
    first = i + 1;
    if (!hasDisplayPeriod(head)) {
      continue;
    }
    if (drawn.length === 0) {
      if (dropUndrawn) {
        delete head.displayStart;
        delete head.displayEnd;
      }
      continue;
    }

    const startBound = drawnStart(drawn[0]) as number;
    const last = drawn[drawn.length - 1];
    const nextStart = range(last + 1, segments.length)
      .map(drawnStart)
      .find((start) => start !== undefined);
    const { end } = resolved[last];
    const endBound =
      end === undefined ? nextStart : nextStart === undefined ? end : Math.min(end, nextStart);

    let changed = false;
    if (head.displayStart !== undefined && head.displayStart > startBound) {
      head.displayStart = startBound;
      changed = true;
    }
    // The last line's open end runs to the song's end, which the segments don't know.
    if (head.displayEnd !== undefined && endBound !== undefined && head.displayEnd < endBound) {
      head.displayEnd = endBound;
      changed = true;
    }
    if (changed) {
      widened++;
    }
  }
  return { segments: result, widened };
}

export function hasMuteBounds(segment: TimedSegment): boolean {
  return segment.muteStart !== undefined || segment.muteEnd !== undefined;
}

/**
 * When each timed syllable is sung, keyed by its index, from segments with their starts resolved.
 * An open end runs to the next syllable's start, and the last one's to `songEnd`.
 */
export function sungSyllables(
  resolved: TimedSegment[],
  songEnd = Infinity,
): Map<number, { start: number; end: number }> {
  const spans = new Map<number, { start: number; end: number }>();
  let nextStart = songEnd;
  for (let i = resolved.length - 1; i >= 0; i--) {
    const { start, end } = resolved[i];
    if (start === undefined) {
      continue;
    }
    spans.set(i, { start, end: Math.max(start, end ?? nextStart) });
    nextStart = start;
  }
  return spans;
}

/**
 * How far a line's muted period may shrink and still cover the line's timed syllables, or
 * nothing when none is timed. The mute may start up to `GAP_MAX_LEAD` after the first syllable's
 * start, since a tap tends to come before the syllable is heard, but never after its end.
 */
export function muteLimits(
  sung: Map<number, { start: number; end: number }>,
  first: number,
  last: number,
): { latestStart: number; earliestEnd: number } | undefined {
  const spans = range(first, last + 1).flatMap((i) => sung.get(i) ?? []);
  if (spans.length === 0) {
    return undefined;
  }
  return {
    latestStart: Math.min(spans[0].start + GAP_MAX_LEAD, spans[0].end),
    earliestEnd: Math.max(...spans.map(({ end }) => end)),
  };
}

/**
 * Clamp each line's stored muted period so it covers the line's timed syllables (see
 * `muteLimits`). A line with no timed syllable has no muted period, so its bounds are dropped.
 */
export function clampMuteBounds(segments: TimedSegment[]): {
  segments: TimedSegment[];
  clamped: number;
} {
  return clampMutes(segments, true);
}

/**
 * Keep the stored muted periods valid after a timing write.
 * Bounds on a segment that no longer starts a line are cleared.
 * A bound that a syllable has crossed is pushed along, and never pulled back afterwards.
 * Unlike the load clamp, a line with no timed syllable keeps its bounds, since it may be timed
 * again.
 */
export function normalizeMuteBounds(segments: TimedSegment[]): TimedSegment[] {
  const cleared = segments.map((segment, i) => {
    const startsLine = i === 0 || segments[i - 1].text.endsWith("\n");
    if (startsLine || !hasMuteBounds(segment)) {
      return segment;
    }
    const { muteStart: _start, muteEnd: _end, ...rest } = segment;
    return rest;
  });
  return clampMutes(cleared, false).segments;
}

function clampMutes(
  segments: TimedSegment[],
  dropUntimed: boolean,
): { segments: TimedSegment[]; clamped: number } {
  const sung = sungSyllables(resolveStarts(segments));
  const result = segments.map((segment) => ({ ...segment }));
  let clamped = 0;

  let first = 0;
  for (let i = 0; i < segments.length; i++) {
    if (!segments[i].text.endsWith("\n") && i < segments.length - 1) {
      continue;
    }
    const head = result[first];
    const limits = muteLimits(sung, first, i);
    first = i + 1;
    if (!hasMuteBounds(head)) {
      continue;
    }
    if (!limits) {
      if (dropUntimed) {
        delete head.muteStart;
        delete head.muteEnd;
      }
      continue;
    }

    let changed = false;
    // The latest start is a sum, which can land a rounding error short of the same time read back
    // from a file.
    if (head.muteStart !== undefined && head.muteStart > limits.latestStart + 1e-9) {
      head.muteStart = limits.latestStart;
      changed = true;
    }
    // The voice's last syllable may run to the song's end, which the segments don't know.
    if (
      head.muteEnd !== undefined &&
      Number.isFinite(limits.earliestEnd) &&
      head.muteEnd < limits.earliestEnd
    ) {
      head.muteEnd = limits.earliestEnd;
      changed = true;
    }
    if (changed) {
      clamped++;
    }
  }
  return { segments: result, clamped };
}

// The versioned `timings.json` that older versions of the app wrote, which still loads.
export interface TimingsFile {
  version: number;
  voices: Record<string, TimedSegment[]>;
}

export function isTimingsFile(parsed: unknown): parsed is TimingsFile {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    typeof (parsed as TimingsFile).version === "number" &&
    typeof (parsed as TimingsFile).voices === "object"
  );
}
