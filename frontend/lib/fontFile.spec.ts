import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  parseCoverage,
  parseFontFamilyName,
  parseFontMetrics,
  readFontFamilyName,
  UnreadableFontError,
} from "./fontFile";

const FONT_DIR = path.resolve(__dirname, "../../api/assets/fonts");

function bundledFont(name: string): ArrayBuffer {
  const buffer = readFileSync(path.join(FONT_DIR, name));
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

// A real font with the right mix of name records is hard to come by, so synthesize one.
function fontWithNames(
  entries: { platformId: number; nameId: number; text: string }[],
): ArrayBuffer {
  const encoded = entries.map(({ platformId, text }) => {
    if (platformId === 1) {
      return Uint8Array.from(text, (c) => c.charCodeAt(0));
    }
    const bytes = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      new DataView(bytes.buffer).setUint16(i * 2, text.charCodeAt(i));
    }
    return bytes;
  });

  const recordsSize = 6 + entries.length * 12;
  const stringsSize = encoded.reduce((total, bytes) => total + bytes.length, 0);
  const nameTableOffset = 12 + 16; // one table record in the directory
  const data = new ArrayBuffer(nameTableOffset + recordsSize + stringsSize);
  const view = new DataView(data);

  view.setUint32(0, 0x00010000); // sfnt version
  view.setUint16(4, 1); // numTables
  view.setUint32(12, 0x6e616d65); // 'name'
  view.setUint32(12 + 8, nameTableOffset);
  view.setUint32(12 + 12, recordsSize + stringsSize);

  view.setUint16(nameTableOffset, 0); // format
  view.setUint16(nameTableOffset + 2, entries.length);
  view.setUint16(nameTableOffset + 4, recordsSize); // strings start, relative to the table

  let stringOffset = 0;
  entries.forEach(({ platformId, nameId }, i) => {
    const record = nameTableOffset + 6 + i * 12;
    view.setUint16(record, platformId);
    view.setUint16(record + 2, platformId === 1 ? 0 : 1); // encodingId
    view.setUint16(record + 4, 0); // languageId
    view.setUint16(record + 6, nameId);
    view.setUint16(record + 8, encoded[i].length);
    view.setUint16(record + 10, stringOffset);
    new Uint8Array(data).set(encoded[i], nameTableOffset + recordsSize + stringOffset);
    stringOffset += encoded[i].length;
  });

  return data;
}

describe("parseFontFamilyName", () => {
  test.each([
    ["Impact.ttf", "Impact"],
    ["MetalMania.ttf", "Metal Mania"],
    ["ArialNarrow.ttf", "Arial Narrow"],
    ["LiberationSans.ttf", "Liberation Sans"],
  ])("reads the family name out of %s", (file, expected) => {
    expect(parseFontFamilyName(bundledFont(file))).toBe(expected);
  });

  test("prefers the typographic family over the legacy one", () => {
    const data = fontWithNames([
      { platformId: 3, nameId: 1, text: "Bagel Fat One SemiCondensed" },
      { platformId: 3, nameId: 16, text: "Bagel Fat One" },
    ]);

    expect(parseFontFamilyName(data)).toBe("Bagel Fat One");
  });

  test("falls back to the Macintosh record when that is all there is", () => {
    const data = fontWithNames([{ platformId: 1, nameId: 1, text: "Old Mac Font" }]);

    expect(parseFontFamilyName(data)).toBe("Old Mac Font");
  });

  test("ignores name records that are neither family name", () => {
    const data = fontWithNames([
      { platformId: 3, nameId: 4, text: "Some Font Bold Italic" }, // full name
      { platformId: 3, nameId: 1, text: "Some Font" },
    ]);

    expect(parseFontFamilyName(data)).toBe("Some Font");
  });

  test("rejects web font formats by name", () => {
    const data = new ArrayBuffer(64);
    new DataView(data).setUint32(0, 0x774f4646); // 'wOFF'

    expect(() => parseFontFamilyName(data)).toThrow(UnreadableFontError);
    expect(() => parseFontFamilyName(data)).toThrow(/woff/i);
  });

  test("rejects a file that is not a font", () => {
    const data = new TextEncoder().encode("this is not a font at all").buffer;

    expect(() => parseFontFamilyName(data as ArrayBuffer)).toThrow(UnreadableFontError);
  });

  test("rejects an empty file", () => {
    expect(() => parseFontFamilyName(new ArrayBuffer(0))).toThrow(UnreadableFontError);
  });

  test("rejects a font with no name table", () => {
    const data = new ArrayBuffer(12 + 16);
    const view = new DataView(data);
    view.setUint32(0, 0x00010000);
    view.setUint16(4, 1);
    view.setUint32(12, 0x676c7966); // 'glyf'

    expect(() => parseFontFamilyName(data)).toThrow(/name table/);
  });
});

describe("readFontFamilyName", () => {
  test("reads the family name from a File", async () => {
    const file = new File([bundledFont("Georgia.ttf")], "whatever-the-user-called-it.ttf");

    await expect(readFontFamilyName(file)).resolves.toBe("Georgia");
  });
});

describe("parseFontMetrics", () => {
  const code = (c: string) => c.codePointAt(0)!;

  test("reads the height libass sizes a font by, and the advances", () => {
    const { height, advances } = parseFontMetrics(bundledFont("TimesNewRoman.ttf"));
    expect(height).toBe(1825 + 443);
    expect(advances.get(code("f"))).toBe(682);
  });

  test("reads how far a glyph's ink reaches outside its box from a TrueType outline", () => {
    const { ink } = parseFontMetrics(bundledFont("TimesNewRoman.ttf"));
    expect(ink?.after.get(code("f"))).toBe(208);
    expect(ink?.before.get(code("j"))).toBe(157);
    expect(ink?.before.has(code("J"))).toBe(false);
    expect(ink?.after.has(code("J"))).toBe(false);
  });

  test("reads it from a PostScript outline too", () => {
    const { ink } = parseFontMetrics(bundledFont("NotoSansCJKjp-Regular.otf"));
    expect(ink?.after.get(code("f"))).toBe(31);
    expect(ink?.before.get(code("j"))).toBe(44);
    expect(ink?.before.has(code("漢"))).toBe(false);
    expect(ink?.after.has(code("漢"))).toBe(false);
  });
});

describe("parseCoverage", () => {
  const codePoint = (c: string) => c.codePointAt(0)!;

  test("finds kanji, kana and Hangul in a CJK font", () => {
    const covered = parseCoverage(bundledFont("NotoSansCJKjp-Regular.otf"));

    for (const c of "坂本真綾なテー한") {
      expect(covered.has(codePoint(c))).toBe(true);
    }
    expect(covered.has(codePoint("A"))).toBe(false);
  });

  test("finds the symbols a font draws", () => {
    const covered = parseCoverage(bundledFont("Arial.ttf"));

    expect(covered.has(codePoint("♥"))).toBe(true);
    expect(covered.has(codePoint("➤"))).toBe(false);
  });

  test("finds no CJK characters in a Latin font", () => {
    const covered = parseCoverage(bundledFont("Impact.ttf"));

    expect([...covered].filter((c) => c >= 0x4e00 && c <= 0x9fff)).toEqual([]);
  });

  test("finds none in a font without a cmap", () => {
    expect(
      parseCoverage(fontWithNames([{ platformId: 3, nameId: 1, text: "Nameless" }])).size,
    ).toBe(0);
  });

  test("finds none in a truncated file", () => {
    expect(parseCoverage(bundledFont("NotoSansCJKjp-Regular.otf").slice(0, 2048)).size).toBe(0);
  });
});
