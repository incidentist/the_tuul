import { cffInkSpans, InkSpan } from "./cff";
import { FALLBACK_FONTS } from "./fonts";

// libass matches an ASS style's `Fontname` against the family name stored inside the font, not against the file's name,
// both in the browser preview and in FFmpeg's ass filter.

// Family name IDs from the OpenType `name` table, preferred first: 16 is the typographic family, 1 the legacy one,
// which on multi-style fonts carries a split-out name like "Metal Mania Semibold".
const FAMILY_NAME_IDS = [16, 1];
// The full name, such as "Noto Sans Bold Italic", by which libass picks one face of a family.
// libass matches the PostScript name (ID 6) only on fonts with CFF outlines, so it can't stand in.
const FULL_NAME_ID = 4;

const PLATFORM_UNICODE = 0;
const PLATFORM_MACINTOSH = 1;
const PLATFORM_WINDOWS = 3;
const PLATFORM_PREFERENCE = [PLATFORM_WINDOWS, PLATFORM_UNICODE, PLATFORM_MACINTOSH];

const SFNT_VERSIONS = [
  0x00010000, // TrueType outlines
  0x4f54544f, // 'OTTO', PostScript outlines
  0x74727565, // 'true', an older TrueType marker
];
const TTC_TAG = 0x74746366; // 'ttcf', a font collection holding several faces
const WOFF_TAGS = [0x774f4646, 0x774f4632]; // 'wOFF', 'wOF2'
const NAME_TAG = 0x6e616d65; // 'name'
const CMAP_TAG = 0x636d6170; // 'cmap'
const HHEA_TAG = 0x68686561; // 'hhea'
const HMTX_TAG = 0x686d7478; // 'hmtx'
const OS2_TAG = 0x4f532f32; // 'OS/2'
const HEAD_TAG = 0x68656164; // 'head'
const LOCA_TAG = 0x6c6f6361; // 'loca'
const GLYF_TAG = 0x676c7966; // 'glyf'
const CFF_TAG = 0x43464620; // 'CFF '

const FALLBACK_CHAR = new RegExp(FALLBACK_FONTS.map(({ chars }) => chars).join("|"), "u");

// Messages reach the user as-is.
export class UnreadableFontError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreadableFontError";
  }
}

function sfntOffset(view: DataView): number {
  const tag = view.getUint32(0);
  if (tag === TTC_TAG) {
    if (view.byteLength < 16) {
      throw new UnreadableFontError("This font collection file is truncated.");
    }
    // A collection holds several faces, and the file is identified by its first.
    return view.getUint32(12);
  }
  if (WOFF_TAGS.includes(tag)) {
    throw new UnreadableFontError(
      "Web font formats (.woff and .woff2) can't be used for lyrics. Please upload a .ttf or .otf file.",
    );
  }
  if (!SFNT_VERSIONS.includes(tag)) {
    throw new UnreadableFontError("This doesn't look like a TrueType or OpenType font file.");
  }
  return 0;
}

function tableOffset(view: DataView, offset: number, tag: number): number | undefined {
  const numTables = view.getUint16(offset + 4);
  for (let i = 0; i < numTables; i++) {
    const record = offset + 12 + i * 16;
    if (record + 16 > view.byteLength) {
      break;
    }
    if (view.getUint32(record) === tag) {
      return view.getUint32(record + 8);
    }
  }
  return undefined;
}

function nameTableOffset(view: DataView, offset: number): number {
  const table = tableOffset(view, offset, NAME_TAG);
  if (table !== undefined) {
    return table;
  }
  throw new UnreadableFontError(
    "This font file has no name table, so we can't tell which font it is.",
  );
}

function decodeName(view: DataView, offset: number, length: number, platformId: number): string {
  if (platformId === PLATFORM_MACINTOSH) {
    // Single-byte, of which only the ASCII range is meaningful to us.
    let out = "";
    for (let i = 0; i < length; i++) {
      out += String.fromCharCode(view.getUint8(offset + i));
    }
    return out;
  }
  // UTF-16BE, decoded by hand because a "utf-16be" TextDecoder needs a full-ICU build.
  let out = "";
  for (let i = 0; i + 1 < length; i += 2) {
    out += String.fromCharCode(view.getUint16(offset + i));
  }
  return out;
}

/**
 * The best-ranked name the font gives under one of `nameIds`, preferred first, or undefined when it
 * gives none of them.
 * Throws UnreadableFontError if the file isn't a font.
 */
function parseName(data: ArrayBuffer, nameIds: number[]): string | undefined {
  if (data.byteLength < 12) {
    throw new UnreadableFontError("This file is empty or truncated.");
  }
  const view = new DataView(data);
  const nameTable = nameTableOffset(view, sfntOffset(view));
  if (nameTable + 6 > data.byteLength) {
    throw new UnreadableFontError("This font file's name table is truncated.");
  }
  const count = view.getUint16(nameTable + 2);
  const stringsOffset = nameTable + view.getUint16(nameTable + 4);

  // The same name recurs once per platform and language, so rank the candidates rather
  // than taking the first match.
  let best: { name: string; rank: number } | null = null;
  for (let i = 0; i < count; i++) {
    const record = nameTable + 6 + i * 12;
    if (record + 12 > data.byteLength) {
      break;
    }
    const platformRank = PLATFORM_PREFERENCE.indexOf(view.getUint16(record));
    const nameRank = nameIds.indexOf(view.getUint16(record + 6));
    if (platformRank === -1 || nameRank === -1) {
      continue;
    }
    const rank = nameRank * PLATFORM_PREFERENCE.length + platformRank;
    if (best && best.rank <= rank) {
      continue;
    }
    const length = view.getUint16(record + 8);
    const offset = stringsOffset + view.getUint16(record + 10);
    if (offset + length > data.byteLength) {
      continue;
    }
    const name = decodeName(view, offset, length, view.getUint16(record)).replace(/\0/g, "").trim();
    if (name) {
      best = { name, rank };
    }
  }
  return best?.name;
}

// The family name a font declares for itself, e.g. "Metal Mania".
// Throws UnreadableFontError if the file isn't a font or doesn't name itself.
export function parseFontFamilyName(data: ArrayBuffer): string {
  const name = parseName(data, FAMILY_NAME_IDS);
  if (!name) {
    throw new UnreadableFontError("This font file doesn't say what font family it belongs to.");
  }
  return name;
}

/**
 * The name that picks this one face in libass: its full name, or its family name when it has none.
 * Throws UnreadableFontError as parseFontFamilyName does.
 */
export function parseFontFaceName(data: ArrayBuffer): string {
  return parseName(data, [FULL_NAME_ID]) ?? parseFontFamilyName(data);
}

/**
 * The face's weight, from 1 to 1000, and whether it is italic.
 * A font without the tables that say counts as an upright face of weight 400.
 */
export function parseFontStyle(data: ArrayBuffer): { weight: number; italic: boolean } {
  const view = new DataView(data);
  const offset = sfntOffset(view);
  const os2 = tableOffset(view, offset, OS2_TAG);
  const head = tableOffset(view, offset, HEAD_TAG);
  const hasOs2 = os2 !== undefined && os2 + 64 <= data.byteLength;
  const weight = hasOs2 ? view.getUint16(os2 + 4) : 0;
  // fsSelection bit 0 and macStyle bit 1 both mean italic.
  const os2Italic = hasOs2 && (view.getUint16(os2 + 62) & 1) !== 0;
  const headItalic =
    head !== undefined && head + 46 <= data.byteLength && (view.getUint16(head + 44) & 2) !== 0;
  return { weight: weight || 400, italic: os2Italic || headItalic };
}

/**
 * The offset of the cmap subtable that maps Unicode code points, preferring one that reaches past the BMP.
 */
function unicodeSubtable(view: DataView, cmap: number): number | undefined {
  let bmpOnly: number | undefined;
  const count = view.getUint16(cmap + 2);
  for (let i = 0; i < count; i++) {
    const record = cmap + 4 + i * 8;
    const platformId = view.getUint16(record);
    const encodingId = view.getUint16(record + 2);
    if (
      platformId !== PLATFORM_UNICODE &&
      !(platformId === PLATFORM_WINDOWS && [1, 10].includes(encodingId))
    ) {
      continue;
    }
    const subtable = cmap + view.getUint32(record + 4);
    const format = view.getUint16(subtable);
    if (format === 12) {
      return subtable;
    }
    if (format === 4) {
      bmpOnly ??= subtable;
    }
  }
  return bmpOnly;
}

/**
 * Calls `found` with every code point a cmap subtable maps to a glyph, and the glyph's index.
 */
function eachMappedCodePoint(
  view: DataView,
  subtable: number,
  found: (codePoint: number, glyph: number) => void,
) {
  if (view.getUint16(subtable) === 12) {
    const groups = view.getUint32(subtable + 12);
    for (let i = 0; i < groups; i++) {
      const group = subtable + 16 + i * 12;
      const start = view.getUint32(group);
      const end = view.getUint32(group + 4);
      const startGlyph = view.getUint32(group + 8);
      for (let c = start; c <= end; c++) {
        found(c, startGlyph + c - start);
      }
    }
    return;
  }
  const segCountX2 = view.getUint16(subtable + 6);
  const ends = subtable + 14;
  const starts = ends + segCountX2 + 2;
  const deltas = starts + segCountX2;
  const rangeOffsets = deltas + segCountX2;
  for (let i = 0; i < segCountX2; i += 2) {
    const start = view.getUint16(starts + i);
    const end = view.getUint16(ends + i);
    const delta = view.getUint16(deltas + i);
    const rangeOffset = view.getUint16(rangeOffsets + i);
    for (let c = start; c <= end; c++) {
      // A range offset is relative to its own position in the file,
      // and the delta applies to the glyph it points at unless that is the missing glyph.
      const indexed = rangeOffset
        ? view.getUint16(rangeOffsets + i + rangeOffset + (c - start) * 2)
        : c;
      const glyph = rangeOffset && indexed === 0 ? 0 : (indexed + delta) & 0xffff;
      if (glyph !== 0) {
        found(c, glyph);
      }
    }
  }
}

/**
 * The characters matching `chars` that a font can draw.
 * A cmap that can't be read counts as drawing none, so the fallback fonts draw them instead.
 */
export function parseCoverage(data: ArrayBuffer, chars: RegExp = FALLBACK_CHAR): Set<number> {
  const covered = new Set<number>();
  try {
    const view = new DataView(data);
    const cmap = tableOffset(view, sfntOffset(view), CMAP_TAG);
    const subtable = cmap === undefined ? undefined : unicodeSubtable(view, cmap);
    if (subtable !== undefined) {
      eachMappedCodePoint(view, subtable, (c) => {
        if (chars.test(String.fromCodePoint(c))) {
          covered.add(c);
        }
      });
    }
  } catch (e) {
    if (!(e instanceof RangeError || e instanceof UnreadableFontError)) {
      throw e;
    }
  }
  return covered;
}

/**
 * The glyph widths of a font, which `parseFontMetrics` reads from its file.
 */
export interface FontMetrics {
  // In font units. libass scales a font so that this equals the font size.
  height: number;
  // In font units, by code point.
  advances: ReadonlyMap<number, number>;
  // The advance of a code point missing from `advances`.
  defaultAdvance: number;
  // How far each glyph's ink reaches before its origin and past its advance, in font units,
  // for the code points whose ink does. Unset when the file's outlines can't be read.
  ink?: { before: ReadonlyMap<number, number>; after: ReadonlyMap<number, number> };
}

/**
 * Each glyph's ink span, by glyph index, from `glyf` or `CFF `, or null when the file has neither.
 */
function inkSpans(view: DataView, offset: number): ((glyph: number) => InkSpan | null) | null {
  const head = tableOffset(view, offset, HEAD_TAG);
  const loca = tableOffset(view, offset, LOCA_TAG);
  const glyf = tableOffset(view, offset, GLYF_TAG);
  if (head !== undefined && loca !== undefined && glyf !== undefined) {
    const long = view.getInt16(head + 50) === 1;
    const at = (glyph: number) =>
      long ? view.getUint32(loca + glyph * 4) : view.getUint16(loca + glyph * 2) * 2;
    // Every glyph starts with its bounding box, and a glyph with no outline takes no bytes.
    return (glyph) => {
      const start = at(glyph);
      if (at(glyph + 1) <= start) return null;
      return { xMin: view.getInt16(glyf + start + 2), xMax: view.getInt16(glyf + start + 6) };
    };
  }
  const cff = tableOffset(view, offset, CFF_TAG);
  return cff === undefined ? null : cffInkSpans(view, cff);
}

/**
 * The advance width of every glyph the font maps a code point to,
 * and the height libass sizes it by, which is `usWinAscent + usWinDescent`, not the em.
 * Throws UnreadableFontError if the file has no widths.
 */
export function parseFontMetrics(data: ArrayBuffer): FontMetrics {
  const view = new DataView(data);
  const offset = sfntOffset(view);
  const hhea = tableOffset(view, offset, HHEA_TAG);
  const hmtx = tableOffset(view, offset, HMTX_TAG);
  const cmap = tableOffset(view, offset, CMAP_TAG);
  const subtable = cmap === undefined ? undefined : unicodeSubtable(view, cmap);
  if (hhea === undefined || hmtx === undefined || subtable === undefined) {
    throw new UnreadableFontError("This font file doesn't say how wide its characters are.");
  }
  // Glyphs past the last horizontal metric take its advance, as monospaced fonts do.
  const metricCount = view.getUint16(hhea + 34);
  const advanceOf = (glyph: number) => view.getUint16(hmtx + Math.min(glyph, metricCount - 1) * 4);
  const advances = new Map<number, number>();
  eachMappedCodePoint(view, subtable, (c, glyph) => advances.set(c, advanceOf(glyph)));
  let ink: FontMetrics["ink"];
  try {
    ink = readInk(view, offset, subtable, advanceOf);
  } catch {
    // An outline the reader doesn't know leaves the font's ink unknown, and its rows a wider margin.
    ink = undefined;
  }

  const os2 = tableOffset(view, offset, OS2_TAG);
  const winHeight = os2 === undefined ? 0 : view.getUint16(os2 + 74) + view.getUint16(os2 + 76);
  const hheaHeight = view.getInt16(hhea + 4) - view.getInt16(hhea + 6);
  const averageWidth = os2 === undefined ? 0 : view.getInt16(os2 + 2);
  return {
    height: winHeight || hheaHeight,
    advances,
    defaultAdvance: averageWidth > 0 ? averageWidth : advanceOf(0),
    ink,
  };
}

/**
 * How far the ink of each mapped glyph reaches outside its advance box, where it does.
 */
function readInk(
  view: DataView,
  offset: number,
  subtable: number,
  advanceOf: (glyph: number) => number,
): FontMetrics["ink"] {
  const spans = inkSpans(view, offset);
  if (!spans) {
    return undefined;
  }
  const before = new Map<number, number>();
  const after = new Map<number, number>();
  eachMappedCodePoint(view, subtable, (c, glyph) => {
    const span = spans(glyph);
    if (span && span.xMin < 0) before.set(c, -span.xMin);
    if (span && span.xMax > advanceOf(glyph)) after.set(c, span.xMax - advanceOf(glyph));
  });
  return { before, after };
}

export async function readFontFamilyName(file: File): Promise<string> {
  return parseFontFamilyName(await file.arrayBuffer());
}

export interface FontFaceInfo {
  // What a style names to draw in this face.
  name: string;
  family: string;
  weight: number;
  italic: boolean;
  // Which of the characters the fallback fonts stand in for this face can draw.
  coverage: Set<number>;
  metrics: FontMetrics;
}

/**
 * What a font file says about the face it holds.
 * Throws UnreadableFontError as parseFontFamilyName and parseFontMetrics do.
 */
export async function readFont(file: File): Promise<FontFaceInfo> {
  const data = await file.arrayBuffer();
  return {
    name: parseFontFaceName(data),
    family: parseFontFamilyName(data),
    ...parseFontStyle(data),
    coverage: parseCoverage(data),
    metrics: parseFontMetrics(data),
  };
}
