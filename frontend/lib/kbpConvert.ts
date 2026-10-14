// Conversion between a Karaoke Builder Studio project and the app's project:
// the lyrics.txt and settings.yaml text, and each voice's timed segments.
// Nothing here touches a store.

import yaml from "js-yaml";
import { SUBTITLE_CANVAS, appName } from "@/constants";
import {
  KbpDocument,
  KbpLine,
  KbpPage,
  KbpStyle,
  KbpSyllable,
  parseKbp,
  serializeKbp,
} from "./kbp";
import { displayText } from "./timing";
import { TimedSegment } from "./timedSegments";
import { DEFAULT_VOICE_ID, parseAnnotatedLyrics, TAG_PATTERN, VoiceId } from "./voices";
import { ParsedSettingsFile, parseSettingsYaml } from "./settingsFile";
import { convertSpacesToUnderscores } from "./lyrics";
import { ImportedSyllable, importedTimings, lineMarkup, voiceNames } from "./importedLyrics";
import { fontLeftOut, MARKUP_REMOVED, SPACER_PAGE_DROPPED, Warnings } from "./importWarnings";

// KBS lays out lines on a 216-high CDG canvas.
const CDG_SCALE = SUBTITLE_CANVAS.height / 216;
// kbp2ass scales a KBP font size by the output height over the CDG canvas height, and by 1.4
// for the difference between the two font size conventions.
const FONT_SCALE = CDG_SCALE * 1.4;
// kbp2ass puts a page's first line below the CDG border, and each line 19 below the one above,
// plus the file's own top margin and line spacing.
const CDG_TOP_BORDER = 12;
const CDG_LINE_HEIGHT = 19;

// KBS's own timing, as measured on its files: a line shows 3 s before its page's first syllable
// and hides 0.5 s after its own last one.
const LINE_LEAD_CS = 300;
const LINE_TAIL_CS = 50;

const MAX_STYLES = 20;
// kbputils' page size when it builds a .kbp. KBS's real limit depends on the font and margins.
const COMFORTABLE_LINES_PER_PAGE = 6;

// KBS's default palette, which fills the entries an export doesn't use.
// prettier-ignore
const DEFAULT_PALETTE = [
  "055", "FFF", "000", "E70", "940", "CFF", "033", "0DD",
  "077", "FCF", "303", "F3F", "818", "000", "FFF", "000",
];

export const COUNT_INS_OFF =
  "Count-ins and instrumental screens were turned off, since a KBS project has its own in the lyrics";

export interface ProjectFiles {
  lyrics: string;
  timings: Record<VoiceId, TimedSegment[]>;
  settings: string;
}

export interface KbpImport extends ProjectFiles {
  // The basename of the song the project was made with, which the .kbp doesn't carry.
  audioName: string | null;
  warnings: string[];
}

export interface KbpExportSource extends ProjectFiles {
  audioName: string | null;
}

export interface KbpExport {
  kbp: string;
  warnings: string[];
}

function toHexColor(kbpColor: string): string {
  return "#" + [...kbpColor.toUpperCase()].map((digit) => digit + digit).join("");
}

function toKbpColor(hexColor: string): string {
  const channels = hexColor.replace("#", "").match(/../g) ?? ["00", "00", "00"];
  return channels
    .map((channel) => Math.round(parseInt(channel, 16) / 17).toString(16))
    .join("")
    .toUpperCase();
}

function basename(path: string): string | null {
  const name = path.split(/[\\/]/).pop()?.trim();
  return name ? name : null;
}

function styleFor(document: KbpDocument, letter: string, warnings: Warnings): KbpStyle {
  const number = letter.toUpperCase().charCodeAt(0) - "A".charCodeAt(0);
  const style = document.styles.find((s) => s.number === number);
  if (style) {
    return style;
  }
  warnings.add(`Lines in an undefined style ${letter.toUpperCase()} use Style00`);
  return document.styles.find((s) => s.number === 0) ?? document.styles[0];
}

/**
 * The line's syllables as segment words. Spaces around a syllable become word boundaries,
 * and characters that are lyric markup in the app are removed.
 */
function importSyllables(line: KbpLine, style: KbpStyle, warnings: Warnings): ImportedSyllable[] {
  const fixed = line.style === line.style.toLowerCase();
  const syllables: ImportedSyllable[] = [];

  line.syllables.forEach((syllable: KbpSyllable) => {
    let text = syllable.text;
    if (/[/_|]/.test(text)) {
      warnings.add(MARKUP_REMOVED);
      text = text.replace(/[/_|]/g, "");
    }
    if (style.uppercase) {
      text = text.toUpperCase();
    }

    const word = text.trim();
    const previous = syllables[syllables.length - 1];
    if (previous && /^\s/.test(text)) {
      previous.wordEnd = true;
    }
    if (word === "") {
      return;
    }
    syllables.push({
      word,
      wordEnd: /\s$/.test(text),
      ...(fixed ? {} : { start: syllable.start, end: syllable.end }),
    });
  });

  if (fixed && syllables.length > 0) {
    warnings.add("A fixed line was imported untimed, since the app has no text without a wipe");
  } else if (syllables.length > 0) {
    syllables[0].displayStart = line.start / 100;
    syllables[0].displayEnd = line.end / 100;
  }
  return syllables;
}

/**
 * A line whose syllables hold no text is a blank spacer line.
 */
function isSpacer(line: KbpLine): boolean {
  return line.syllables.every((syllable) => syllable.text.replace(/[/_|]/g, "").trim() === "");
}

/**
 * KBS always writes an end, usually at the next start or 1 cs before it.
 * Such an end is left open, or the renderer would draw a 1 cs gap between the two syllables.
 */
function toSegmentTimes(syllables: ImportedSyllable[]): void {
  const timed = syllables.filter((s) => s.start !== undefined);
  timed.forEach((syllable, i) => {
    const next = timed[i + 1];
    const start = syllable.start as number;
    const end = syllable.end as number;
    const open = next !== undefined && end >= (next.start as number) - 1;
    syllable.start = start / 100;
    syllable.end = open || end <= start ? undefined : end / 100;
  });
}

function styleSettings(
  document: KbpDocument,
  base: KbpStyle | undefined,
  voiceStyles: [VoiceId, KbpStyle][],
  fonts: string[],
  warnings: Warnings,
): Record<string, unknown> {
  const color = (index: number) => toHexColor(document.palette[index] ?? "000");
  const fontName = (style: KbpStyle): string | undefined => {
    if (fonts.includes(style.fontName)) {
      return style.fontName;
    }
    warnings.add(fontLeftOut(style.fontName));
    return undefined;
  };
  const fontSize = (style: KbpStyle) => Math.round(style.fontSize * FONT_SCALE);

  // A KBS author types count-ins and instrumental breaks into the lyrics, in any characters,
  // so the app's own would duplicate them.
  const videoOptions: Record<string, unknown> = {
    countInMode: "none",
    instrumentalThreshold: 0,
    // KBS anchors a page's lines to the top of the screen, and its spacers push them down from there.
    verticalAlignment: "top",
    color: { background: color(0) },
  };
  warnings.add(COUNT_INS_OFF);
  if (base) {
    const size = fontSize(base);
    const [, , top, spacing] = document.margins;
    const multiple = (cdg: number) => Math.round(((cdg * CDG_SCALE) / size) * 1000) / 1000;
    if (spacing !== undefined) {
      videoOptions.lineSpacing = multiple(spacing + CDG_LINE_HEIGHT);
    }
    if (top !== undefined) {
      videoOptions.topMargin = multiple(top + CDG_TOP_BORDER);
    }
    const name = fontName(base);
    videoOptions.font = {
      ...(name ? { name } : {}),
      size: fontSize(base),
      bold: base.fontStyle.includes("B"),
      italic: base.fontStyle.includes("I"),
    };
    videoOptions.color = {
      background: color(0),
      primary: color(base.colors[2]),
      secondary: color(base.colors[0]),
      outline: color(base.colors[1]),
    };
  }

  const overrides: Record<VoiceId, Record<string, unknown>> = {};
  for (const [voice, style] of voiceStyles) {
    if (!base || style === base) continue;
    const override: Record<string, unknown> = {};
    const name = style.fontName !== base.fontName ? fontName(style) : undefined;
    if (name) override.fontName = name;
    if (style.fontSize !== base.fontSize) override.fontSize = fontSize(style);
    const bold = style.fontStyle.includes("B");
    const italic = style.fontStyle.includes("I");
    if (bold !== base.fontStyle.includes("B")) override.bold = bold;
    if (italic !== base.fontStyle.includes("I")) override.italic = italic;
    if (style.colors[2] !== base.colors[2]) override.primary = color(style.colors[2]);
    if (style.colors[0] !== base.colors[0]) override.secondary = color(style.colors[0]);
    if (style.colors[1] !== base.colors[1]) override.outline = color(style.colors[1]);
    if (Object.keys(override).length > 0) overrides[voice] = override;
  }

  return { videoOptions, voiceStyles: overrides };
}

function settingsYaml(document: KbpDocument, styles: Record<string, unknown>): string {
  const song: Record<string, string> = {};
  if (document.trackInfo.Title) song.title = document.trackInfo.Title;
  if (document.trackInfo.Artist) song.artist = document.trackInfo.Artist;
  return yaml.dump({ song, ...styles });
}

function unsyncedLyrics(lines: string[]): string {
  return lines
    .map((line) => convertSpacesToUnderscores(line.trimEnd()))
    .join("\n")
    .trim();
}

/**
 * Throws when the file isn't a KBS project, or when the converter would produce timings that don't
 * line up with the lyrics it produced.
 */
export function kbpToProjectFiles(text: string, options: { fonts: string[] }): KbpImport {
  const document = parseKbp(text);
  const warnings = new Warnings();
  const audioName = basename(document.trackInfo.Audio ?? "");

  if (document.pages.some((page) => page.transition !== null)) {
    warnings.add("Page transitions were dropped");
  }
  if (document.images.length > 0) {
    warnings.add("The background slideshow was dropped");
  }
  if (document.mods !== null) {
    warnings.add("Pitch and speed changes were dropped");
  }

  // Styles in the order lines first use them. A spacer's style is ignored.
  const used: KbpStyle[] = [];
  const pages = document.pages.map((page) =>
    page.lines.map((line) => {
      if (isSpacer(line)) {
        return { line, style: null };
      }
      const style = styleFor(document, line.style, warnings);
      if (!used.includes(style)) used.push(style);
      if (line.align !== "C" || line.right !== 0 || line.down !== 0 || line.rotation !== 0) {
        warnings.add("Line positions were dropped, since the app lays out its own screens");
      }
      return { line, style };
    }),
  );
  const names = voiceNames(
    used.map((style) => style.name),
    (i) => `Style ${used[i].number}`,
  );
  const multiVoice = used.length > 1;
  const voiceOf = (style: KbpStyle): VoiceId =>
    multiVoice ? names[used.indexOf(style)] : DEFAULT_VOICE_ID;

  const pageTexts: string[] = [];
  const syllablesByVoice: Record<VoiceId, ImportedSyllable[]> = {};
  let previousVoice: VoiceId | null = null;
  for (const lines of pages) {
    const imported = lines.map(({ line, style }) => {
      if (!style) {
        return null;
      }
      const syllables = importSyllables(line, style, warnings);
      const markup = lineMarkup(syllables, warnings);
      return { voice: voiceOf(style), markup, syllables };
    });
    const voices = imported.flatMap((entry) => (entry ? [entry.voice] : []));
    if (voices.length === 0) {
      if (lines.length > 0) {
        warnings.add(SPACER_PAGE_DROPPED);
      }
      continue;
    }

    const lineTexts: string[] = [];
    imported.forEach((entry, i) => {
      // A spacer pushes down the lines below it, so it joins the voice of the next one.
      const voice =
        entry?.voice ??
        imported.slice(i).find((next) => next)?.voice ??
        (voices[voices.length - 1] as VoiceId);
      let markup = entry?.markup ?? "/";
      if (multiVoice && voice !== previousVoice) {
        markup = `[${voice}] ${markup}`;
      }
      previousVoice = voice;
      lineTexts.push(markup);
      if (entry) {
        (syllablesByVoice[voice] ??= []).push(...entry.syllables);
      }
    });
    pageTexts.push(lineTexts.join("\n"));
  }

  const lyrics = document.unsyncedLyrics
    ? unsyncedLyrics(document.unsyncedLyrics)
    : pageTexts.join("\n\n");

  for (const syllables of Object.values(syllablesByVoice)) {
    toSegmentTimes(syllables);
  }
  const timings = importedTimings(lyrics, syllablesByVoice, warnings);

  const base =
    used.find((s) => s.number === 0) ?? used[0] ?? document.styles.find((s) => s.number === 0);
  const styles = styleSettings(
    document,
    base,
    used.map((style) => [voiceOf(style), style]),
    options.fonts,
    warnings,
  );

  return {
    lyrics,
    timings,
    settings: settingsYaml(document, styles),
    audioName,
    warnings: warnings.list(),
  };
}

interface ExportStyle {
  fontName: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  text: string;
  wipe: string;
  outline: string;
}

interface ExportLine {
  voiceIndex: number;
  // A spacer has none.
  syllables: KbpSyllable[];
  displayStart?: number;
  displayEnd?: number;
}

interface ExportPage {
  lines: ExportLine[];
  first: number;
  last: number;
}

function exportStyles(
  { videoOptions, voiceStyles = {} }: ParsedSettingsFile,
  voices: VoiceId[],
): ExportStyle[] {
  const base: ExportStyle = {
    fontName: videoOptions.font?.name ?? "Arial",
    fontSize: videoOptions.font?.size ?? 20,
    // The app draws bold unless told otherwise.
    bold: videoOptions.font?.bold ?? true,
    italic: videoOptions.font?.italic ?? false,
    text: videoOptions.color?.secondary?.toString() ?? "#00FFFF",
    wipe: videoOptions.color?.primary?.toString() ?? "#FF00FF",
    // Files written before the outline had its own color drew it in the background color.
    outline:
      videoOptions.color?.outline?.toString() ??
      videoOptions.color?.background?.toString() ??
      "#000000",
  };
  const styles = voices.map((voice): ExportStyle => {
    const o = voiceStyles[voice] ?? {};
    return {
      fontName: o.fontName ?? base.fontName,
      fontSize: o.fontSize ?? base.fontSize,
      bold: o.bold ?? base.bold,
      italic: o.italic ?? base.italic,
      text: o.secondary?.toString() ?? base.text,
      wipe: o.primary?.toString() ?? base.wipe,
      outline: o.outline?.toString() ?? base.outline,
    };
  });
  return styles.length > 0 ? styles : [base];
}

/**
 * Entry 0 is the screen background.
 */
class Palette {
  colors: string[];
  private full = false;

  constructor(
    background: string,
    private warnings: Warnings,
  ) {
    this.colors = [toKbpColor(background)];
  }

  indexOf(hexColor: string): number {
    const color = toKbpColor(hexColor);
    const found = this.colors.indexOf(color);
    if (found !== -1) {
      return found;
    }
    if (this.colors.length < 16) {
      this.colors.push(color);
      return this.colors.length - 1;
    }
    if (!this.full) {
      this.full = true;
      this.warnings.add("The styles use more than 16 colours, so some take the nearest one");
    }
    return this.nearest(color);
  }

  private nearest(color: string): number {
    const rgb = (c: string) => [...c].map((d) => parseInt(d, 16));
    const target = rgb(color);
    let best = 0;
    let bestDistance = Infinity;
    this.colors.forEach((candidate, i) => {
      const distance = rgb(candidate).reduce((sum, v, k) => sum + (v - target[k]) ** 2, 0);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    return best;
  }

  entries(): string[] {
    return [...this.colors, ...DEFAULT_PALETTE.slice(this.colors.length)];
  }
}

/**
 * A voice's timed segments grouped into pages of lines by their separators.
 * Untimed segments are left out, and an open end runs to 1 cs before the next start, as KBS writes it.
 * A line's display period and spacers come from its first segment, timed or not.
 */
function voicePages(
  segments: TimedSegment[],
  voiceIndex: number,
  durationCs: number | null,
): ExportPage[] {
  const pages: ExportPage[] = [];
  let lines: ExportLine[] = [];
  let syllables: KbpSyllable[] = [];
  let head: TimedSegment | undefined;
  const all: { syllable: KbpSyllable; end?: number }[] = [];
  const cs = (seconds: number | undefined) =>
    seconds === undefined ? undefined : Math.round(seconds * 100);

  const spacers = (count: number | undefined) => {
    for (let i = 0; i < (count ?? 0); i++) {
      lines.push({ voiceIndex, syllables: [] });
    }
  };
  const closeLine = (endsPage: boolean) => {
    spacers(head?.spacersBefore);
    if (syllables.length > 0) {
      const last = syllables[syllables.length - 1];
      last.text = last.text.trimEnd();
      lines.push({
        voiceIndex,
        syllables,
        displayStart: cs(head?.displayStart),
        displayEnd: cs(head?.displayEnd),
      });
    }
    if (endsPage) {
      spacers(head?.spacersAfter);
    }
    syllables = [];
    head = undefined;
  };
  const closePage = () => {
    closeLine(true);
    if (lines.some((line) => line.syllables.length > 0)) {
      pages.push({ lines, first: 0, last: 0 });
    }
    lines = [];
  };

  for (const segment of segments) {
    head ??= segment;
    // KBS lays its lines out on its own screen, so a row break draws as the separator it carries.
    const text = displayText(segment.text.replace(/\n+$/, ""));
    if (segment.start !== undefined && text.trim() !== "") {
      const syllable: KbpSyllable = {
        text,
        start: Math.round(segment.start * 100),
        end: 0,
        wipe: 0,
      };
      syllables.push(syllable);
      all.push({
        syllable,
        end: segment.end === undefined ? undefined : Math.round(segment.end * 100),
      });
    }
    if (segment.text.endsWith("\n\n")) {
      closePage();
    } else if (segment.text.endsWith("\n")) {
      closeLine(false);
    }
  }
  closePage();

  all.forEach(({ syllable, end }, i) => {
    const next = all[i + 1]?.syllable.start;
    if (next !== undefined) {
      syllable.end = end !== undefined && end < next ? end : Math.max(next - 1, syllable.start);
    } else {
      syllable.end =
        end ??
        (durationCs !== null && durationCs > syllable.start ? durationCs : syllable.start + 100);
    }
  });

  for (const page of pages) {
    const pageSyllables = page.lines.flatMap((line) => line.syllables);
    page.first = Math.min(...pageSyllables.map((s) => s.start));
    page.last = Math.max(...pageSyllables.map((s) => s.end));
  }
  return pages;
}

/**
 * Pages of different voices that overlap in time share one KBS page, with each voice's lines kept together.
 */
function mergePages(pages: ExportPage[]): ExportPage[] {
  const sorted = [...pages].sort((a, b) => a.first - b.first);
  const merged: ExportPage[] = [];
  for (const page of sorted) {
    const current = merged[merged.length - 1];
    if (current && page.first <= current.last) {
      current.lines.push(...page.lines);
      current.last = Math.max(current.last, page.last);
    } else {
      merged.push({ ...page, lines: [...page.lines] });
    }
  }
  // The sort is stable, so each voice's lines, spacers included, keep their order.
  for (const page of merged) {
    page.lines.sort((a, b) => a.voiceIndex - b.voiceIndex);
  }
  return merged;
}

/**
 * A line shows 3 s before its page starts, or once the line in its slot on the previous page has gone,
 * whichever is later, and never after its own first syllable.
 * A stored display period replaces those rules, widened to contain the line's syllables.
 * A spacer is written as KBS writes one, with every time at zero.
 */
function layOutLines(pages: ExportPage[]): KbpPage[] {
  let previous: KbpLine[] = [];
  return pages.map((page) => {
    const lines = page.lines.map((line, slot): KbpLine => {
      const style = String.fromCharCode(
        "A".charCodeAt(0) + Math.min(line.voiceIndex, MAX_STYLES - 1),
      );
      if (line.syllables.length === 0) {
        return {
          align: "C",
          style,
          start: 0,
          end: 0,
          right: 0,
          down: 0,
          rotation: 0,
          syllables: [{ text: "", start: 0, end: 0, wipe: 0 }],
        };
      }
      const first = line.syllables[0].start;
      const last = line.syllables[line.syllables.length - 1].end;
      // A slot the previous page leaves empty, or holds a spacer in, has gone when its last line has.
      const shown = previous.filter((other) => !isSpacer(other));
      const inSlot = previous[slot];
      const before = inSlot && !isSpacer(inSlot) ? inSlot : shown[shown.length - 1];
      const start = Math.min(
        first,
        line.displayStart ?? Math.max(0, page.first - LINE_LEAD_CS, before ? before.end + 1 : 0),
      );
      const end =
        line.displayEnd === undefined ? last + LINE_TAIL_CS : Math.max(line.displayEnd, last);
      return {
        align: "C",
        style,
        start,
        end,
        right: 0,
        down: 0,
        rotation: 0,
        syllables: line.syllables,
      };
    });
    previous = lines;
    return { transition: null, lines };
  });
}

export function projectFilesToKbp(source: KbpExportSource): KbpExport {
  const warnings = new Warnings();
  const settings = parseSettingsYaml(source.settings);
  const { song } = settings;
  const voices = parseAnnotatedLyrics(source.lyrics).voices;
  const styles = exportStyles(settings, voices);
  if (voices.length > MAX_STYLES) {
    warnings.add(
      `KBS allows ${MAX_STYLES} styles, so voices past the ${MAX_STYLES}th share the last one`,
    );
  }

  const palette = new Palette(
    settings.videoOptions.color?.background?.toString() ?? "#000000",
    warnings,
  );
  const kbpStyles: KbpStyle[] = styles.slice(0, MAX_STYLES).map((style, number) => {
    const outline = palette.indexOf(style.outline);
    return {
      number,
      name: (voices[number] ?? "Default").replace(/,/g, " "),
      colors: [palette.indexOf(style.text), outline, palette.indexOf(style.wipe), outline],
      fontName: style.fontName,
      fontSize: Math.max(1, Math.round(style.fontSize / FONT_SCALE)),
      fontStyle: (style.bold ? "B" : "") + (style.italic ? "I" : ""),
      charset: 0,
      outlines: [2, 2, 2, 2],
      shadows: [0, 0],
      wipeStyle: 0,
      uppercase: false,
    };
  });

  const durationCs = song.duration ? Math.round(song.duration * 100) : null;
  const pages = mergePages(
    voices.flatMap((voice, i) => voicePages(source.timings[voice] ?? [], i, durationCs)),
  );
  if (pages.some((page) => page.lines.length > COMFORTABLE_LINES_PER_PAGE)) {
    warnings.add(
      `Some pages have more than ${COMFORTABLE_LINES_PER_PAGE} lines, which may not fit on a KBS screen`,
    );
  }

  const synced = pages.length > 0;
  const document: KbpDocument = {
    palette: palette.entries(),
    styles: kbpStyles,
    margins: [2, 2, 7, 12],
    other: [0, 2],
    trackInfo: {
      Status: synced ? "1" : "0",
      Title: song.title ?? "",
      Artist: song.artist ?? "",
      Audio: source.audioName ?? "",
      BuildFile: "",
      Intro: "",
      Outro: "",
      Comments: `Exported from ${appName()}`,
    },
    pages: synced ? layOutLines(pages) : [],
    unsyncedLyrics: synced
      ? null
      : source.lyrics
          .split("\n")
          .map((line) =>
            line.replace(TAG_PATTERN, "").replace(/\/\|/g, "/").replace(/[_|]+/g, " "),
          ),
    images: [],
    mods: null,
  };
  return { kbp: serializeKbp(document), warnings: warnings.list() };
}
