import bundledSymbolRanges from "./bundledSymbols.json";

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
