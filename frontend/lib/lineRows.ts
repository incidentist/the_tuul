// Breaking each line of a screen into rows.
// This turns a line's segments into the measured pieces lineWrap.ts chooses rows from,
// and turns its choice back into segments, splitting a syllable when a row starts inside it.

import { SUBTITLE_CANVAS } from "@/constants";
import { mayGetOverlappingCountIn, overlappingCountInText } from "./adjustments";
import { CJK_CHAR } from "./fonts";
import { Boundary, chooseRows, Piece } from "./lineWrap";
import { FontLibrary } from "./textWidth";
import { KaraokeOptions, LyricSegment, LyricsLine, LyricsScreen } from "./timing";
import { outlineDrawn, shadowDrawn } from "./voiceStyle";

const CJK = new RegExp(`^${CJK_CHAR}$`, "u");
// CJK punctuation and small kana don't start a row, and opening brackets don't end one.
const NO_ROW_START =
  /^[、。，．！？：；」』）〕】〉》ー々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ…‥]$/u;
const NO_ROW_END = /^[「『（〔【〈《]$/u;
// The end of a clause, which closing quotes and brackets may follow.
const CLAUSE_END = /[,;:.!?…—–、。，！？][\p{Pe}\p{Pf}"']*$/u;
const CLAUSE_START = /^[\p{Ps}\p{Pi}"]/u;

// A piece of a line, and the part of one segment's text it is made of.
interface Draft {
  segment: number;
  from: number;
  // Where the drawn text ends and the whitespace after it starts.
  bodyEnd: number;
  to: number;
  after: Boundary;
}

// What a row leaves clear on top of its measured ink, in font sizes.
// Measured ink fell short of libass's by at most 0.06 of the font size,
// and this adds 1% of the canvas at the default size.
const ROW_MARGIN = 0.25;

/**
 * How wide a row's ink may span in these options, in canvas units,
 * so that its outline and shadow stay inside the frame too.
 */
export function rowBudget(options: KaraokeOptions): number {
  const outline = outlineDrawn(options) ? options.outlineWidth : 0;
  const shadow = shadowDrawn(options) ? Math.abs(options.shadowX) : 0;
  return SUBTITLE_CANVAS.width - ROW_MARGIN * options.font.size - 2 * outline - shadow;
}

/**
 * Break every line of the lyrics and title screens into rows,
 * and move the lines below a line with several rows down by its extra rows.
 */
export function wrapScreens(
  screens: LyricsScreen[],
  options: KaraokeOptions,
  titleOptions: KaraokeOptions,
  fonts: FontLibrary,
): void {
  for (const screen of screens.filter(({ kind }) => kind !== "instrumental")) {
    const style = screen.kind === "title" ? titleOptions : options;
    const slots = screen.slots;
    let extraRows = 0;
    screen.lines.forEach((line, i) => {
      // The first row leaves room for the count-in mark the line may get once rows are chosen.
      const reserved =
        screen.kind === "lyrics" && mayGetOverlappingCountIn(line, i, options)
          ? overlappingCountInText(options)
          : "";
      wrapLine(line, style, fonts, reserved);
      line.slot = screen.slotOf(i) + extraRows;
      extraRows += line.rowCount - 1;
    });
    screen.slotCount = slots + extraRows;
  }
}

/**
 * Mark the segments that start the line's rows, splitting a segment where a row starts inside it.
 * `reserved` is text the line's first row leaves room for.
 */
function wrapLine(
  line: LyricsLine,
  options: KaraokeOptions,
  fonts: FontLibrary,
  reserved: string,
): void {
  const { segments } = line;
  const drafts = draftsOf(segments);
  if (drafts.length === 0) {
    return;
  }
  const texts = drafts.map(({ segment, from, bodyEnd, to }) => {
    const text = segments[segment].text;
    return { body: text.slice(from, bodyEnd), space: text.slice(bodyEnd, to) };
  });
  const [reservation, ...extents] = fonts.measure(
    [reserved, ...texts.flatMap(({ body, space }) => [body, space])],
    options.font.name,
    options.font.size,
  );
  const pieces: Piece[] = drafts.map((draft, i) => {
    const body = extents[2 * i];
    // The reserved text goes before the first piece.
    const shift = i === 0 ? reservation.width : 0;
    return {
      width: body.width + shift,
      space: extents[2 * i + 1].width,
      inkBefore: Math.max(i === 0 ? reservation.before : 0, body.before - shift),
      inkAfter: body.after,
      after: draft.after,
      clause: CLAUSE_END.test(texts[i].body) || CLAUSE_START.test(texts[i + 1]?.body ?? ""),
    };
  });
  const rowStarts = chooseRows(pieces, rowBudget(options)).map((i) => drafts[i]);
  if (rowStarts.length === 0) {
    return;
  }

  line.segments = segments.flatMap((segment, index) => {
    const starts = rowStarts.filter((draft) => draft.segment === index);
    if (starts.length === 0) {
      return [segment];
    }
    // Each part sweeps for its share of the syllable's width, so the sweep keeps its pace.
    const own = drafts.flatMap((draft, i) => (draft.segment === index ? [i] : []));
    const widthBefore = (offset: number) =>
      own
        .filter((i) => drafts[i].from < offset)
        .reduce((sum, i) => sum + pieces[i].width + pieces[i].space, 0);
    const width = widthBefore(Infinity);
    const share = (offset: number) =>
      width > 0 ? widthBefore(offset) / width : offset / segment.text.length;
    return splitSegment(
      segment,
      starts.map((draft) => draft.from),
      share,
    );
  });
}

/**
 * The segment cut at each offset, each part starting a row.
 * A part at offset 0 is the segment itself.
 * `share` gives the part of the segment's duration before an offset.
 */
function splitSegment(
  segment: LyricSegment,
  offsets: number[],
  share: (offset: number) => number,
): LyricSegment[] {
  const start = segment.timestamp;
  const duration = (segment.endTimestamp ?? start) - start;
  const cuts = [0, ...offsets.filter((offset) => offset > 0), segment.text.length];
  const parts = cuts.slice(0, -1).map((cut, i) => {
    const part = new LyricSegment(
      segment.text.slice(cut, cuts[i + 1]),
      start + duration * share(cut),
      start + duration * (i === cuts.length - 2 ? 1 : share(cuts[i + 1])),
      segment.countIn,
    );
    part.rowStart = i === 0 ? segment.rowStart : "wrapInSyllable";
    return part;
  });
  if (offsets.includes(0)) {
    parts[0].rowStart ??= "wrap";
  }
  return parts;
}

/**
 * The line cut into pieces: its words, and its CJK characters, which may wrap between each other.
 * A count-in, or a segment with override tags, is a single piece.
 * A count-in never wraps from what follows it.
 */
function draftsOf(segments: LyricSegment[]): Draft[] {
  const drafts: Draft[] = [];
  let previous = "";
  segments.forEach(({ text, countIn, rowStart }, segment) => {
    const last = drafts[drafts.length - 1];
    // A row break ends the piece before the segment's first one, whatever separates them.
    const firstDraft = drafts.length;
    const breakBefore = () => {
      if (rowStart === "break" && firstDraft > 0) {
        drafts[firstDraft - 1].after = "break";
      }
    };
    if (countIn || text.includes("{")) {
      if (last && last.after === "none" && last.to > last.bodyEnd) {
        last.after = "wrap";
      }
      breakBefore();
      const bodyEnd = countIn ? text.length : text.trimEnd().length;
      drafts.push({ segment, from: 0, bodyEnd, to: text.length, after: "none" });
      previous = "";
      return;
    }
    let offset = 0;
    // Whitespace that starts a segment belongs to no piece, but still separates two words.
    let leadingSpace = false;
    for (const char of text) {
      const current = drafts[drafts.length - 1];
      const at = offset;
      offset += char.length;
      if (/\s/.test(char)) {
        if (current?.segment === segment) {
          current.to = offset;
        } else {
          leadingSpace = true;
        }
        continue;
      }
      const spaced = leadingSpace || (current !== undefined && current.to > current.bodyEnd);
      leadingSpace = false;
      const continues = current?.segment === segment && !spaced && !wrapsBetween(previous, char);
      if (continues) {
        current.bodyEnd = current.to = offset;
      } else {
        if (current && current.after === "none") {
          const countIn = segments[current.segment].countIn;
          current.after = !countIn && (spaced || wrapsBetween(previous, char)) ? "wrap" : "none";
        }
        if (drafts.length === firstDraft) {
          breakBefore();
        }
        drafts.push({ segment, from: at, bodyEnd: offset, to: offset, after: "none" });
      }
      previous = char;
    }
  });
  return drafts;
}

/**
 * Whether a row may wrap between two characters with no space between them.
 */
function wrapsBetween(before: string, after: string): boolean {
  return (
    CJK.test(before) && CJK.test(after) && !NO_ROW_START.test(after) && !NO_ROW_END.test(before)
  );
}
