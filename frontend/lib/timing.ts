import {
  LYRIC_MARKERS,
  SUBTITLE_CANVAS,
  GLYPH_BLOCK_RATIO,
  DEFAULT_COUNT_IN_MODE,
  DEFAULT_COUNT_IN_TEXT,
  DEFAULT_COUNT_IN_THRESHOLD,
  DEFAULT_COUNT_IN_DURATION,
  DEFAULT_DYNAMIC_COUNT_INS,
  DEFAULT_INSTRUMENTAL_THRESHOLD,
  DEFAULT_LINE_SPACING,
  DEFAULT_TOP_MARGIN,
  DEFAULT_OUTLINE_WIDTH,
  TITLE_SCREEN_DURATION,
  appName,
} from "@/constants";
import {
  addQuickStartCountIn,
  addGapCountIns,
  addOverlappingCountIns,
  addTitleScreen,
  addInstrumentalScreens,
  addIntroInstrumentalScreen,
  applyStoredDisplayPeriods,
  displayQuickLinesEarly,
  deferScreenStarts,
  delaySong,
  earliestStoredStart,
  endTitleScreenBy,
  fitInstrumentalScreens,
  makeRoomForTitleScreen,
  placeStaggeredScreens,
  quickStartDelay,
  titleScreenDelay,
  unstagger,
} from "./adjustments";
import {
  fadeInstrumentalScreens,
  fadeLines,
  giveWayToStoredPeriods,
  songOffset,
} from "./screenSlots";
import { withFallbackFonts } from "./fonts";
import { FontLibrary } from "./textWidth";
import {
  applyVoiceStyle,
  defaultEffectColor,
  outlineDrawn,
  shadowDrawn,
  VoiceStyleOverride,
} from "./voiceStyle";
import { map, method, isNumber } from "lodash-es";
import { default as BuefyColor } from "buefy/src/utils/color";
// This import must stay type-only,
// because timedSegments imports parseLyrics from here at runtime.
import type { TimedSegment } from "./timedSegments";

// "mkv" also carries the vocals and the original mix as extra audio tracks.
export const OUTPUT_FORMATS = ["mp4", "mkv"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

// Every size is 16:9, so libass scales the subtitle canvas evenly.
export const RESOLUTIONS = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
} as const;
export type Resolution = keyof typeof RESOLUTIONS;

export const FRAME_RATES = [20, 30] as const;
export type FrameRate = (typeof FRAME_RATES)[number];

export const RENDER_QUALITIES = ["standard", "high"] as const;
export type RenderQuality = (typeof RENDER_QUALITIES)[number];

// Fill covers the frame and crops what overflows. Fit shows the whole background, with bars in the
// background color.
export const BACKGROUND_FITS = ["fill", "fit"] as const;
export type BackgroundFit = (typeof BACKGROUND_FITS)[number];

export const DEFAULT_RESOLUTION: Resolution = "720p";
export const DEFAULT_FRAME_RATE: FrameRate = 30;
export const DEFAULT_RENDER_QUALITY: RenderQuality = "standard";

// Which gaps get a count-in: none at all, only the gap before a screen's first line, or
// the gap before any line.
export const COUNT_IN_MODES = ["none", "screen", "line"] as const;
export type CountInMode = (typeof COUNT_IN_MODES)[number];

export interface KaraokeOptions {
  addTitleScreen: boolean;
  // In seconds, from the start of the video.
  titleScreenDuration?: number;
  // When this is off, the title screen stays blank, for a background that shows its own title.
  showTitle?: boolean;
  // The fields left out take the lyrics' own.
  titleStyle?: VoiceStyleOverride;
  countInMode: CountInMode;
  // Dynamic count-ins draw blocks when this is blank.
  countInText: string;
  // Split countInText into marks, fewer for a shorter gap,
  // instead of showing it whole for countInDuration.
  // Also changes countInThreshold from the gap a line needs to earn a count-in
  // into the gap that earns a full one.
  dynamicCountIns: boolean;
  countInThreshold: number;
  countInDuration: number;
  // The shortest gap between screens, in seconds, that gets an instrumental screen. Zero turns them off.
  instrumentalThreshold: number;
  addStaggeredLines: boolean;
  // When this is off, every line follows the automatic rules, but the stored periods are kept.
  useStoredDisplayPeriods: boolean;
  useBackground: boolean;
  backgroundFit: BackgroundFit;
  outputFormat: OutputFormat;
  resolution: Resolution;
  frameRate: FrameRate;
  quality: RenderQuality;
  verticalAlignment: VerticalAlignment;
  // From one line's top to the next, as a multiple of the font size.
  lineSpacing: number;
  // Above the first line when the lyrics are aligned to the top, as a multiple of the font size.
  topMargin: number;
  outlineWidth: number;
  // Negative offsets cast the shadow left or up.
  shadowX: number;
  shadowY: number;
  font: {
    size: number;
    name: string;
    bold?: boolean;
    italic?: boolean;
  };
  color: {
    background: BuefyColor;
    primary: BuefyColor;
    secondary: BuefyColor;
    // Null while the outline has no width.
    outline: BuefyColor | null;
    // Null while both shadow offsets are zero.
    shadow: BuefyColor | null;
  };
}

export enum VerticalAlignment {
  Top,
  Middle,
  Bottom,
}

export const DEFAULT_KARAOKE_OPTIONS: KaraokeOptions = {
  addTitleScreen: true,
  titleScreenDuration: TITLE_SCREEN_DURATION,
  showTitle: true,
  titleStyle: {},
  countInMode: DEFAULT_COUNT_IN_MODE,
  countInText: DEFAULT_COUNT_IN_TEXT,
  dynamicCountIns: DEFAULT_DYNAMIC_COUNT_INS,
  countInThreshold: DEFAULT_COUNT_IN_THRESHOLD,
  countInDuration: DEFAULT_COUNT_IN_DURATION,
  instrumentalThreshold: DEFAULT_INSTRUMENTAL_THRESHOLD,
  addStaggeredLines: true,
  useStoredDisplayPeriods: true,
  useBackground: false,
  backgroundFit: "fill",
  outputFormat: "mp4",
  resolution: DEFAULT_RESOLUTION,
  frameRate: DEFAULT_FRAME_RATE,
  quality: DEFAULT_RENDER_QUALITY,
  verticalAlignment: VerticalAlignment.Middle,
  lineSpacing: DEFAULT_LINE_SPACING,
  topMargin: DEFAULT_TOP_MARGIN,
  outlineWidth: DEFAULT_OUTLINE_WIDTH,
  shadowX: 0,
  shadowY: 0,
  font: {
    size: 20,
    name: "Arial Narrow",
  },
  color: {
    background: BuefyColor.parse("black"),
    primary: BuefyColor.parse("#FF00FF"),
    secondary: BuefyColor.parse("#00FFFF"),
    outline: BuefyColor.parse("black"),
    shadow: null,
  },
};

export interface Segment {
  text: string;
  // Blank spacer lines above the line, which hold a slot on the page but draw nothing.
  // Only read on a line's first segment.
  spacersBefore?: number;
  // Spacers below the line. Only read on the first segment of a page's last line.
  spacersAfter?: number;
}

interface AssEvent {
  type: string;
  Layer: number;
  Start: string;
  End: string;
  Style: string;
  Name: string;
  MarginL: number;
  MarginR: number;
  MarginV: number;
  Effect: string;
  Text: string;
}

//
// ASS Formatting helpers
//

type Color = [number, number, number, number]; // RGBA?
type Seconds = number;

function toHex(n: number) {
  return n.toString(16).toUpperCase().padStart(2, "0");
}

function colorToString(color: Color): string {
  // ASS color format is AABBGGRR for some reason, and alpha 0 is opaque
  return "&H" + color.map(toHex).reverse().join("");
}

/**
 * Seconds to whole centiseconds, the precision of ASS.
 * Durations subtract two of these rather than flooring the difference,
 * where float error turns 2.12 s into 211.99999 cs and loses one.
 */
function toCentiseconds(seconds: number): number {
  return Math.round(seconds * 100);
}

export function floatToTimecode(t: number): string {
  // Format t (seconds) as HH:MM:SS.cc. Every field is derived from one rounded centisecond count:
  // rounding the fraction on its own drops the carry at .995 and up, which silently shifts the
  // timecode a second earlier.
  const totalCentiseconds = Math.round(t * 100);
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = (totalCentiseconds - centiseconds) / 100;
  const timecodeParts = [
    Math.floor(totalSeconds / 3600).toString(),
    Math.floor((totalSeconds / 60) % 60)
      .toString()
      .padStart(2, "0"),
    [
      (totalSeconds % 60).toString().padStart(2, "0"),
      centiseconds.toString().padStart(2, "0"),
    ].join("."),
  ];
  return timecodeParts.join(":");
}

//
// Lyric classes
//

// A segment's text, then the run of separators that ends it.
const SEGMENT_PATTERN = /([^\n/_]*)([\n/_]*)/g;

/**
 * Parse marked up lyrics into segments.
 * Line breaks separate segments, and blank lines separate screens.
 * Underscores separate segments on word boundaries within a line.
 * Sla/shes separate segments within a word.
 *
 * A run of separators counts as its strongest one,
 * and a segment of whitespace joins the run around it.
 * So `foo_\n` ends a line rather than drawing the underscore,
 * and several blank lines are a single screen break.
 * Whitespace at the end of a segment is a word break,
 * and the last segment has no separator.
 *
 * A line holding only `/` is a blank spacer line, counted on the line below it,
 * or on the line above it at the bottom of a page.
 */
export function parseLyrics(lyricsText: string, includeMarkup: boolean = false): Segment[] {
  const segments: { text: string; separators: string }[] = [];
  let leading = "";
  for (const [, body, separators] of lyricsText.matchAll(SEGMENT_PATTERN)) {
    const text = body.trim();
    const run = /\s$/.test(body) ? "_" + separators : separators;
    if (text !== "") {
      segments.push({ text, separators: run });
    } else if (segments.length > 0) {
      segments[segments.length - 1].separators += run;
    } else {
      leading += run;
    }
  }
  const parsed: Segment[] = segments.map(({ text, separators }, i) => ({
    text: i === segments.length - 1 ? text : text + strongestSeparator(separators, includeMarkup),
  }));
  countSpacers(
    parsed,
    leading,
    segments.map(({ separators }) => separators),
  );
  return parsed;
}

/**
 * The lyric text that `parseLyrics` reads back into these segments, spacers included.
 */
export function joinLyrics(segments: Segment[]): string {
  let text = "";
  let head: Segment | undefined;
  segments.forEach((segment, i) => {
    head ??= segment;
    if (segment === head) {
      text += "/\n".repeat(segment.spacersBefore ?? 0);
    }
    const after = "/\n".repeat(head.spacersAfter ?? 0);
    if (segment.text.endsWith("\n\n")) {
      text += segment.text.slice(0, -1) + after + "\n";
    } else if (i === segments.length - 1 && after !== "") {
      text += segment.text + "\n" + after.slice(0, -1);
    } else {
      text += segment.text;
    }
    if (segment.text.endsWith("\n")) {
      head = undefined;
    }
  });
  return text;
}

/**
 * The lines of a separator run that sit between two of its line breaks, so hold only markup.
 */
function wholeLines(run: string): string[] {
  return run.split("\n").slice(1, -1);
}

const isSpacer = (line: string) => line.includes("/");

/**
 * Split the whole lines between two lyric lines at the page break, if there is one.
 * Spacers before the first blank line end the page above,
 * and spacers after the last one start the page below.
 * Spacers between two blank lines are on a page with no line, so they count for neither.
 */
function splitSpacers(lines: string[]): { closing: number; opening: number } {
  const blanks = lines.flatMap((line, i) => (isSpacer(line) ? [] : [i]));
  if (blanks.length === 0) {
    return { closing: 0, opening: lines.length };
  }
  return { closing: blanks[0], opening: lines.length - 1 - blanks[blanks.length - 1] };
}

/**
 * Set each line's spacer counts on its first segment, from the separator runs around it.
 */
function countSpacers(segments: Segment[], leading: string, separators: string[]): void {
  if (segments.length === 0) {
    return;
  }
  const set = (i: number, key: "spacersBefore" | "spacersAfter", count: number) => {
    if (count > 0) {
      segments[i][key] = count;
    }
  };
  // The start and the end of the lyrics count as page breaks.
  set(0, "spacersBefore", splitSpacers(wholeLines("\n\n" + leading)).opening);
  let head = 0;
  for (let i = 0; i < segments.length - 1; i++) {
    if (!separators[i].includes("\n")) {
      continue;
    }
    const { closing, opening } = splitSpacers(wholeLines(separators[i]));
    set(head, "spacersAfter", closing);
    set(i + 1, "spacersBefore", opening);
    head = i + 1;
  }
  const last = separators[separators.length - 1];
  set(head, "spacersAfter", splitSpacers(wholeLines(last + "\n\n")).closing);
}

function strongestSeparator(separators: string, includeMarkup: boolean): string {
  if (wholeLines(separators).some((line) => !isSpacer(line))) {
    return "\n\n";
  }
  if (separators.includes("\n")) {
    return "\n";
  }
  if (separators.includes("_")) {
    return includeMarkup ? "_" : " ";
  }
  if (separators.includes("/")) {
    return includeMarkup ? "/" : "";
  }
  return "";
}

/**
 * The drawn form of a segment's stored text.
 * A trailing `_` is the space between two words.
 * A trailing `/` is an invisible split inside one.
 * Newlines stay: the renderer groups lines on them.
 */
export function displayText(text: string): string {
  if (text.endsWith("_")) {
    return text.slice(0, -1) + " ";
  }
  if (text.endsWith("/")) {
    return text.slice(0, -1);
  }
  return text;
}

function width(segment: TimedSegment): number {
  return Math.max(displayText(segment.text).trim().length, 1);
}

/**
 * Give every hole a start, so a freshly split word doesn't vanish while its syllables are untimed.
 *
 * Only a hole timed on BOTH sides is filled. An untimed head or tail is work not done yet,
 * and filling it would spread an untimed second half of a song across the rest of the track.
 * An end that comes before its segment's start is dropped, so the segment runs to the next start.
 *
 * This runs on the render path only.
 * Nothing is written back, so a hole stays a hole in Adjust and Edit.
 */
export function resolveStarts(segments: TimedSegment[]): TimedSegment[] {
  const resolved = segments.map((segment) => ({ ...segment }));

  let i = 0;
  while (i < resolved.length) {
    if (resolved[i].start !== undefined) {
      i++;
      continue;
    }

    let end = i;
    while (end < resolved.length && resolved[end].start === undefined) {
      end++;
    }

    const before = i > 0 ? resolved[i - 1] : undefined;
    const after = end < resolved.length ? resolved[end] : undefined;
    if (before?.start !== undefined && after?.start !== undefined) {
      // A hole with its own end must start before it,
      // so the holes up to it are spread on their own.
      // A split of a word that had an end leaves one on its last syllable.
      let anchor = i - 1;
      let first = i;
      while (first < end) {
        const floor = resolved[anchor].end ?? (resolved[anchor].start as number);
        let last = first;
        let ownEnd = resolved[last].end;
        for (;;) {
          if (ownEnd !== undefined && ownEnd <= floor) {
            // The hole can't start before this end, so it would be drawn backwards.
            delete resolved[last].end;
            ownEnd = undefined;
          }
          if (ownEnd !== undefined || last === end - 1) break;
          ownEnd = resolved[++last].end;
        }
        const upper = ownEnd === undefined ? after.start : Math.min(ownEnd, after.start);
        spreadHoles(resolved, anchor, first, last + 1, upper);
        anchor = last;
        first = last + 1;
      }
    }

    i = end;
  }

  for (const segment of resolved) {
    if (segment.start !== undefined && segment.end !== undefined && segment.end < segment.start) {
      delete segment.end;
    }
  }

  return resolved;
}

/**
 * Spread the starts of the holes from `first` to `end` (excluded) between the timed segment at
 * `anchor` and `upper`, by the text each one draws.
 */
function spreadHoles(
  resolved: TimedSegment[],
  anchor: number,
  first: number,
  end: number,
  upper: number,
) {
  const before = resolved[anchor];
  // A hole starts after the preceding segment has ended. Anchoring on that segment's start
  // instead would put the hole inside it, which the region layer rejects as an overlap.
  // The anchor is capped at the upper bound,
  // or an end already dragged past it would move holes backwards.
  const release = before.end === undefined ? undefined : Math.min(before.end, upper);
  const lower = release ?? (before.start as number);
  // With an explicit end the span belongs to the holes alone. Without one the preceding
  // segment runs into them, so it takes a share too.
  const share = [
    release === undefined ? width(before) : 0,
    ...resolved.slice(first, end).map(width),
  ];
  const total = share.reduce((sum, w) => sum + w, 0);
  const span = upper - lower;

  let consumed = 0;
  for (let k = first; k < end; k++) {
    consumed += share[k - first];
    resolved[k].start = lower + (span * consumed) / total;
  }
}

export class LyricSegmentIterator {
  segments: Segment[];
  includeMarkup: boolean;
  constructor(lyrics: string, includeMarkup: boolean = false) {
    this.includeMarkup = includeMarkup;
    this.segments = parseLyrics(lyrics, includeMarkup);
  }

  *[Symbol.iterator](): IterableIterator<Segment> {
    for (let s of this.segments) {
      yield s;
    }
  }
}

export class LyricSegment {
  text: string;
  timestamp: number;
  endTimestamp?: number;
  countIn: boolean;

  constructor(text: string, timestamp: number, endTimestamp?: number, countIn = false) {
    this.text = text;
    this.timestamp = timestamp;
    this.endTimestamp = endTimestamp;
    this.countIn = countIn;
  }

  toString(): string {
    return this.text;
  }

  adjustTimestamps(adjustment: number): LyricSegment {
    const newTs = this.timestamp + adjustment;
    const newEndTs = this.endTimestamp === undefined ? undefined : this.endTimestamp + adjustment;
    return new LyricSegment(this.text, newTs, newEndTs, this.countIn);
  }

  toAss() {
    // Render this segment as part of an ASS event line
    const durationInCentiseconds =
      toCentiseconds(this.endTimestamp ?? 0) - toCentiseconds(this.timestamp);
    return `{\\kf${durationInCentiseconds}}${this.text}`;
  }
}

export type ScreenKind = "lyrics" | "title" | "instrumental";

export type LineSpacing = Pick<KaraokeOptions, "lineSpacing" | "topMargin">;

const DEFAULT_SPACING: LineSpacing = {
  lineSpacing: DEFAULT_LINE_SPACING,
  topMargin: DEFAULT_TOP_MARGIN,
};

export class LyricsScreen {
  lines: LyricsLine[];
  kind: ScreenKind = "lyrics";
  startTimestamp?: Timestamp;
  // Seconds to delay the start of the audio. Only valid on the title screen and first lyrics screen.
  audioDelay: number = 0.0;
  // A lyrics screen's slots, spacers included. Without it, each line takes one slot.
  slotCount?: number;
  // For staggered timings, this screen's first lines are displayed early, in the slots the previous
  // screen's first lines leave, so the block may be laid out as if it had that screen's slot count
  // instead of its own (see placeStaggeredScreens).
  positionAsSlotCount?: number;
  // The lines from this slot down ignore positionAsSlotCount and sit where this screen's own slot
  // count puts them, which leaves the next screen room to return to its own layout.
  settledFromSlot?: number;
  // Staggered lines show this screen's lines in its first `earlySlots` slots
  // while the previous screen is still displayed.
  earlySlots = 0;
  // Multi-voice only: when this screen overlaps another voice in time, it is confined to a
  // vertical "lane" so the voices don't interleave (see createMultiVoiceAssFile). When unset,
  // the screen uses the full height (normal centered/aligned layout).
  verticalZone?: { top: number; height: number } | null = null;

  constructor(lines: LyricsLine[] = [], audioDelay = 0.0) {
    this.lines = lines;
    this.audioDelay = audioDelay;
  }

  get endTimestamp(): Timestamp {
    if (this.lines.length == 0) {
      return this.startTimestamp ?? 0;
    }
    return this.lines[this.lines.length - 1].endTimestamp;
  }

  get singStart(): Timestamp {
    return this.lines[0].singTimestamp;
  }

  get singEnd(): Timestamp {
    return this.lines[this.lines.length - 1].endTimestamp;
  }

  get segments(): LyricSegment[] {
    return this.lines.flatMap((l) => l.segments);
  }

  get staggered(): boolean {
    return this.earlySlots > 0;
  }

  get slots(): number {
    return this.slotCount ?? this.lines.length;
  }

  slotOf(lineInScreen: number): number {
    return this.lines[lineInScreen].slot ?? lineInScreen;
  }

  /**
   * The Y coordinate of the top of the line in the given slot.
   */
  getLineY(
    slot: number,
    fontSize: number,
    alignment: VerticalAlignment = VerticalAlignment.Middle,
    spacing: LineSpacing = DEFAULT_SPACING,
  ): number {
    const lineHeight = fontSize * spacing.lineSpacing;
    // The block is normally as tall as this screen's own slots, but a staggered screen is
    // positioned as if it had the previous screen's slot count (see positionAsSlotCount).
    const settled = slot >= (this.settledFromSlot ?? Infinity);
    const slotCount = settled ? this.slots : (this.positionAsSlotCount ?? this.slots);
    // libass draws each line from the top of its slot,
    // so the slack between the glyphs and the slot all ends up below the last line.
    // Centre on the glyphs rather than the slots, or the block sits half that slack too high.
    // Lanes use the same block as the screen,
    // so a voice doesn't jump when its screens start or stop overlapping another voice.
    const blockHeight = (slotCount - 1) * lineHeight + fontSize * GLYPH_BLOCK_RATIO;
    let firstLineTopMargin: number;
    // When confined to a lane (overlapping another voice), center the lines within the
    // lane regardless of the global alignment, so each voice stays a contiguous block.
    if (this.verticalZone) {
      const laneMiddle = this.verticalZone.top + this.verticalZone.height / 2;
      firstLineTopMargin = laneMiddle - blockHeight / 2;
    } else {
      switch (alignment) {
        case VerticalAlignment.Top:
          firstLineTopMargin = fontSize * spacing.topMargin;
          break;
        case VerticalAlignment.Middle:
          const screenMiddle = SUBTITLE_CANVAS.height / 2;
          firstLineTopMargin = screenMiddle - blockHeight / 2;
          break;
        case VerticalAlignment.Bottom:
          firstLineTopMargin = SUBTITLE_CANVAS.height - (slotCount + 1) * lineHeight;
          break;
      }
    }
    return Math.round(firstLineTopMargin + slot * lineHeight);
  }

  toAssEvents(
    formatParams: Record<string, unknown>,
    videoOptions: KaraokeOptions,
    styleName: string = "Default",
    actor: string = "Singer",
  ) {
    const self = this;
    const shadow = shadowTags(videoOptions);
    // The alignment lays out the lyrics. The title screen stays centred.
    const alignment =
      this.kind === "title" ? VerticalAlignment.Middle : videoOptions.verticalAlignment;
    // A sweep tells singers to sing, so the title is drawn without one.
    const sweep = this.kind !== "title";
    return (
      this.lines
        .map((l, i) =>
          l.toAssEvent(
            self.startTimestamp ?? 0,
            self.endTimestamp,
            styleName,
            self.getLineY(
              self.slotOf(i),
              formatParams["Fontsize"] as number,
              alignment,
              videoOptions,
            ),
            shadow,
            actor,
            sweep,
          ),
        )
        .join("\n") + "\n"
    );
  }

  adjustTimestamps(adjustment: number): LyricsScreen {
    const lines = map(this.lines, method("adjustTimestamps", adjustment));
    const screen = new LyricsScreen(lines, this.audioDelay);
    screen.kind = this.kind;
    screen.slotCount = this.slotCount;
    screen.startTimestamp = this.startTimestamp;
    if (isNumber(this.startTimestamp)) {
      screen.startTimestamp = this.startTimestamp + adjustment;
    }
    // else {
    //   screen.startTimestamp = adjustment;
    // }
    return screen;
  }

  trimDisplayStart(adjustment: number): LyricsScreen {
    // Adjust the start of this screen's display by [adjustment]
    const newStartTime = this.startTimestamp ? this.startTimestamp + adjustment : adjustment;
    const firstAnimation = this.lines[0].timestamp;
    // The adjustment is often the gap up to the first line, which the sum can overshoot by a
    // rounding error.
    if (newStartTime > firstAnimation + 1e-9) {
      throw Error(
        `Cannot adjust screen display start by ${adjustment}s: display start is ${this.startTimestamp}, first line animates at ${firstAnimation}`,
      );
    }
    const trimmedScreen = new LyricsScreen(this.lines, this.audioDelay);
    trimmedScreen.kind = this.kind;
    trimmedScreen.slotCount = this.slotCount;
    trimmedScreen.startTimestamp = Math.min(newStartTime, firstAnimation);
    return trimmedScreen;
  }
}

/**
 * The shadow offset as override tags.
 * A style's Shadow field only takes one distance, which casts down and to the right.
 */
function shadowTags(options: KaraokeOptions): string {
  const { shadowX, shadowY } = options;
  return shadowDrawn(options) ? `{\\xshad${shadowX}\\yshad${shadowY}}` : "";
}

export class LyricsLine {
  segments: LyricSegment[];

  // Times to start/end display of the line, as opposed to animation. If none, screen start/end times
  // will be used.
  customDisplayStartTime?: Timestamp;
  customDisplayEndTime?: Timestamp;
  fadeInDuration: Seconds = 0.0;
  fadeOutDuration: Seconds = 0.0;
  // The display period the user stored, in the same time base as the segments.
  // It replaces the automatic one once every other pass has run (see applyStoredDisplayPeriods).
  storedDisplayStart?: Timestamp;
  storedDisplayEnd?: Timestamp;
  // The index of the segment that starts this line and holds its stored period.
  headIndex?: number;
  // The line's position on its page, counting spacers. Without it, the line sits at its index.
  slot?: number;
  // An automatic bound moved to make way for another line at the same height, or for a fade.
  startMoved = false;
  endMoved = false;

  constructor(segments: LyricSegment[] = []) {
    this.segments = segments;
  }

  toString(): string {
    return `LyricsLine(${this.segments.map((s) => s.toString()).join(" ")})`;
  }

  get timestamp(): Timestamp {
    if (this.segments.length == 0) {
      return 0.0;
    }
    return this.segments[0].timestamp;
  }

  set timestamp(ts: Timestamp) {
    this.segments[0].timestamp = ts;
  }

  /**
   * When the singing starts, which is after the line's count-in.
   */
  get singTimestamp(): Timestamp {
    return this.segments.find((segment) => !segment.countIn)?.timestamp ?? this.timestamp;
  }

  get endTimestamp(): Timestamp {
    if (this.segments.length == 0) {
      return this.timestamp;
    }
    return this.segments[this.segments.length - 1].endTimestamp ?? 0;
  }

  addSegmentToFront(newSegment: LyricSegment) {
    this.segments.unshift(newSegment);
  }

  addSegmentsToFront(newSegments: LyricSegment[]) {
    this.segments.unshift(...newSegments);
  }

  decorateAssLine(segments: LyricSegment[], displayStartTime: Timestamp): string {
    // Decorate the line with karaoke tags
    // An ASS line starts with {k<digits>} which is centiseconds within the current
    // line to start animating.
    // That is followed by {\kf<digits>} which is how long to animate the text
    // following the tag.

    // Delay between line display and start of line animation
    let singStartDelay = toCentiseconds(this.timestamp) - toCentiseconds(displayStartTime);
    if (singStartDelay < 0) {
      console.error(`Negative line startTime: ${this}: ${singStartDelay}`);
      singStartDelay = 0;
    }
    let line = `{\\k${singStartDelay}}`;
    let previousEnd: number | undefined = undefined;
    for (const s of segments) {
      if (previousEnd !== undefined && previousEnd < s.timestamp) {
        // Insert a blank segment to represent a gap between segments
        const blankSegment = new LyricSegment("", previousEnd, s.timestamp);
        line += blankSegment.toAss();
      }
      line += s.toAss();
      previousEnd = s.endTimestamp;
    }
    return this.addAssFades(line);
  }

  toAssEvent(
    screenStart: Timestamp,
    screenEnd: Timestamp,
    style: string,
    topMargin: number,
    tags: string = "",
    actor: string = "Singer",
    sweep: boolean = true,
  ): string {
    if (isNaN(this.timestamp) || isNaN(screenStart) || isNaN(screenEnd)) {
      console.error("NaN value for line", this.toString(), screenStart, screenEnd);
      throw Error("NaN value for timestamp");
    }
    const displayStart = this.customDisplayStartTime ?? screenStart;
    const displayEnd = this.customDisplayEndTime ?? screenEnd;
    const e: AssEvent = {
      type: "Dialogue",
      Layer: 0,
      Start: floatToTimecode(displayStart),
      End: floatToTimecode(displayEnd),
      Style: style,
      Name: actor,
      MarginL: 0,
      MarginR: 0,
      MarginV: topMargin,
      Effect: "",
      Text:
        tags +
        (sweep
          ? this.decorateAssLine(this.segments, displayStart)
          : this.addAssFades(this.segments.map((s) => s.text).join(""))),
    };
    return (
      `${e.type}: ` +
      (
        [
          "Layer",
          "Start",
          "End",
          "Style",
          "Name",
          "MarginL",
          "MarginR",
          "MarginV",
          "Effect",
          "Text",
        ] as (keyof AssEvent)[]
      )
        .map((k) => e[k])
        .join(",")
    );
  }

  addAssFades(assLine: string): string {
    if (this.fadeInDuration == 0 && this.fadeOutDuration == 0) {
      return assLine;
    }
    return (
      `{\\fad(${Math.floor(this.fadeInDuration * 1000)},${Math.floor(this.fadeOutDuration * 1000)})}` +
      assLine
    );
  }

  adjustTimestamps(adjustment: number): LyricsLine {
    const line = new LyricsLine(map(this.segments, method("adjustTimestamps", adjustment)));
    const shift = (time: Timestamp | undefined) =>
      time === undefined ? undefined : time + adjustment;
    line.customDisplayStartTime = shift(this.customDisplayStartTime);
    line.customDisplayEndTime = shift(this.customDisplayEndTime);
    line.storedDisplayStart = shift(this.storedDisplayStart);
    line.storedDisplayEnd = shift(this.storedDisplayEnd);
    line.fadeInDuration = this.fadeInDuration;
    line.fadeOutDuration = this.fadeOutDuration;
    line.headIndex = this.headIndex;
    line.slot = this.slot;
    return line;
  }
}

export type LyricEvent = [number, number];
export type Timestamp = number;

/**
 * Group timed segments into the lines and screens the renderer draws.
 * Each segment carries its own text, so there are no two sequences to keep in step.
 */
export function compileLyricTimings(segments: TimedSegment[]): LyricsScreen[] {
  const screens: LyricsScreen[] = [];
  let screen = new LyricsScreen();
  let line = new LyricsLine();
  // A line's display period and spacer counts live on its first segment, which may be untimed.
  let head: TimedSegment | undefined;
  let headIndex = 0;
  // The next free slot on the current page.
  let slot = 0;
  // A line that draws nothing takes no slot, but its spacers still do.
  const closeLine = (endsPage: boolean) => {
    slot += head?.spacersBefore ?? 0;
    if (line.segments.length > 0) {
      line.storedDisplayStart = head?.displayStart;
      line.storedDisplayEnd = head?.displayEnd;
      line.headIndex = headIndex;
      line.slot = slot++;
      screen.lines.push(line);
      line = new LyricsLine();
    }
    if (endsPage) {
      slot += head?.spacersAfter ?? 0;
    }
    head = undefined;
  };
  const closeScreen = () => {
    if (screen.lines.length > 0) {
      screen.slotCount = slot;
      screens.push(screen);
      screen = new LyricsScreen();
    }
    // A page that draws nothing adds no slots to the screen that continues past it.
    slot = 0;
  };

  for (const [index, segment] of segments.entries()) {
    const { text, start, end } = segment;
    if (!head) {
      head = segment;
      headIndex = index;
    }
    // An untimed segment draws nothing, but its separator still breaks the line or screen,
    // so the break below runs either way.
    // Empty text means a timing with no lyric (see fromEvents).
    if (start !== undefined && text !== "") {
      line.segments.push(new LyricSegment(displayText(text), start, end));
    }
    if (text.endsWith("\n")) {
      closeLine(text.endsWith("\n\n"));
    }
    if (text.endsWith("\n\n")) {
      closeScreen();
    }
  }

  closeLine(true);
  closeScreen();
  return screens;
}

export function setSegmentEndTimes(screens: LyricsScreen[], songDuration: number): LyricsScreen[] {
  // Infer end times of segments if they are not already set, and clamp explicit end times so a segment
  // can't extend past the next one. Within a single voice you can't sing two segments at once,
  // so an end later than the next segment's start (e.g. a release dragged too far in the Adjust tab)
  // would otherwise double-colour two lines at the same time.
  const segments: LyricSegment[] = screens.flatMap((s) => s.lines.flatMap((l) => l.segments));
  segments.forEach((segment, i) => {
    const nextStart = i < segments.length - 1 ? segments[i + 1].timestamp : songDuration;
    if (!segment.endTimestamp) {
      segment.endTimestamp = nextStart;
    } else if (segment.endTimestamp > nextStart) {
      segment.endTimestamp = nextStart;
    }
  });
  return screens;
}

export function setScreenStartTimes(screens: LyricsScreen[]): LyricsScreen[] {
  // Set start times for screens to the end times of the previous screen
  let prevScreen = null;
  for (const screen of screens) {
    if (!prevScreen) {
      screen.startTimestamp = 0.0;
    } else {
      screen.startTimestamp = prevScreen.endTimestamp;
    }
    prevScreen = screen;
  }
  return screens;
}

export function adjustScreenTimestamps(
  screens: LyricsScreen[],
  adjustment: number,
): LyricsScreen[] {
  // Adjust all timings in [screens] forward by [adjustment] seconds.
  return map(screens, method("adjustTimestamps", adjustment));
}

export function denormalizeTimestamps(
  screens: LyricsScreen[],
  songDuration: number,
): LyricsScreen[] {
  // Explicitly set various timestamps
  return setScreenStartTimes(setSegmentEndTimes(screens, songDuration));
}

// Build the display parameters (one ASS style row's fields) for a style named `styleName`.
function buildDisplayParams(formatParams: Object, styleName: string): Record<string, unknown> {
  const displayParams: Record<string, unknown> = {
    Name: styleName,
    Fontname: "Arial Narrow",
    Fontsize: 20,
    PrimaryColour: [255, 0, 255, 255],
    SecondaryColour: [0, 255, 255, 255],
    OutlineColour: [0, 0, 0, 255],
    BackColour: [0, 0, 0, 0],
    Bold: -1,
    Italic: 0,
    Underline: 0,
    StrikeOut: 0,
    ScaleX: 100,
    ScaleY: 100,
    Spacing: 0,
    Angle: 0,
    BorderStyle: 1,
    Outline: 0,
    Shadow: 0,
    Alignment: 8,
    MarginL: 0,
    MarginR: 0,
    MarginV: 0,
    Encoding: 0,
    ...formatParams,
  };

  for (const key of ["PrimaryColour", "SecondaryColour", "OutlineColour", "BackColour"]) {
    displayParams[key] = colorToString(displayParams[key] as Color);
  }
  return displayParams;
}

const TITLE_STYLE_NAME = "Title";

/**
 * The options the title is drawn with, or null when they would draw it like the lyrics.
 */
function ownTitleOptions(options: KaraokeOptions): KaraokeOptions | null {
  const title = applyVoiceStyle(options, options.titleStyle);
  const looks = (o: KaraokeOptions) =>
    JSON.stringify([buildDisplayParams(optionsToFormatParams(o), ""), shadowTags(o)]);
  return looks(title) === looks(options) ? null : title;
}

// The [Script Info] field holding the settings the subtitles can't show, as one line of YAML.
export const PROJECT_SETTINGS_KEY = "Project Settings";

export interface VoiceTrackRender {
  // Blank when the subtitles have a single unnamed voice.
  voice: string;
  styleName: string;
  displayParams: Record<string, unknown>;
  screens: LyricsScreen[];
  options: KaraokeOptions;
}

// Render one ASS document from one or more styled tracks. Each track contributes its own
// [V4+ Styles] row and its screens' events, tagged with that track's style. All tracks
// share the same style field set (Format line), since displayParams always has every key.
function renderAssDocument(
  tracks: VoiceTrackRender[],
  fonts: FontLibrary,
  projectSettings?: string,
): string {
  const formatKeys = Object.keys(tracks[0].displayParams);
  const titled = tracks[0].screens.some((screen) => screen.kind === "title");
  const titleOptions = titled ? ownTitleOptions(tracks[0].options) : null;
  const titleStyle = titleOptions && {
    styleName: TITLE_STYLE_NAME,
    displayParams: buildDisplayParams(optionsToFormatParams(titleOptions), TITLE_STYLE_NAME),
    options: titleOptions,
  };
  const styleLines = [...tracks, ...(titleStyle ? [titleStyle] : [])]
    .map((t) => `Style: ${formatKeys.map((k) => t.displayParams[k]).join(",")}`)
    .join("\n");
  // The canvas the line positions in getLineY were computed against.
  const videoWidth = SUBTITLE_CANVAS.width;
  const videoHeight = SUBTITLE_CANVAS.height;

  // Audio Delay and Project Settings aren't ASS fields, so libass ignores them.
  // An ASS import reads the delay to move the timings back to the song's time,
  // and the settings for what the subtitles can't show.
  let assText = `[Script Info]
; Script generated by ${appName()}
ScriptType: v4.00+
LayoutResX: ${videoWidth}
LayoutResY: ${videoHeight}
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes
YCbCr Matrix: None
WrapStyle: 0
Audio Delay: ${songOffset(tracks[0]).toFixed(3)}
${projectSettings ? `${PROJECT_SETTINGS_KEY}: ${projectSettings}\n` : ""}
[V4+ Styles]
Format: ${formatKeys.join(", ")}
${styleLines}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  for (const track of tracks) {
    // The actor field ends at a comma, and an import reads the voice back from it.
    const actor = track.voice.replace(/,/g, " ").trim() || "Singer";
    for (const screen of track.screens) {
      const { displayParams, styleName, options } =
        screen.kind === "title" && titleStyle ? titleStyle : track;
      const fontName = displayParams.Fontname as string;
      const events = screen.toAssEvents(displayParams, options, styleName, actor);
      assText += withFallbackFonts(events, fontName, fonts.covered(fontName));
    }
  }
  return assText;
}

function createSubtitles(
  screens: LyricsScreen[],
  options: KaraokeOptions,
  formatParams: Object,
  fonts: FontLibrary,
): string {
  const displayParams = buildDisplayParams(formatParams, "Default");
  return renderAssDocument(
    [{ voice: "", styleName: "Default", displayParams, screens, options }],
    fonts,
  );
}

/**
 * Each voice's screens as the automatic rules lay them out, before any stored display period applies.
 * Only the first voice gets the title screen.
 * The voices share one audio track, so when the title screen or a quick-start count-in delays it,
 * every voice moves by the same amount.
 */
function createAutomaticScreens(
  tracks: VoiceTrack[],
  songDuration: number,
  title: string,
  artist: string,
): LyricsScreen[][] {
  // A voice with no lyrics yet has no screens, and the decorators below index into screens[0].
  const firstStarts = (screensByVoice: LyricsScreen[][]) =>
    screensByVoice
      .filter((screens) => screens.length > 0)
      .map(([first]) => first.lines[0].timestamp);

  const compiled = tracks.map(({ segments }) =>
    denormalizeTimestamps(compileLyricTimings(resolveStarts(segments)), songDuration),
  );
  const primary = tracks[0].options;
  const quickStart = quickStartDelay(firstStarts(compiled), primary);
  const counted = compiled.map((screens, i) => {
    const { options } = tracks[i];
    if (screens.length === 0 || options.countInMode === "none") {
      return screens;
    }
    return addGapCountIns(addQuickStartCountIn(screens, options, quickStart), options);
  });

  const introLength = Math.min(...firstStarts(counted));
  const duration = primary.titleScreenDuration ?? TITLE_SCREEN_DURATION;
  const titled = primary.addTitleScreen && duration > 0 && counted[0].length > 0;
  return counted.map((screens, i) => {
    const { options } = tracks[i];
    if (screens.length === 0) {
      return screens;
    }
    if (titled && i > 0) {
      screens = delaySong(screens, titleScreenDelay(introLength, duration));
    } else if (titled && primary.showTitle === false) {
      screens = makeRoomForTitleScreen(screens, introLength, duration);
    } else if (titled) {
      screens = addTitleScreen(screens, title, artist, introLength, duration);
    }
    if (options.addStaggeredLines) {
      screens = displayQuickLinesEarly(screens, options);
    }
    screens = addOverlappingCountIns(screens, options);
    if (options.instrumentalThreshold > 0) {
      screens = addIntroInstrumentalScreen(screens, options, titled ? duration : 0);
      screens = addInstrumentalScreens(screens, options);
    }
    return screens;
  });
}

/**
 * One voice's screens with its stored display periods applied.
 * Unlike `layOutVoices`, this leaves automatic periods that overlap a stored one as they are.
 */
export function createScreens(
  segments: TimedSegment[],
  songDuration: number,
  title: string,
  artist: string,
  options: KaraokeOptions,
): LyricsScreen[] {
  let [screens] = createAutomaticScreens(
    [{ voice: "", segments, options }],
    songDuration,
    title,
    artist,
  );
  if (options.useStoredDisplayPeriods) {
    screens = applyStoredDisplayPeriods(screens);
    endTitleScreenBy(screens, earliestStoredStart(screens));
    screens = fitInstrumentalScreens(screens);
  }
  return screens;
}

// Derive the ASS style format params (font + colors + bold/italic) from karaoke options.
function optionsToFormatParams(options: KaraokeOptions): Record<string, unknown> {
  const primaryColor = options.color.primary;
  const secondaryColor = options.color.secondary;
  // An outline or shadow that isn't drawn is written fully transparent.
  const effectColor = (drawn: boolean, color: BuefyColor | null): Color => {
    if (!drawn) return [0, 0, 0, 255];
    const { red, green, blue } = color ?? defaultEffectColor();
    return [red, green, blue, 0];
  };

  const formatParams: Record<string, unknown> = {
    Fontname: options.font.name,
    Fontsize: options.font.size,
    PrimaryColour: [primaryColor.red, primaryColor.green, primaryColor.blue, 0],
    SecondaryColour: [secondaryColor.red, secondaryColor.green, secondaryColor.blue, 0],
    OutlineColour: effectColor(outlineDrawn(options), options.color.outline),
    BackColour: effectColor(shadowDrawn(options), options.color.shadow),
    BorderStyle: 1,
    Outline: options.outlineWidth,
    // shadowTags sets the offset on each line.
    Shadow: 0,
  };
  // Only override Bold/Italic when explicitly set, so default output is unchanged.
  // ASS uses -1 for bold-on and 1 for italic-on.
  if (options.font.bold !== undefined) {
    formatParams["Bold"] = options.font.bold ? -1 : 0;
  }
  if (options.font.italic !== undefined) {
    formatParams["Italic"] = options.font.italic ? 1 : 0;
  }
  return formatParams;
}

export function createAssFile(
  segments: TimedSegment[],
  songDuration: number,
  title: string,
  artist: string,
  options: KaraokeOptions,
  fonts: FontLibrary = new FontLibrary(),
) {
  // Entry point to subtitles. Creates an .ass file from the given info.
  const [{ screens }] = layOutVoices(
    [{ voice: "", segments, options }],
    songDuration,
    title,
    artist,
  );
  return createSubtitles(screens, options, optionsToFormatParams(options), fonts);
}

export interface VoiceTrack {
  voice: string;
  segments: TimedSegment[];
  options: KaraokeOptions;
}

// Turn an arbitrary voice id into a valid, unique ASS style name.
function styleNameForVoice(index: number): string {
  return `V${index}`;
}

// Entry point for multi-voice subtitles. Each voice is rendered independently (its own lyrics, timings, and
// style) and composited into one ASS file. This mirrors the core design choice (see frontend/lib/voices.ts):
// a voice is a self-contained single-voice project, so we just run the normal `createScreens` per voice and
// concatenate the resulting dialogue events into one document — ASS handles overlapping events natively,
// which is exactly why independent voices compose cleanly here.
//
// The title and instrumental-break screens are genuinely global (one song, shown once), so only the FIRST
// track contributes them, or else every voice would draw its own and they'd stack. Count-ins, by contrast,
// stay PER VOICE — each voice gets its own "***" lead-in before its lines. Non-first voices have no
// title/instrumental screens to fill the lead-in, so they also get `deferScreenStarts` to stop their
// text displaying from 0:00 when their first line is deep into the song.
function screensOverlapInTime(a: LyricsScreen, b: LyricsScreen): boolean {
  if (a.startTimestamp == null || b.startTimestamp == null) {
    return false;
  }
  return a.startTimestamp < b.endTimestamp && b.startTimestamp < a.endTimestamp;
}

// Per-voice vertical lanes (the "centered alone, lanes when overlapping" layout).
// A screen that is displayed at the same time as any *other* voice's screen is confined to
// its voice's horizontal band (voice 0 on top, voice 1 below, ...), so simultaneous voices
// stack as separate blocks instead of letting libass's collision-avoidance interleave them.
// Screens with no cross-voice overlap keep their default full-height centered layout.
// This runs on the automatic periods, so a stored period never moves a line to another height.
function assignVoiceLanes(renders: VoiceTrackRender[]): void {
  const voiceCount = renders.length;
  if (voiceCount < 2) {
    return;
  }
  const laneHeight = SUBTITLE_CANVAS.height / voiceCount;
  renders.forEach((render, index) => {
    const lane = { top: index * laneHeight, height: laneHeight };
    for (const screen of render.screens) {
      const overlapsOtherVoice = renders.some(
        (other, otherIndex) =>
          otherIndex !== index && other.screens.some((os) => screensOverlapInTime(screen, os)),
      );
      if (overlapsOtherVoice) {
        screen.verticalZone = lane;
      }
    }
    // A staggered screen's early lines only fill the slots the previous screen's lines leave
    // when both screens are in the lane or both are out of it.
    // Moving the other screen too would move its own staggered neighbour, and so on down the song.
    for (const [i, screen] of render.screens.entries()) {
      const previous = render.screens[i - 1];
      if (i > 0 && screen.staggered && !previous.verticalZone !== !screen.verticalZone) {
        unstagger(previous, screen, render.options);
      }
    }
  });
}

/**
 * Every voice's screens as the video lays them out, lanes included, in the order of `tracks`.
 * Heights come from the automatic periods alone, and stored periods only change when lines are shown.
 */
export function layOutVoices(
  tracks: VoiceTrack[],
  songDuration: number,
  title: string,
  artist: string,
): VoiceTrackRender[] {
  // The title and instrumental-break screens are global: only the primary voice contributes them.
  // Count-ins stay per voice.
  const voiceTracks: VoiceTrack[] = tracks.map((track, index) => ({
    ...track,
    options:
      index === 0
        ? track.options
        : { ...track.options, addTitleScreen: false, instrumentalThreshold: 0 },
  }));
  const screensByVoice =
    tracks.length > 0 ? createAutomaticScreens(voiceTracks, songDuration, title, artist) : [];
  const renders: VoiceTrackRender[] = voiceTracks.map(({ voice, options }, index) => {
    // Non-primary voices have no title/instrumental to fill long gaps,
    // so cap how early their screens display.
    const screens = index === 0 ? screensByVoice[0] : deferScreenStarts(screensByVoice[index]);
    const styleName = styleNameForVoice(index);
    return {
      voice,
      styleName,
      displayParams: buildDisplayParams(optionsToFormatParams(options), styleName),
      screens,
      options,
    };
  });
  assignVoiceLanes(renders);
  for (const render of renders) {
    placeStaggeredScreens(render.screens, render.options);
    if (render.options.useStoredDisplayPeriods) {
      render.screens = applyStoredDisplayPeriods(render.screens);
    }
  }
  // The title screen is global, so it gives way to every voice's stored periods.
  const storedStarts = renders
    .filter((render) => render.options.useStoredDisplayPeriods)
    .map((render) => earliestStoredStart(render.screens))
    .filter((start) => start !== undefined);
  if (renders.length > 0 && storedStarts.length > 0) {
    endTitleScreenBy(renders[0].screens, Math.min(...storedStarts));
  }
  giveWayToStoredPeriods(renders);
  fadeLines(renders, songDuration);
  for (const render of renders) {
    render.screens = fitInstrumentalScreens(render.screens);
    fadeInstrumentalScreens(render.screens);
  }
  return renders;
}

export function createMultiVoiceAssFile(
  tracks: VoiceTrack[],
  songDuration: number,
  title: string,
  artist: string,
  fonts: FontLibrary = new FontLibrary(),
  projectSettings?: string,
): string {
  if (tracks.length === 0) {
    return "";
  }
  return renderAssDocument(
    layOutVoices(tracks, songDuration, title, artist),
    fonts,
    projectSettings,
  );
}
