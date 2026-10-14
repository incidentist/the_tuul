// Reading an Advanced SubStation Alpha subtitle file.
// This module knows the file layout only. What its content means to the app lives in assConvert.ts.

export interface AssStyle {
  name: string;
  fontName: string;
  fontSize: number;
  // "#RRGGBB". The app draws every color opaque, so the alpha is dropped.
  primary: string;
  secondary: string;
  outline: string;
  back: string;
  bold: boolean;
  italic: boolean;
  outlineWidth: number;
}

export interface AssEvent {
  comment: boolean;
  // Centiseconds.
  start: number;
  end: number;
  style: string;
  // The actor.
  name: string;
  marginV: number;
  effect: string;
  text: string;
}

export interface AssDocument {
  info: Record<string, string>;
  // The `;` lines of [Script Info], without the `;`.
  comments: string[];
  styles: AssStyle[];
  events: AssEvent[];
}

export interface AssSyllable {
  // Centiseconds from the event's start.
  start: number;
  duration: number;
  // The drawn text. Override tags and drawings are removed, hard spaces become spaces,
  // and hard line breaks become newlines.
  text: string;
  // The syllable's override tags other than its karaoke tag, each with its backslash.
  tags: string[];
}

export interface AssKaraoke {
  // Without karaoke tags, the whole text is a single syllable at the event's start.
  timed: boolean;
  syllables: AssSyllable[];
  // Whether the text holds override tags other than karaoke tags.
  formatted: boolean;
}

const DEFAULT_STYLE_FORMAT =
  "Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding";
const DEFAULT_EVENT_FORMAT =
  "Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";

function formatFields(format: string): string[] {
  return format.split(",").map((field) => field.trim().toLowerCase());
}

/**
 * The row's values by lowercased field name.
 * The last field takes the rest of the row, since an event's text may hold commas.
 */
function readRow(fields: string[], row: string): Record<string, string> {
  const values: Record<string, string> = {};
  let rest = row;
  fields.forEach((field, i) => {
    if (i === fields.length - 1) {
      values[field] = rest;
      return;
    }
    const comma = rest.indexOf(",");
    values[field] = (comma < 0 ? rest : rest.slice(0, comma)).trim();
    rest = comma < 0 ? "" : rest.slice(comma + 1);
  });
  return values;
}

/**
 * H:MM:SS.cc in centiseconds.
 */
export function parseTimecode(timecode: string): number {
  const match = timecode.trim().match(/^(\d+):(\d+):(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`"${timecode}" isn't a time.`);
  }
  const [, hours, minutes, seconds, fraction = ""] = match;
  const wholeSeconds = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  return wholeSeconds * 100 + Math.round(Number(`0.${fraction || "0"}`) * 100);
}

/**
 * An ASS color, `&HAABBGGRR` or a decimal integer in that layout, as "#RRGGBB".
 */
export function parseColor(value: string): string {
  const trimmed = value.trim().replace(/&$/, "");
  const hex = trimmed.match(/^&H([0-9a-f]+)$/i);
  const number = hex ? parseInt(hex[1], 16) : parseInt(trimmed, 10);
  const bgr = Number.isNaN(number) ? 0 : number;
  const channel = (shift: number) => ((bgr >>> shift) & 0xff).toString(16).padStart(2, "0");
  return `#${channel(0)}${channel(8)}${channel(16)}`.toUpperCase();
}

function readStyle(values: Record<string, string>): AssStyle {
  const number = (key: string) => Number(values[key]) || 0;
  return {
    name: values.name ?? "",
    fontName: values.fontname ?? "",
    fontSize: number("fontsize"),
    primary: parseColor(values.primarycolour ?? ""),
    secondary: parseColor(values.secondarycolour ?? ""),
    outline: parseColor(values.outlinecolour ?? values.tertiarycolour ?? ""),
    back: parseColor(values.backcolour ?? ""),
    // ASS writes -1 for on, and some editors write a font weight instead.
    bold: number("bold") !== 0,
    italic: number("italic") !== 0,
    outlineWidth: number("outline"),
  };
}

function readEvent(kind: string, values: Record<string, string>): AssEvent {
  return {
    comment: kind === "comment",
    start: parseTimecode(values.start ?? ""),
    end: parseTimecode(values.end ?? ""),
    style: (values.style ?? "").replace(/^\*/, ""),
    name: values.name ?? "",
    marginV: Number(values.marginv) || 0,
    effect: values.effect ?? "",
    text: values.text ?? "",
  };
}

/**
 * Throws when the text has no [Events] section, or when an event's times can't be read.
 */
export function parseAss(text: string): AssDocument {
  const document: AssDocument = { info: {}, comments: [], styles: [], events: [] };
  let section = "";
  let styleFields = formatFields(DEFAULT_STYLE_FORMAT);
  let eventFields = formatFields(DEFAULT_EVENT_FORMAT);
  let sawEvents = false;

  for (const rawLine of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = line.match(/^\[(.+)\]$/);
    if (header) {
      section = header[1].trim().toLowerCase();
      sawEvents ||= section === "events";
      continue;
    }
    if (section === "script info" && line.startsWith(";")) {
      document.comments.push(line.slice(1).trim());
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 0) {
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).replace(/^ /, "");
    const kind = key.toLowerCase();
    if (section === "script info") {
      document.info[key] = value.trim();
    } else if (section.endsWith("styles")) {
      if (kind === "format") styleFields = formatFields(value);
      if (kind === "style") document.styles.push(readStyle(readRow(styleFields, value)));
    } else if (section === "events") {
      if (kind === "format") eventFields = formatFields(value);
      if (kind === "dialogue" || kind === "comment") {
        document.events.push(readEvent(kind, readRow(eventFields, value)));
      }
    }
  }

  if (!sawEvents) {
    throw new Error("This isn't an ASS subtitle file: it has no [Events] section.");
  }
  return document;
}

/**
 * The event text split at its karaoke tags. A tag's duration runs from the end of the one before,
 * so a syllable with no text is a pause.
 * Text before the first karaoke tag is a syllable of no duration at the event's start.
 */
export function parseKaraoke(text: string): AssKaraoke {
  const syllables: AssSyllable[] = [];
  const leading: AssSyllable = { start: 0, duration: 0, text: "", tags: [] };
  let current = leading;
  let clock = 0;
  let drawing = false;
  let timed = false;
  let formatted = false;

  for (const [, block, chunk] of text.matchAll(/\{([^}]*)\}?|([^{]+)/g)) {
    if (chunk !== undefined) {
      if (!drawing) {
        current.text += chunk.replace(/\\[Nn]/g, "\n").replace(/\\h/g, " ");
      }
      continue;
    }
    // Text in braces before the first backslash is a comment.
    for (const tag of block.split("\\").slice(1)) {
      const karaoke = tag.match(/^(?:k[fo]?|K)(\d+(?:\.\d+)?)/);
      const draw = tag.match(/^p(\d+)$/);
      if (karaoke) {
        timed = true;
        current = { start: clock, duration: Math.round(Number(karaoke[1])), text: "", tags: [] };
        clock += current.duration;
        syllables.push(current);
      } else if (draw) {
        drawing = Number(draw[1]) > 0;
      } else if (tag.trim() !== "") {
        formatted = true;
        current.tags.push(`\\${tag.trim()}`);
      }
    }
  }

  if (!timed) {
    return { timed, syllables: [leading], formatted };
  }
  if (leading.text.trim() !== "") {
    syllables.unshift(leading);
  }
  return { timed, syllables, formatted };
}
