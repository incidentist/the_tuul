import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  BUNDLED_FONTS,
  BUNDLED_SYMBOLS,
  COUNT_IN_SYMBOLS,
  SYMBOL_CHAR,
  SYMBOL_FONT,
  withFallbackFonts,
} from "./fonts";
import { parseCoverage } from "./fontFile";

function toRanges(codePoints: Set<number>): [number, number][] {
  const ranges: [number, number][] = [];
  for (const c of [...codePoints].sort((a, b) => a - b)) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === c - 1) {
      last[1] = c;
    } else {
      ranges.push([c, c]);
    }
  }
  return ranges;
}

test("bundledSymbols.json lists the symbols in each bundled font file", async () => {
  const symbol = new RegExp(SYMBOL_CHAR, "u");
  const table = Object.fromEntries(
    Object.entries(BUNDLED_FONTS).map(([family, url]) => {
      const file = readFileSync(
        path.resolve(__dirname, "../../api/assets/fonts", path.basename(url)),
      );
      const data = file.buffer.slice(
        file.byteOffset,
        file.byteOffset + file.byteLength,
      ) as ArrayBuffer;
      return [family, toRanges(parseCoverage(data, symbol))];
    }),
  );

  await expect(JSON.stringify(table) + "\n").toMatchFileSnapshot("./bundledSymbols.json");
});

test("the symbol font draws every count-in symbol", () => {
  const symbol = new RegExp(`^${SYMBOL_CHAR}$`, "u");
  const missing = COUNT_IN_SYMBOLS.flatMap(({ symbols }) => symbols.map(({ char }) => char)).filter(
    (c) => !symbol.test(c) || !BUNDLED_SYMBOLS[SYMBOL_FONT].has(c.codePointAt(0)!),
  );
  expect(missing).toEqual([]);
});

describe("withFallbackFonts", () => {
  test("switches a CJK run to the CJK font and back", () => {
    expect(withFallbackFonts("{\\kf100}Sakamoto 坂本 真綾!", "Arial")).toBe(
      "{\\kf100}Sakamoto {\\fnNoto Sans CJK JP}坂本 真綾{\\fn}!",
    );
  });

  test("covers kana, the long vowel mark, CJK punctuation and Hangul", () => {
    expect(withFallbackFonts("「カラオケー」한국", "Arial")).toBe(
      "{\\fnNoto Sans CJK JP}「カラオケー」한국{\\fn}",
    );
  });

  test("switches a run of symbols to the symbol font", () => {
    expect(withFallbackFonts("{\\kf50}➤➤➤➤{\\kf20}May", "Arial")).toBe(
      "{\\kf50}{\\fnDejaVu Sans}➤➤➤➤{\\fn}{\\kf20}May",
    );
  });

  test("keeps the symbols the style's font draws itself", () => {
    const heart = new Set(["♥".codePointAt(0)!]);
    expect(withFallbackFonts("♥♥♥ ➤", "Arial", heart)).toBe("♥♥♥ {\\fnDejaVu Sans}➤{\\fn}");
  });

  test("leaves the text alone in the fallback font it would switch to", () => {
    expect(withFallbackFonts("➤➤ 坂本", "DejaVu Sans")).toBe("➤➤ {\\fnNoto Sans CJK JP}坂本{\\fn}");
  });

  test("switches a whole run when none of its words can be drawn", () => {
    expect(withFallbackFonts("➤➤ ➣➣", "Arial")).toBe("{\\fnDejaVu Sans}➤➤ ➣➣{\\fn}");
  });

  test("leaves Latin text and override blocks alone", () => {
    const line = "{\\fad(100,100)}{\\kf50}Crème brûlée · naïve";
    expect(withFallbackFonts(line, "Arial")).toBe(line);
  });
});
