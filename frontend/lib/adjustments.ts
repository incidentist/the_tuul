import {
  adjustScreenTimestamps,
  LyricSegment,
  LyricsScreen,
  LyricsLine,
  Timestamp,
  denormalizeTimestamps,
  KaraokeOptions,
} from "./timing";
import {
  TITLE_SCREEN_DURATION as TITLE_SCREEN_DURATION,
  SUBTITLE_CANVAS,
  GLYPH_BLOCK_RATIO,
} from "../constants";
import { concat, range } from "lodash-es";
import { sameHeight } from "./screenSlots";

const FIRST_SCREEN_QUICK_START_THRESHOLD: Timestamp = 1.0;
const SCREEN_QUICK_START_THRESHOLD: Timestamp = 2.0;

// One entry per mark, fading in towards the beat the singing starts on.
const COUNT_IN_MARK_ALPHAS = [0x80, 0x40, 0x00];
const COUNT_IN_MARKS_MAX = COUNT_IN_MARK_ALPHAS.length;
const COUNT_IN_MARK_SIZE_RATIO = 0.4;
// Script units, so the marks stay the same distance apart in any font at any size.
const COUNT_IN_MARK_GAP = 5;

function countInMark(fontSize: number, last: boolean): string {
  // A drawing rather than a glyph.
  // Inline with the lyrics there is a text baseline, so \pbo sits the mark on it.
  // Each mark starts its own path at 0: libass takes a run's advance from its bounding box,
  // so an offset path would overlap the text after it.
  // The gap is a bare move widening that box, so it stays in script units
  // rather than taking the width of a space in the current font.
  // A zero-length line would do the same, but libass draws the outline around it as a dot.
  const size = Math.round(fontSize * COUNT_IN_MARK_SIZE_RATIO);
  const square = `m 0 0 l ${size} 0 ${size} -${size} 0 -${size}`;
  const pad = size + COUNT_IN_MARK_GAP;
  // The last mark is followed by the lyrics, so an ordinary word space separates them.
  const gap = last ? "" : ` m ${pad} 0`;
  return `{\\p1\\pbo${size}}${square}${gap}{\\p0}${last ? " " : ""}`;
}

/**
 * Split count-in text into at most three marks that join back into it,
 * by word when it has spaces and by character otherwise.
 * Leftover words or characters go to the first marks.
 */
function countInTextMarks(text: string): string[] {
  const body = text.trim();
  if (!body) {
    return [];
  }
  const units = /\s/.test(body)
    ? body.split(/(?<=\s)(?=\S)/)
    : Array.from(new Intl.Segmenter().segment(body), ({ segment }) => segment);
  const markCount = Math.min(COUNT_IN_MARKS_MAX, units.length);
  const marks: string[] = [];
  for (let i = 0, start = 0; i < markCount; i++) {
    const size = Math.floor(units.length / markCount) + (i < units.length % markCount ? 1 : 0);
    marks.push(units.slice(start, start + size).join(""));
    start += size;
  }
  // The text's own leading and trailing spaces stay.
  // Without trailing ones, the last mark takes a half-width space,
  // so it doesn't run into the lyrics.
  marks[0] = text.slice(0, text.indexOf(body)) + marks[0];
  marks[markCount - 1] += text.slice(text.indexOf(body) + body.length) || "{\\fscx50} {\\fscx}";
  return marks;
}

function countInMarkTexts(options: KaraokeOptions): string[] {
  const marks = countInTextMarks(options.countInText);
  if (marks.length > 0) {
    return marks;
  }
  return Array.from({ length: COUNT_IN_MARKS_MAX }, (_, i) =>
    countInMark(options.font.size, i === COUNT_IN_MARKS_MAX - 1),
  );
}

/**
 * The last markCount marks, ending as the singing starts, faintest first.
 * A full count-in lasts countInThreshold, whatever the number of marks.
 * They are sliced from the front,
 * because slice(-markCount) returns every mark when markCount is 0.
 */
function countInMarks(
  options: KaraokeOptions,
  marks: string[],
  markCount: number,
  endTimestamp: Timestamp,
): LyricSegment[] {
  const step = options.countInThreshold / marks.length;
  const timestamp = endTimestamp - markCount * step;
  const alphas = COUNT_IN_MARK_ALPHAS.slice(COUNT_IN_MARKS_MAX - markCount);
  return marks.slice(marks.length - markCount).map((mark, i) => {
    const hex = alphas[i].toString(16).padStart(2, "0").toUpperCase();
    return new LyricSegment(
      `{\\alpha&H${hex}&}${mark}`,
      timestamp + i * step,
      timestamp + (i + 1) * step,
      true,
    );
  });
}

/**
 * A count-in showing the whole text. Its alpha tag changes nothing on screen,
 * but marks the syllable as a count-in for an ASS import, as the dynamic marks' own alpha tags do.
 */
function fixedCountIn(
  options: KaraokeOptions,
  timestamp: Timestamp,
  endTimestamp: Timestamp,
): LyricSegment {
  return new LyricSegment(`{\\alpha&H00&}${options.countInText}`, timestamp, endTimestamp, true);
}

// Dynamic count-ins spend a fixed time per mark,
// so they tick at the same rate whatever the gap and fit inside it.
// A gap too short for one mark gets one later, from addOverlappingCountIns.
// Fixed ones are all or nothing: the text can't be shortened without misleading the singer,
// so a gap too short for it gets none.
function countInSegments(
  options: KaraokeOptions,
  endTimestamp: Timestamp,
  gap: Timestamp,
): LyricSegment[] {
  if (!options.dynamicCountIns) {
    if (gap <= options.countInThreshold) {
      return [];
    }
    const timestamp = endTimestamp - options.countInDuration;
    return [fixedCountIn(options, timestamp, endTimestamp)];
  }
  const marks = countInMarkTexts(options);
  const step = options.countInThreshold / marks.length;
  const markCount = Math.min(marks.length, Math.floor(gap / step));
  return countInMarks(options, marks, markCount, endTimestamp);
}

function countInLength(options: KaraokeOptions): Timestamp {
  return options.dynamicCountIns ? options.countInThreshold : options.countInDuration;
}

/**
 * Move every timing later by `delay`, and record it on the first screen as audio delay.
 */
export function delaySong(screens: LyricsScreen[], delay: Timestamp): LyricsScreen[] {
  if (delay === 0 || screens.length === 0) {
    return screens;
  }
  const delayed = adjustScreenTimestamps(screens, delay);
  delayed[0].audioDelay += delay;
  return delayed;
}

/**
 * How far a quick-start count-in delays the song, given when each voice starts.
 * The earliest voice decides, since all of them play over the same audio.
 */
export function quickStartDelay(firstStarts: Timestamp[], options: KaraokeOptions): Timestamp {
  const first = Math.min(...firstStarts);
  if (options.countInMode === "none" || !(first <= FIRST_SCREEN_QUICK_START_THRESHOLD)) {
    return 0;
  }
  return countInLength(options) - first;
}

/**
 * Delay the song to make room for a count-in when the lyrics start right away.
 * Another voice may have set `addedTime`, in which case these lyrics move by it
 * and only get the count-in if they start right away too.
 */
export function addQuickStartCountIn(
  screens: LyricsScreen[],
  options: KaraokeOptions,
  addedTime?: Timestamp,
): LyricsScreen[] {
  const firstSegment = screens[0].lines[0].segments[0];
  addedTime ??= quickStartDelay([firstSegment.timestamp], options);
  const adjustedScreens = delaySong(screens, addedTime);
  // The first screen still displays from the start, which leaves the count-in its room.
  adjustedScreens[0].startTimestamp = screens[0].startTimestamp;
  if (firstSegment.timestamp > FIRST_SCREEN_QUICK_START_THRESHOLD) {
    return adjustedScreens;
  }
  // The song was moved to make room for a whole count-in, so this one is never cut short.
  const newFirstSegment = adjustedScreens[0].lines[0].segments[0];
  const marks = countInMarkTexts(options);
  adjustedScreens[0].lines[0].addSegmentsToFront(
    options.dynamicCountIns
      ? countInMarks(options, marks, marks.length, newFirstSegment.timestamp)
      : [fixedCountIn(options, 0.0, newFirstSegment.timestamp)],
  );

  return adjustedScreens;
}

export function addGapCountIns(screens: LyricsScreen[], options: KaraokeOptions): LyricsScreen[] {
  // Add a count-in to the start of a line if there's awhile before the singing starts.
  // Gaps are measured across screen boundaries too, so the previous end carries over.

  const everyLine = options.countInMode === "line";
  let prevEnd: Timestamp = 0.0;
  for (const screen of screens) {
    for (const [index, line] of screen.lines.entries()) {
      if (line.segments.length === 0) {
        continue;
      }
      if (everyLine || index === 0) {
        line.addSegmentsToFront(countInSegments(options, line.timestamp, line.timestamp - prevEnd));
      }
      prevEnd = line.endTimestamp;
    }
  }
  return screens;
}

/**
 * Whether addOverlappingCountIns may give the line, at this index on its lyrics screen, a mark.
 */
export function mayGetOverlappingCountIn(
  line: LyricsLine,
  index: number,
  options: KaraokeOptions,
): boolean {
  return (
    options.countInMode !== "none" &&
    options.dynamicCountIns &&
    (options.countInMode === "line" || index === 0) &&
    line.segments.length > 0 &&
    !line.segments[0].countIn
  );
}

/**
 * The text of the mark addOverlappingCountIns gives a line.
 */
export function overlappingCountInText(options: KaraokeOptions): string {
  const marks = countInMarkTexts(options);
  return countInMarks(options, marks, 1, 0)[0].text;
}

/**
 * Give each line that addGapCountIns left without a count-in its last mark anyway,
 * sweeping while the previous line is still being sung, but not before that line's singing starts.
 * A mark is only added when the line is already shown by the time it starts,
 * so this runs once the staggered-lines pass has set the display starts.
 * A stored display start counts too, though it is only applied later.
 */
export function addOverlappingCountIns(
  screens: LyricsScreen[],
  options: KaraokeOptions,
): LyricsScreen[] {
  if (options.countInMode === "none" || !options.dynamicCountIns) {
    return screens;
  }
  const marks = countInMarkTexts(options);
  let prevSingStart: Timestamp = 0.0;
  for (const screen of screens.filter(({ kind }) => kind === "lyrics")) {
    for (const [index, line] of screen.lines.entries()) {
      if (line.segments.length === 0) {
        continue;
      }
      if (mayGetOverlappingCountIn(line, index, options)) {
        const mark = countInMarks(options, marks, 1, line.timestamp);
        const start = mark[0].timestamp;
        if (start >= prevSingStart && start >= countInEarliestStart(line, screen, options)) {
          line.addSegmentsToFront(mark);
        }
      }
      prevSingStart = line.singTimestamp;
    }
  }
  return screens;
}

const MAX_EARLY_DISPLAY: Timestamp = 5.0;
const DEFERRED_LEAD_IN: Timestamp = 1.0;

export function deferScreenStarts(
  screens: LyricsScreen[],
  maxEarly: number = MAX_EARLY_DISPLAY,
  leadIn: number = DEFERRED_LEAD_IN,
): LyricsScreen[] {
  // Cap how early a screen is displayed. A screen normally displays from the previous
  // screen's end (which can be the very start of the song), so a voice whose first line
  // is deep into the song would otherwise show its text from 0:00. When a screen would
  // appear more than `maxEarly` seconds before its first line animates, pull its display
  // start to `leadIn` seconds before that line. Used for non-primary voices, which have
  // no title/instrumental screens to fill the gap. The (per-voice) count-in still applies.
  for (const screen of screens) {
    if (screen.lines.length === 0) {
      continue;
    }
    const firstAnimation = screen.lines[0].timestamp;
    const start = screen.startTimestamp ?? 0;
    if (start < firstAnimation - maxEarly) {
      screen.startTimestamp = Math.max(0, firstAnimation - leadIn);
    }
  }
  return screens;
}

function getIntroLength(screens: LyricsScreen[]): number {
  // Get the length of the song intro
  return screens[0].lines[0].timestamp;
}

export function trimStart(screens: LyricsScreen[], adjustment: number): LyricsScreen[] {
  // Trim [adjustment] seconds from the start of the first screen, keeping other timestamps the same.
  let otherScreens = screens.slice(1);
  const trimmedScreen = screens[0].trimDisplayStart(adjustment);
  return concat([trimmedScreen], otherScreens);
}

const INSTRUMENTAL_BAR_WIDTH_FRACTION = 0.6;
const INSTRUMENTAL_BAR_HEIGHT_RATIO = 0.7;

function instrumentalBar(fontSize: number): string {
  // A drawing, not text: the sweep fills it smoothly and its width doesn't depend on the font.
  // Drawing coordinates are script units and ignore Fontsize, so we size it ourselves.
  // Alone on its line, libass places the bar from its top edge,
  // so the offset drops it into the block a line of text would cover.
  // Leaving \p1 unclosed swallows the rest of the line.
  const width = Math.round(SUBTITLE_CANVAS.width * INSTRUMENTAL_BAR_WIDTH_FRACTION);
  const height = Math.round(fontSize * INSTRUMENTAL_BAR_HEIGHT_RATIO);
  const top = Math.round((fontSize * GLYPH_BLOCK_RATIO - height) / 2);
  const bottom = top + height;
  return `{\\p1}m 0 ${top} l ${width} ${top} ${width} ${bottom} 0 ${bottom}{\\p0}`;
}

function createInstrumentalScreen(
  startTime: Timestamp,
  duration: number,
  fontSize: number,
): LyricsScreen {
  // Create an INSTRUMENTAL screen lasting [duration] seconds
  const line = new LyricsLine([
    new LyricSegment(instrumentalBar(fontSize), startTime, startTime + duration),
  ]);
  const screen = new LyricsScreen([line]);
  screen.kind = "instrumental";
  screen.startTimestamp = startTime;
  return screen;
}

/**
 * Add an instrumental screen from `start` until the first lyrics, when they start at least the
 * threshold later.
 */
export function addIntroInstrumentalScreen(
  screens: LyricsScreen[],
  options: KaraokeOptions,
  start: Timestamp,
): LyricsScreen[] {
  const [first] = screens;
  if (first?.kind !== "lyrics") {
    return screens;
  }
  const end = first.segments[0].timestamp;
  if (end - start < options.instrumentalThreshold) {
    return screens;
  }
  return [
    createInstrumentalScreen(start, end - start, options.font.size),
    ...trimStart(screens, end - (first.startTimestamp ?? 0)),
  ];
}

export function addInstrumentalScreens(
  screens: LyricsScreen[],
  options: KaraokeOptions,
): LyricsScreen[] {
  // Add instrumental countdown screens between screens with a long gap
  if (screens.length < 2) {
    return screens;
  }
  // We need to use actual segment times, not calculated screen start/end times
  const currentScreen = screens[1];
  const prevScreenEnd = screens[0].endTimestamp;
  const screenStart = currentScreen.segments[0].timestamp;
  const screenGap = screenStart - prevScreenEnd;
  if (screenGap < options.instrumentalThreshold) {
    return [screens[0]].concat(addInstrumentalScreens(screens.slice(1), options));
  } else {
    const instrumentalScreen = createInstrumentalScreen(
      screens[0].endTimestamp,
      screenGap,
      options.font.size,
    );
    const adjustedScreens = trimStart(screens.slice(1), screenGap);
    return [screens[0], instrumentalScreen].concat(
      addInstrumentalScreens(adjustedScreens, options),
    );
  }
}

/**
 * How far the title screen delays the song: not at all when the intro is long enough to show it,
 * and its whole length otherwise.
 */
export function titleScreenDelay(
  introLength: Timestamp,
  duration: Timestamp = TITLE_SCREEN_DURATION,
): Timestamp {
  return introLength > duration ? 0 : duration;
}

/**
 * Keep the lyrics off the title screen, by starting them after it or by delaying the song.
 */
export function makeRoomForTitleScreen(
  screens: LyricsScreen[],
  introLength: Timestamp = getIntroLength(screens),
  duration: Timestamp = TITLE_SCREEN_DURATION,
): LyricsScreen[] {
  const audioDelay = titleScreenDelay(introLength, duration);
  return audioDelay === 0 ? trimStart(screens, duration) : delaySong(screens, audioDelay);
}

/**
 * Show the title and artist before the lyrics.
 * With several voices, `introLength` is the time before any of them starts.
 */
export function addTitleScreen(
  screens: LyricsScreen[],
  title: string,
  artist: string,
  introLength: Timestamp = getIntroLength(screens),
  duration: Timestamp = TITLE_SCREEN_DURATION,
): LyricsScreen[] {
  const audioDelay = titleScreenDelay(introLength, duration);
  const adjustedLyricScreens =
    audioDelay === 0 ? trimStart(screens, duration) : adjustScreenTimestamps(screens, audioDelay);
  const titleScreen = new LyricsScreen(
    [
      new LyricsLine([new LyricSegment(title, 0.0, duration / 2)]),
      new LyricsLine([new LyricSegment(artist, duration / 2, duration)]),
    ],
    audioDelay,
  );
  const denormalizedScreen = denormalizeTimestamps([titleScreen], duration)[0];
  denormalizedScreen.kind = "title";
  const screensWithTitle = adjustedLyricScreens.slice();
  screensWithTitle.unshift(denormalizedScreen);
  return screensWithTitle;
}

export function displayQuickLinesEarly(
  screens: LyricsScreen[],
  displayOptions: KaraokeOptions,
): LyricsScreen[] {
  // If the lyrics on the next screen start right away, display the first few lines early
  // Skip the title screen and the last screen.
  for (let i = 1; i < screens.length - 1; i++) {
    const screen = screens[i];
    const nextScreen = screens[i + 1];
    if (nextScreen.singStart - screen.singEnd > SCREEN_QUICK_START_THRESHOLD) {
      continue;
    }
    // The lines that start in the first two slots leave early,
    // or fewer, so that a line stays below them.
    // The next screen's lines whose rows all lie in the slots they leave take their place.
    const leaving = range(screen.lines.length - 1).filter(
      (j) => screen.slotOf(j) < Math.min(2, screen.slotOf(screen.lines.length - 1)),
    );
    if (leaving.length === 0) {
      continue;
    }
    const leavingSlots = screen.endSlotOf(leaving[leaving.length - 1]);
    const earlyDisplayLines = nextScreen.lines.filter(
      (_, j) => nextScreen.endSlotOf(j) <= leavingSlots,
    );
    if (earlyDisplayLines.length === 0) {
      continue;
    }
    const lineAfterEarlyRemovals = screen.lines[leaving.length];
    // Remove the leaving lines when the line after them is halfway done singing
    const singStart = lineAfterEarlyRemovals.singTimestamp;
    const singDuration = lineAfterEarlyRemovals.endTimestamp - singStart;
    const earlyRemovalTime = singStart + singDuration * 0.5;
    const earlyDisplayTime = singStart + singDuration * 0.75;
    leaving.forEach((j) => {
      screen.lines[j].customDisplayEndTime = earlyRemovalTime;
    });

    // TODO what if nextScreen.length == 2 and screen.length == 3?
    nextScreen.earlySlots = leavingSlots;
    placeStaggeredScreen(screens, i + 1, displayOptions);

    earlyDisplayLines.forEach((line) => {
      line.customDisplayStartTime = earlyDisplayTime;
    });
  }
  return screens;
}

/**
 * Lay a staggered screen out as if it had the previous screen's slot count
 * when its own would put its first slot below the previous screen's first slot.
 * That puts its early lines in the slots the previous screen's first lines leave.
 * If the previous screen is laid out that way too, its lines that stay until it ends may return to
 * its own layout, so that this screen keeps its own.
 * Otherwise every screen after a taller one would keep the taller one's layout.
 */
function placeStaggeredScreen(screens: LyricsScreen[], i: number, options: KaraokeOptions): void {
  const previous = screens[i - 1];
  const screen = screens[i];
  const { size } = options.font;
  const alignment = options.verticalAlignment;
  screen.positionAsSlotCount = undefined;
  if (
    previous.getLineY(0, size, alignment, options) >= screen.getLineY(0, size, alignment, options)
  ) {
    return;
  }
  if (
    previous.positionAsSlotCount !== undefined &&
    settleStayingLines(screens[i - 2], previous, screen, options)
  ) {
    return;
  }
  screen.positionAsSlotCount = previous.positionAsSlotCount ?? previous.slots;
}

/**
 * Settle the lines of `screen` that stay until it ends, unless they would meet the next screen's
 * early lines in the next screen's own layout.
 * A settled line that would meet a line the screen before keeps until it ends is no longer shown
 * early, and the line it replaces in that screen stays until then too.
 */
function settleStayingLines(
  before: LyricsScreen,
  screen: LyricsScreen,
  next: LyricsScreen,
  options: KaraokeOptions,
): boolean {
  const { size } = options.font;
  const alignment = options.verticalAlignment;
  const placed = (s: LyricsScreen, chosen: (i: number) => boolean) =>
    s.lines
      .map((line, i) => ({ line, i, ...s.getLineBounds(i, size, alignment, options) }))
      .filter(({ i }) => chosen(i));
  const settledBefore = screen.settledFromSlot;
  screen.settledFromSlot = next.earlySlots;
  const staying = placed(screen, (i) => screen.slotOf(i) >= next.earlySlots);
  const early = placed(next, (i) => next.showsEarly(i));
  if (early.some((line) => staying.some((other) => sameHeight(line, other)))) {
    screen.settledFromSlot = settledBefore;
    return false;
  }
  const keptByBefore = placed(before, (i) => !before.leavesEarlyFor(i, screen));
  for (const settled of staying) {
    if (screen.showsEarly(settled.i) && keptByBefore.some((other) => sameHeight(settled, other))) {
      showAtScreenStart(settled.line, screen, options);
      placed(before, (i) => before.leavesEarlyFor(i, screen))
        .filter((line) => sameHeight(line, settled))
        .forEach(({ line }) => (line.customDisplayEndTime = undefined));
    }
  }
  return true;
}

/**
 * Show a staggered screen's early line when the screen starts.
 */
function showAtScreenStart(line: LyricsLine, screen: LyricsScreen, options: KaraokeOptions): void {
  line.customDisplayStartTime = undefined;
  // An overlapping count-in may only have fit because the line was shown early.
  if (line.timestamp < countInEarliestStart(line, screen, options)) {
    line.segments = line.segments.filter((segment) => !segment.countIn);
  }
}

/**
 * Show a staggered screen's early lines at the usual time again,
 * and keep the previous screen's lines in those slots until then.
 */
export function unstagger(
  previous: LyricsScreen,
  screen: LyricsScreen,
  options: KaraokeOptions,
): void {
  previous.lines
    .filter((_, i) => previous.leavesEarlyFor(i, screen))
    .forEach((line) => (line.customDisplayEndTime = undefined));
  screen.lines
    .filter((_, i) => screen.showsEarly(i))
    .forEach((line) => showAtScreenStart(line, screen, options));
  previous.settledFromSlot = undefined;
  screen.earlySlots = 0;
  screen.positionAsSlotCount = undefined;
}

/**
 * Place every staggered screen again, once voice lanes have moved the blocks.
 * A screen in a lane is centred in it whatever the alignment, so the first placement no longer holds.
 * A screen settled by the first placement stays settled, which fits any placement of the next one.
 */
export function placeStaggeredScreens(screens: LyricsScreen[], options: KaraokeOptions): void {
  for (const [i, screen] of screens.entries()) {
    if (i > 0 && screen.staggered) {
      placeStaggeredScreen(screens, i, options);
    }
  }
}

/**
 * A line's stored display period replaces the automatic one, widened to contain what the line draws,
 * count-in included.
 * This runs last, so it sees every count-in and replaces what the staggered-lines pass set.
 */
export function applyStoredDisplayPeriods(screens: LyricsScreen[]): LyricsScreen[] {
  for (const line of screens.flatMap((screen) => screen.lines)) {
    if (line.storedDisplayStart !== undefined) {
      line.customDisplayStartTime = Math.min(line.storedDisplayStart, line.timestamp);
    }
    if (line.storedDisplayEnd !== undefined) {
      line.customDisplayEndTime = Math.max(line.storedDisplayEnd, line.endTimestamp);
    }
  }
  return screens;
}

export function displayStartOf(line: LyricsLine, screen: LyricsScreen): Timestamp {
  return line.customDisplayStartTime ?? screen.startTimestamp ?? 0;
}

/**
 * The earliest time a count-in can start without showing its line earlier.
 * A stored display start replaces the automatic one, so it is used strictly:
 * a count-in before it would pull it earlier.
 */
function countInEarliestStart(
  line: LyricsLine,
  screen: LyricsScreen,
  options: KaraokeOptions,
): Timestamp {
  return options.useStoredDisplayPeriods && line.storedDisplayStart !== undefined
    ? line.storedDisplayStart
    : displayStartOf(line, screen);
}

export function displayEndOf(line: LyricsLine, screen: LyricsScreen): Timestamp {
  return line.customDisplayEndTime ?? screen.endTimestamp;
}

/**
 * The earliest time a stored display period shows a line, which the title screen gives way to.
 */
export function earliestStoredStart(screens: LyricsScreen[]): Timestamp | undefined {
  const starts = screens.flatMap((screen) =>
    screen.lines
      .filter((line) => line.storedDisplayStart !== undefined)
      .map((line) => displayStartOf(line, screen)),
  );
  return starts.length > 0 ? Math.min(...starts) : undefined;
}

/**
 * The title screen ends when a stored display period first shows a line.
 * The user asked for the line to be there, and the title is filler.
 */
export function endTitleScreenBy(screens: LyricsScreen[], time: Timestamp | undefined): void {
  const title = screens.find((screen) => screen.kind === "title");
  if (!title || time === undefined) {
    return;
  }
  const start = title.startTimestamp ?? 0;
  // The screen stays even when it loses every line, since it can carry the audio delay.
  title.lines = title.lines.filter((line) => {
    line.customDisplayEndTime = Math.min(displayEndOf(line, title), time);
    return line.customDisplayEndTime > start;
  });
}

/**
 * An instrumental screen only covers the time when no line of its voice is displayed,
 * so stored display periods that reach into the break shorten it, or remove it.
 */
export function fitInstrumentalScreens(screens: LyricsScreen[]): LyricsScreen[] {
  return screens.filter((screen, i) => {
    if (screen.kind !== "instrumental") {
      return true;
    }
    const lyrics = (range: LyricsScreen[]) => range.filter((s) => s.kind === "lyrics");
    const endsBefore = lyrics(screens.slice(0, i)).flatMap((s) =>
      s.lines.map((line) => displayEndOf(line, s)),
    );
    const startsAfter = lyrics(screens.slice(i + 1)).flatMap((s) =>
      s.lines.map((line) => displayStartOf(line, s)),
    );
    const start = Math.max(screen.startTimestamp ?? 0, ...endsBefore);
    const end = Math.min(screen.endTimestamp, ...startsAfter);
    if (end <= start) {
      return false;
    }
    const [bar] = screen.lines[0].segments;
    bar.timestamp = start;
    bar.endTimestamp = end;
    screen.startTimestamp = start;
    return true;
  });
}
