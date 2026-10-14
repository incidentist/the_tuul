// Recovering the settings and display periods a file the app wrote was rendered with.
// The file holds the render, not the settings, so each setting is tried at the values the file
// suggests and kept at the one whose render matches the file best.
// A setting that never changes the render is left out, so the user's own value stays.

import BuefyColor from "buefy/src/utils/color";
import { AssDocument, AssEvent, AssStyle, parseAss, parseKaraoke } from "./ass";
import { joinRows } from "./assRows";
import {
  createMultiVoiceAssFile,
  DEFAULT_KARAOKE_OPTIONS,
  KaraokeOptions,
  layOutVoices,
  VerticalAlignment,
  VoiceTrack,
} from "./timing";
import { LINE_FADE } from "./screenSlots";
import { TimedSegment } from "./timedSegments";
import { VoiceId } from "./voices";

export interface FitVoice {
  voice: VoiceId;
  style?: AssStyle;
  segments: TimedSegment[];
  // The file's event for each line, by the index of the line's head.
  events: Map<number, AssEvent>;
}

export interface FitResult {
  options: Partial<KaraokeOptions>;
  // Each voice's segments with a display period only where the automatic one differs from the file,
  // and the page breaks and spacers that put each line at the file's height.
  segments: Record<VoiceId, TimedSegment[]>;
  // Events of the render that differ from the file's.
  mismatches: number;
}

type FittedKey =
  | "countInMode"
  | "dynamicCountIns"
  | "countInText"
  | "countInThreshold"
  | "countInDuration"
  | "addStaggeredLines"
  | "verticalAlignment"
  | "lineSpacing"
  | "topMargin"
  | "instrumentalThreshold";

type Candidates = (options: KaraokeOptions) => unknown[];

const MAX_SPACERS = 3;
const PLACEMENT_ROUNDS = 4;
const INSTRUMENTAL_BAR = /\{\\p1\}m [-\d. ]+l/;

function isInstrumental(event: AssEvent): boolean {
  return INSTRUMENTAL_BAR.test(event.text) && !/[^\s]/.test(drawn(event));
}

function drawn(event: AssEvent): string {
  return parseKaraoke(event.text)
    .syllables.map((syllable) => syllable.text)
    .join("");
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function mostCommon(values: number[]): number[] {
  const counts = new Map<number, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value);
}

/**
 * The options a voice's style gives, over the defaults.
 */
function styleOptions(style: AssStyle | undefined): KaraokeOptions {
  if (!style) {
    return DEFAULT_KARAOKE_OPTIONS;
  }
  return {
    ...DEFAULT_KARAOKE_OPTIONS,
    outlineWidth: style.outlineWidth,
    font: { name: style.fontName, size: style.fontSize, bold: style.bold, italic: style.italic },
    color: {
      ...DEFAULT_KARAOKE_OPTIONS.color,
      primary: BuefyColor.parse(style.primary),
      secondary: BuefyColor.parse(style.secondary),
      outline: BuefyColor.parse(style.outline),
      shadow: BuefyColor.parse(style.back),
    },
  };
}

/**
 * The count-in syllables of each event, which the app tags with an alpha and nothing else it writes.
 */
function countIns(events: AssEvent[]) {
  return events
    .map((event) =>
      parseKaraoke(event.text).syllables.filter((syllable) =>
        syllable.tags.some((tag) => tag.startsWith("\\alpha")),
      ),
    )
    .filter((syllables) => syllables.length > 0);
}

function countInCandidates(events: AssEvent[]): Partial<Record<FittedKey, Candidates>> {
  const all = countIns(events);
  if (all.length === 0) {
    return { countInMode: () => ["none"] };
  }
  const longest = all.reduce((a, b) => (b.length > a.length ? b : a));
  const faded = all.flat().some((syllable) => !syllable.tags.includes("\\alpha&H00&"));
  // Dynamic marks drawn as blocks leave no text.
  // A text without trailing spaces gets a half-width one after its last mark.
  const last = longest[longest.length - 1];
  const text = longest.map((syllable) => syllable.text).join("");
  const dynamicText = last.tags.includes("\\fscx50") ? text.replace(/ $/, "") : text;
  const total = longest.reduce((sum, syllable) => sum + syllable.duration, 0) / 100;
  return {
    countInMode: () => ["screen", "line"],
    dynamicCountIns: () => (faded ? [true] : [true, false]),
    countInText: (options) => [options.dynamicCountIns ? dynamicText : text],
    // A dynamic count-in lasts the threshold. A fixed one lasts its duration, and the threshold
    // is only bounded by the gaps that earned one, so a few likely values are tried.
    countInThreshold: (options) =>
      options.dynamicCountIns
        ? [round(total, 2), round(total - 0.01, 2), round(total + 0.01, 2)]
        : [DEFAULT_KARAOKE_OPTIONS.countInThreshold, 1, 1.5, 2, 2.5, 3, 4, 5],
    countInDuration: (options) => (options.dynamicCountIns ? [] : [round(total, 2)]),
  };
}

function layoutCandidates(
  events: AssEvent[],
  fontSize: number,
): Partial<Record<FittedKey, Candidates>> {
  const heights = [...new Set(events.map((event) => event.marginV))].sort((a, b) => a - b);
  const steps = mostCommon(heights.slice(1).map((height, i) => height - heights[i]));
  const spacings = steps.slice(0, 2).flatMap((step) => [step, step * 2]);
  return {
    verticalAlignment: () => [
      VerticalAlignment.Middle,
      VerticalAlignment.Top,
      VerticalAlignment.Bottom,
    ],
    lineSpacing: () => [
      ...spacings.map((step) => round(step / fontSize, 3)),
      DEFAULT_KARAOKE_OPTIONS.lineSpacing,
    ],
    topMargin: () => [round((heights[0] ?? 0) / fontSize, 3), DEFAULT_KARAOKE_OPTIONS.topMargin],
  };
}

/**
 * The thresholds either side of each gap that an instrumental screen could fill,
 * read from a render that fills every gap.
 */
function instrumentalCandidates(render: (options: KaraokeOptions) => AssEvent[]): Candidates {
  return (options) => {
    const gaps = render({ ...options, instrumentalThreshold: 0.01 })
      .filter(isInstrumental)
      .map((event) => (event.end - event.start) / 100);
    const longest = Math.max(0, ...gaps);
    return [
      ...gaps.flatMap((gap) => [round(gap - 0.01, 2), round(gap + 0.01, 2)]),
      round(longest + 0.02, 2),
    ].filter((threshold) => threshold > 0);
  };
}

function withoutPeriods(segments: TimedSegment[]): TimedSegment[] {
  return segments.map(({ displayStart, displayEnd, ...segment }) => segment);
}

/**
 * The index pairs of a longest common subsequence of the two lists.
 */
function commonPairs<T>(a: T[], b: T[], same: (x: T, y: T) => boolean): [number, number][] {
  const lengths = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] = same(a[i], b[j])
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (same(a[i], b[j])) {
      pairs.push([i++, j++]);
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

function tokens(text: string): string[] {
  return text.match(/\{[^}]*\}|[^{]+/g) ?? [];
}

// The words an event sings, which pair it with its counterpart in another render.
function sungWords(event: AssEvent): string {
  const syllables = parseKaraoke(event.text).syllables.filter(
    (syllable) => !syllable.tags.some((tag) => tag.startsWith("\\alpha")),
  );
  return syllables.map((syllable) => syllable.text).join("");
}

/**
 * How far a render is from the file, field by field and tag by tag,
 * so that a setting that fixes part of a line counts before the rest of the line is right.
 * `misplaced` holds the file's events the render draws at another height,
 * and `heights` counts those and the events left unpaired.
 */
function distanceFrom(file: AssEvent[]) {
  const fileWords = file.map(sungWords);
  const fileTokens = file.map((event) => tokens(event.text));
  const unpaired = (texts: string[][]) => texts.reduce((sum, text) => sum + 3 + text.length, 0);
  const fileUnpaired = unpaired(fileTokens);
  return (render: AssEvent[]) => {
    const renderTokens = render.map((event) => tokens(event.text));
    const pairs = commonPairs(fileWords, render.map(sungWords), (x, y) => x === y);
    let distance = fileUnpaired + unpaired(renderTokens);
    let mismatches = file.length + render.length - 2 * pairs.length;
    const misplaced = new Set<AssEvent>();
    for (const [i, j] of pairs) {
      const [a, b] = [file[i], render[j]];
      const [ta, tb] = [fileTokens[i], renderTokens[j]];
      const fields =
        Number(a.start !== b.start) + Number(a.end !== b.end) + Number(a.marginV !== b.marginV);
      const tags =
        a.text === b.text
          ? 0
          : ta.length + tb.length - 2 * commonPairs(ta, tb, (x, y) => x === y).length;
      distance += fields + tags - (6 + ta.length + tb.length);
      mismatches += Number(fields + tags > 0);
      if (a.marginV !== b.marginV) misplaced.add(a);
    }
    const heights = misplaced.size + file.length + render.length - 2 * pairs.length;
    return { distance, mismatches, misplaced, heights };
  };
}

/**
 * The shadow offset the app tags an event with, or undefined when it has none.
 */
export function shadowOffset(event: AssEvent): [number, number] | undefined {
  const match = event.text.match(/\\xshad(-?[\d.]+)\\yshad(-?[\d.]+)/);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

export interface FitContext {
  song: { title?: string; artist?: string } | null;
  titleStyle?: KaraokeOptions["titleStyle"];
  // How far the file holds the song back, in centiseconds.
  delay: number;
  // How long the song lasts, in seconds, when the file says.
  duration?: number;
  // The values the file says it was rendered with, which win over any other that renders as well.
  hints?: Partial<KaraokeOptions>;
}

/**
 * Fit the options and display periods to the file, which the app rendered from these voices.
 */
export function fitOwnRender(
  document: AssDocument,
  voices: FitVoice[],
  { song, titleStyle, delay, duration, hints = {} }: FitContext,
): FitResult {
  const fileEvents = document.events.filter((event) => !event.comment);
  const lyricEvents = fileEvents.filter((event) => !isInstrumental(event));
  // Otherwise the song runs at least until the last line is gone,
  // and only the end of the last fade-out would tell how much longer.
  const songDuration =
    duration ?? Math.max(...fileEvents.map((event) => event.end - delay)) / 100 + LINE_FADE;
  // The title may cast a shadow of its own.
  const shadow = fileEvents
    .slice(song ? 2 : 0)
    .map(shadowOffset)
    .find(Boolean);
  const fixed: Partial<KaraokeOptions> = {
    addTitleScreen: song !== null,
    shadowX: shadow ? shadow[0] : 0,
    shadowY: shadow ? shadow[1] : 0,
  };
  const fontSize = voices[0].style?.fontSize ?? DEFAULT_KARAOKE_OPTIONS.font.size;

  let segmentsByVoice = voices.map((voice) => withoutPeriods(voice.segments));
  const tracks = (options: KaraokeOptions): VoiceTrack[] =>
    voices.map((voice, i) => ({
      voice: voice.voice,
      segments: segmentsByVoice[i],
      // A voice's own style replaces the fitted options' font and colors.
      options: {
        ...options,
        ...(voice.style ? fittedStyle(voice.style, options) : {}),
      },
    }));
  const render = (options: KaraokeOptions): AssEvent[] =>
    joinRows(
      parseAss(
        createMultiVoiceAssFile(
          tracks(options),
          songDuration,
          song?.title ?? "",
          song?.artist ?? "",
        ),
      ).events,
    );
  const distance = distanceFrom(fileEvents);
  const score = (options: KaraokeOptions) => distance(render(options)).distance;

  const candidates: Partial<Record<FittedKey, Candidates>> = {
    ...layoutCandidates(lyricEvents, fontSize),
    ...countInCandidates(fileEvents),
    addStaggeredLines: () => [true, false],
    instrumentalThreshold: fileEvents.some(isInstrumental)
      ? instrumentalCandidates(render)
      : () => [0],
  };

  // The search starts from the hints and only leaves one for a value that renders closer.
  let options: KaraokeOptions = {
    ...styleOptions(voices[0].style),
    ...fixed,
    ...hints,
    // The import reads the title style from the file, so it is drawn with but not fitted.
    ...(titleStyle ? { titleStyle } : {}),
    useStoredDisplayPeriods: false,
  };
  const observed = new Set<FittedKey>();
  let best = score(options);
  for (let improved = true, pass = 0; improved && pass < 4; pass++) {
    improved = false;
    for (const [key, values] of Object.entries(candidates) as [FittedKey, Candidates][]) {
      const hint = key in hints ? [hints[key]] : [];
      const tried = [...new Set([...values(options), ...hint])];
      if (tried.length === 0) continue;
      // The file decides a setting it suggests a single value for.
      if (tried.length === 1) {
        observed.add(key);
        if (options[key] !== tried[0]) {
          options = { ...options, [key]: tried[0] };
          best = score(options);
          improved = true;
        }
        continue;
      }
      for (const value of tried) {
        if (value === options[key]) continue;
        const trial = { ...options, [key]: value };
        const trialScore = score(trial);
        if (trialScore !== best) {
          observed.add(key);
        }
        if (trialScore < best) {
          options = trial;
          best = trialScore;
          improved = true;
        }
      }
    }
  }

  // A line may start a page, or end one, or have spacers around it.
  // A page break breaks every voice, so only a single voice's pages are moved.
  // The display periods fix the times later, so only the heights count here,
  // and the rest of the distance breaks ties.
  const placement = () => {
    const { heights, distance: rest } = distance(render(options));
    return heights * 1e6 + rest;
  };
  let placed = placement();
  const placeLine = (i: number, index: number) => {
    const original = segmentsByVoice[i];
    const pages = [original];
    const before = original[index - 1];
    if (voices.length === 1 && before?.text.endsWith("\n")) {
      const text = before.text.endsWith("\n\n") ? before.text.slice(0, -1) : before.text + "\n";
      const broken = original.map((segment, j) =>
        j === index - 1 ? { ...segment, text } : segment,
      );
      // The page's other lines may have taken spacers to make up for the missing break.
      let pageStart = index - 1;
      while (pageStart > 0 && !original[pageStart - 1].text.endsWith("\n\n")) pageStart--;
      const unspaced = broken.map((segment, j) =>
        j >= pageStart && j < index
          ? { ...segment, spacersBefore: undefined, spacersAfter: undefined }
          : segment,
      );
      pages.push(broken, unspaced);
    }
    const spacers: Partial<TimedSegment>[] = [
      {},
      { spacersBefore: undefined, spacersAfter: undefined },
    ];
    for (let count = 1; count <= MAX_SPACERS; count++) {
      spacers.push({ spacersBefore: count }, { spacersAfter: count });
    }
    for (const page of pages) {
      for (const spacer of spacers) {
        if (page === original && spacer === spacers[0]) continue;
        const trial = page.map((segment, j) => (j === index ? { ...segment, ...spacer } : segment));
        segmentsByVoice[i] = trial;
        const trialScore = placement();
        if (trialScore < placed) {
          placed = trialScore;
          pages[0] = trial;
        }
      }
    }
    segmentsByVoice[i] = pages[0];
    return pages[0] !== original;
  };
  const pageAround = (segments: TimedSegment[], index: number) => {
    let start = index;
    while (start > 0 && !segments[start - 1].text.endsWith("\n\n")) start--;
    let end = index;
    while (end < segments.length - 1 && !segments[end].text.endsWith("\n\n")) end++;
    return { start, end: end + 1 };
  };
  // A line's height depends on the rest of its page, and on the page after it when a break
  // between them is missing. The first round only moves the misplaced lines themselves,
  // and the later ones every line around them, until nothing moves.
  for (let round = 0, moved = true; moved && round < PLACEMENT_ROUNDS; round++) {
    moved = false;
    const { misplaced } = distance(render(options));
    voices.forEach((voice, i) => {
      const heads = new Set<number>();
      for (const [index, event] of voice.events) {
        if (!misplaced.has(event)) continue;
        if (round === 0) {
          heads.add(index);
          continue;
        }
        const { start, end } = pageAround(segmentsByVoice[i], index);
        [...voice.events.keys()]
          .filter((head) => head >= start && head <= end)
          .forEach((head) => heads.add(head));
      }
      heads.forEach((head) => {
        moved = placeLine(i, head) || moved;
      });
    });
    moved ||= round === 0 && misplaced.size > 0;
  }

  // Display periods only where the automatic ones differ from the file,
  // and again where a stored period moved a neighbour's automatic one.
  options = { ...options, useStoredDisplayPeriods: true };
  for (let pass = 0; pass < 2; pass++) {
    const renders = layOutVoices(
      tracks(options),
      songDuration,
      song?.title ?? "",
      song?.artist ?? "",
    );
    segmentsByVoice = renders.map((render, i) => {
      const segments = segmentsByVoice[i].map((segment) => ({ ...segment }));
      for (const screen of render.screens.filter(({ kind }) => kind === "lyrics")) {
        for (const line of screen.lines) {
          const shown = line.headIndex !== undefined && voices[i].events.get(line.headIndex);
          if (!shown) continue;
          const head = segments[line.headIndex as number];
          const start = Math.round(
            (line.customDisplayStartTime ?? screen.startTimestamp ?? 0) * 100,
          );
          const end = Math.round((line.customDisplayEndTime ?? screen.endTimestamp) * 100);
          if (start !== shown.start) head.displayStart = (shown.start - delay) / 100;
          if (end !== shown.end) head.displayEnd = (shown.end - delay) / 100;
        }
      }
      return segments;
    });
  }
  const { mismatches } = distance(render(options));

  const stored = segmentsByVoice.some((segments) =>
    segments.some(
      (segment) => segment.displayStart !== undefined || segment.displayEnd !== undefined,
    ),
  );
  // A hint the file doesn't show is kept too, since the file says it was rendered with it.
  const kept = (Object.keys(hints) as FittedKey[]).filter((key) => options[key] === hints[key]);
  const fitted = Object.fromEntries(
    [...new Set([...observed, ...kept])].map((key) => [key, options[key]]),
  );
  return {
    options: { ...fixed, ...fitted, ...(stored ? { useStoredDisplayPeriods: true } : {}) },
    segments: Object.fromEntries(voices.map((voice, i) => [voice.voice, segmentsByVoice[i]])),
    mismatches,
  };
}

function fittedStyle(style: AssStyle, options: KaraokeOptions): Partial<KaraokeOptions> {
  const own = styleOptions(style);
  return {
    font: own.font,
    color: { ...options.color, ...own.color },
    outlineWidth: own.outlineWidth,
  };
}
