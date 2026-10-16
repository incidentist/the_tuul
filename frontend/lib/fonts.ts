import bundledMetricsTable from "./bundledMetrics.json";
import bundledSymbolRanges from "./bundledSymbols.json";
import type { FontMetrics } from "./fontFile";

// The fonts the app ships, by family name. libass gets only these, with no system fallback.
export const BUNDLED_FONTS = {
  "Andale Mono": "/static/fonts/AndaleMono.ttf",
  Arial: "/static/fonts/Arial.ttf",
  "Arial Narrow": "/static/fonts/ArialNarrow.ttf",
  "Comic Sans MS": "/static/fonts/ComicSans.ttf",
  "Courier New": "/static/fonts/CourierNew.ttf",
  Georgia: "/static/fonts/Georgia.ttf",
  Impact: "/static/fonts/Impact.ttf",
  "Metal Mania": "/static/fonts/MetalMania.ttf",
  "Times New Roman": "/static/fonts/TimesNewRoman.ttf",
  "Trebuchet MS": "/static/fonts/Trebuchet.ttf",
  Verdana: "/static/fonts/Verdana.ttf",
  "Liberation Sans": "/static/fonts/LiberationSans.ttf",
  "Noto Sans CJK JP": "/static/fonts/NotoSansCJKjp-Regular.otf",
  "DejaVu Sans": "/static/fonts/DejaVuSans.ttf",
};

// libass draws synthetic bold, when Bold is on, on a face lighter than this.
const SYNTHETIC_BOLD_BELOW = 550;

/**
 * The Bold and Italic switches that draw an uploaded face as it is, with no synthetic bold or slant.
 */
export function faceSwitches(face: { weight: number; italic: boolean }): {
  bold: boolean;
  italic: boolean;
} {
  return { bold: face.weight >= SYNTHETIC_BOLD_BELOW, italic: face.italic };
}

// The only bundled font with Chinese, Japanese and Korean glyphs.
// It draws the characters those languages share in their Japanese forms.
export const CJK_FONT = "Noto Sans CJK JP";

// U+3000–U+33FF holds CJK punctuation, kana and CJK symbols. U+FF00–U+FFEF holds full-width forms.
export const CJK_CHAR = String.raw`[\p{sc=Han}\p{sc=Hangul}\p{sc=Bopomofo}\u3000-\u33ff\uff00-\uffef]`;

export const SYMBOL_FONT = "DejaVu Sans";

// Bullets, arrows, technical symbols, box and block characters, geometric shapes,
// miscellaneous symbols and dingbats, which karaoke projects type as count-ins and instrumental bars.
export const SYMBOL_CHAR = String.raw`[\u2022-\u2023\u2190-\u21ff\u2300-\u23ff\u2500-\u27bf\u27f0-\u27ff\u2b00-\u2bff]`;

// The symbols the count-in picker offers. Every one must be in SYMBOL_CHAR and drawn by DejaVu Sans,
// so it renders whatever the style's font is.
export const COUNT_IN_SYMBOLS = [
  {
    name: "Arrows",
    symbols: [
      { char: "➤", name: "Black rightwards arrowhead" },
      { char: "➣", name: "Three-D bottom-lighted rightwards arrowhead" },
      { char: "➢", name: "Three-D top-lighted rightwards arrowhead" },
      { char: "➔", name: "Heavy wide-headed rightwards arrow" },
      { char: "➜", name: "Heavy round-tipped rightwards arrow" },
      { char: "➡", name: "Black rightwards arrow" },
      { char: "➨", name: "Heavy concave-pointed black rightwards arrow" },
      { char: "⇒", name: "Rightwards double arrow" },
      { char: "⇨", name: "Rightwards white arrow" },
      { char: "→", name: "Rightwards arrow" },
      { char: "►", name: "Black right-pointing pointer" },
      { char: "▶", name: "Black right-pointing triangle" },
      { char: "▸", name: "Black right-pointing small triangle" },
      { char: "▷", name: "White right-pointing triangle" },
      { char: "❯", name: "Heavy right-pointing angle quotation mark ornament" },
      { char: "❱", name: "Heavy right-pointing angle bracket ornament" },
    ],
  },
  {
    name: "Shapes",
    symbols: [
      { char: "●", name: "Black circle" },
      { char: "○", name: "White circle" },
      { char: "•", name: "Bullet" },
      { char: "‣", name: "Triangular bullet" },
      { char: "◦", name: "White bullet" },
      { char: "◉", name: "Fisheye" },
      { char: "◎", name: "Bullseye" },
      { char: "⬤", name: "Black large circle" },
      { char: "◆", name: "Black diamond" },
      { char: "◇", name: "White diamond" },
      { char: "■", name: "Black square" },
      { char: "□", name: "White square" },
      { char: "◼", name: "Black medium square" },
      { char: "▪", name: "Black small square" },
      { char: "▲", name: "Black up-pointing triangle" },
      { char: "△", name: "White up-pointing triangle" },
    ],
  },
  {
    name: "Stars and notes",
    symbols: [
      { char: "★", name: "Black star" },
      { char: "☆", name: "White star" },
      { char: "✦", name: "Black four pointed star" },
      { char: "✧", name: "White four pointed star" },
      { char: "✩", name: "Stress outlined white star" },
      { char: "✪", name: "Circled white star" },
      { char: "♪", name: "Eighth note" },
      { char: "♫", name: "Beamed eighth notes" },
      { char: "♬", name: "Beamed sixteenth notes" },
      { char: "♩", name: "Quarter note" },
      { char: "♥", name: "Black heart suit" },
      { char: "♡", name: "White heart suit" },
    ],
  },
  {
    name: "Numbers",
    symbols: [
      { char: "❶", name: "Dingbat negative circled digit one" },
      { char: "❷", name: "Dingbat negative circled digit two" },
      { char: "❸", name: "Dingbat negative circled digit three" },
      { char: "❹", name: "Dingbat negative circled digit four" },
      { char: "➊", name: "Dingbat negative circled sans-serif digit one" },
      { char: "➋", name: "Dingbat negative circled sans-serif digit two" },
      { char: "➌", name: "Dingbat negative circled sans-serif digit three" },
      { char: "➍", name: "Dingbat negative circled sans-serif digit four" },
      { char: "➀", name: "Dingbat circled sans-serif digit one" },
      { char: "➁", name: "Dingbat circled sans-serif digit two" },
      { char: "➂", name: "Dingbat circled sans-serif digit three" },
      { char: "➃", name: "Dingbat circled sans-serif digit four" },
    ],
  },
];

// The bundled fonts that draw what a style's font can't, and the characters each one stands in for.
export const FALLBACK_FONTS = [
  { family: CJK_FONT, chars: CJK_CHAR },
  { family: SYMBOL_FONT, chars: SYMBOL_CHAR },
];

// The symbols each bundled font draws, as [first, last] code point ranges.
// It is generated from the font files by fonts.spec.ts.
// Run `pnpm exec vitest run -u` after changing a font.
// Only the CJK font draws CJK characters, so none are listed.
export const BUNDLED_SYMBOLS: Readonly<Record<string, ReadonlySet<number>>> = Object.fromEntries(
  Object.entries(bundledSymbolRanges as Record<string, number[][]>).map(([family, ranges]) => [
    family,
    new Set(
      ranges.flatMap(([first, last]) =>
        Array.from({ length: last - first + 1 }, (_, i) => first + i),
      ),
    ),
  ]),
);

// The code points whose widths bundledMetrics.json lists, for each bundled font that maps them.
// Any other code point takes the font's most common width, which for the CJK font is a full width.
export const MEASURED_RANGES: [number, number][] = [
  [0x0020, 0x024f], // Latin
  [0x0300, 0x036f], // combining diacritics
  [0x0370, 0x04ff], // Greek and Cyrillic
  [0x1e00, 0x1eff], // Latin Extended Additional
  [0x2000, 0x215f], // punctuation, currency and letterlike symbols
  [0x2190, 0x21ff], // the rest are the symbol ranges of SYMBOL_CHAR
  [0x2300, 0x23ff],
  [0x2500, 0x27bf],
  [0x27f0, 0x27ff],
  [0x2b00, 0x2bff],
];

// A bundled font's widths as bundledMetrics.json holds them,
// with each run of consecutive code points as its first code point followed by their advances,
// and each code point whose ink reaches outside its advance box as itself, before and after.
export interface CompactMetrics {
  height: number;
  defaultAdvance: number;
  runs: number[][];
  ink?: number[][];
}

// Generated from the font files by fonts.spec.ts.
// Run `pnpm exec vitest run -u` after changing a font.
export const BUNDLED_METRICS: Readonly<Record<string, FontMetrics>> = Object.fromEntries(
  Object.entries(bundledMetricsTable as Record<string, CompactMetrics>).map(
    ([family, { height, defaultAdvance, runs, ink }]) => [
      family,
      {
        height,
        defaultAdvance,
        advances: new Map(
          runs.flatMap(([first, ...advances]) =>
            advances.map((advance, i) => [first + i, advance]),
          ),
        ),
        ink: ink && {
          before: new Map(ink.filter(([, before]) => before > 0).map(([c, before]) => [c, before])),
          after: new Map(ink.filter(([, , after]) => after > 0).map(([c, , after]) => [c, after])),
        },
      },
    ],
  ),
);

// A glyph's advance and the ink it reaches outside its box with, in font sizes.
export interface GlyphWidth {
  advance: number;
  before: number;
  after: number;
}

/**
 * For each code point a bundled font maps, the widest any bundled font draws it.
 * libass draws a glyph the style's font lacks in another font the app gives it, which may be any
 * bundled font, so this bounds how wide it comes out.
 */
export const WIDEST_BUNDLED: ReadonlyMap<number, GlyphWidth> = (() => {
  const widest = new Map<number, GlyphWidth>();
  for (const { height, advances, ink } of Object.values(BUNDLED_METRICS)) {
    for (const [c, advance] of advances) {
      const previous = widest.get(c) ?? { advance: 0, before: 0, after: 0 };
      widest.set(c, {
        advance: Math.max(previous.advance, advance / height),
        before: Math.max(previous.before, (ink?.before.get(c) ?? 0) / height),
        after: Math.max(previous.after, (ink?.after.get(c) ?? 0) / height),
      });
    }
  }
  return widest;
})();

/**
 * The font families an ASS script names, in its styles' Fontname and in `\fn` tags.
 */
export function fontFamiliesIn(ass: string): Set<string> {
  const families = new Set<string>();
  for (const [, family] of ass.matchAll(/^Style:[^,]*,([^,]+),/gm)) {
    families.add(family.trim());
  }
  for (const [, family] of ass.matchAll(/\\fn([^\\}]+)/g)) {
    families.add(family.trim());
  }
  return families;
}

// One capture group per fallback font, matching a run of the characters it stands in for.
const FALLBACK_RUN = new RegExp(
  FALLBACK_FONTS.map(({ chars }) => `(${chars}+(?: +${chars}+)*)`).join("|"),
  "gu",
);

// Which of the characters the fallback fonts stand in for each uploaded font can draw, by family name.
// A bundled font draws what BUNDLED_SYMBOLS lists. Any other font counts as drawing none.
export type GlyphCoverage = Readonly<Record<string, ReadonlySet<number>>>;

/**
 * Switch every run of CJK text or symbols outside override blocks to the fallback font for it,
 * unless the style's font can draw the whole run.
 * FFmpeg.wasm's libass has no fontconfig, so it can't fall back to another font on its own.
 */
export function withFallbackFonts(
  events: string,
  fontName: string,
  covered: ReadonlySet<number> = new Set(),
): string {
  const drawable = (word: string) => [...word].every((c) => covered.has(c.codePointAt(0)!));
  return events.replace(/(\{[^}]*\})|[^{]+/g, (chunk, block) =>
    block
      ? chunk
      : chunk.replace(FALLBACK_RUN, (run, ...groups) => {
          const { family } = FALLBACK_FONTS[groups.findIndex((group) => group !== undefined)];
          const tag = (text: string) => `{\\fn${family}}${text}{\\fn}`;
          // Odd indexes hold the spaces between words.
          const parts = run.split(/( +)/);
          const words = parts.filter((_, i) => i % 2 === 0);
          if (family === fontName || words.every(drawable)) {
            return run;
          }
          if (!words.some(drawable)) {
            return tag(run);
          }
          return parts
            .map((part, i) => (i % 2 === 0 && !drawable(part) ? tag(part) : part))
            .join("");
        }),
  );
}
