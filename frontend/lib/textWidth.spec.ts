import { describe, expect, test } from "vitest";
import { FontMetrics } from "./fontFile";
import { BUNDLED_METRICS } from "./fonts";
import { FontLibrary, UNKNOWN_INK } from "./textWidth";
import { HALF, HALF_FONTS } from "./testFonts";
import rendered from "../../tests/fixtures/rendered-widths.json";

// Every character is half the font size wide, and a space a quarter.
const fonts = HALF_FONTS;
const code = (c: string) => c.codePointAt(0)!;

describe("FontLibrary.widths", () => {
  test("scales the advances so that the font's ascent and descent match the font size", () => {
    const { height, advances } = BUNDLED_METRICS["Arial"];
    const advance = [..."Moon"].reduce((sum, c) => sum + advances.get(c.codePointAt(0)!)!, 0);
    expect(fonts.widths(["Moon"], "Arial", 30)[0]).toBeCloseTo((advance * 30) / height);
  });

  test("measures each fragment as drawn after the ones before it", () => {
    expect(fonts.widths(["ab ", "{\\fscx50}cd", "ef"], "Half", 20)).toEqual([25, 10, 10]);
  });

  test("follows font and size changes, and their resets", () => {
    expect(fonts.widths(["{\\fs40}a{\\fs}a"], "Half", 20)).toEqual([30]);
    expect(fonts.widths(["{\\fnArial}{\\r}a"], "Half", 20)).toEqual([10]);
  });

  test("ignores tags that don't change widths", () => {
    expect(fonts.widths(["{\\alpha&H80&\\pos(10,20)\\fscy200}ab"], "Half", 20)).toEqual([20]);
  });

  test("gives a drawing the width of its bounding box", () => {
    const mark = "{\\p1\\pbo8}m 0 0 l 8 0 8 -8 0 -8 m 13 0{\\p0}";
    expect(fonts.widths([mark], "Half", 20)).toEqual([13]);
    expect(fonts.widths(["{\\p2}m 0 0 l 26 0{\\p0}"], "Half", 20)).toEqual([13]);
  });

  test("measures CJK text in the CJK font the subtitles switch it to", () => {
    const { height, defaultAdvance } = BUNDLED_METRICS["Noto Sans CJK JP"];
    expect(fonts.widths(["坂本"], "Arial", 30)[0]).toBeCloseTo((2 * defaultAdvance * 30) / height);
  });

  test("draws hard spaces and drops line breaks", () => {
    expect(fonts.widths(["a\\hb\\Nc"], "Half", 20)).toEqual([35]);
  });

  test("measures how far the ink reaches before a fragment and past it", () => {
    const swash: FontMetrics = {
      ...HALF,
      ink: { before: new Map([[code("f"), 100]]), after: new Map([[code("f"), 200]]) },
    };
    const inked = new FontLibrary({}, { Swash: swash });
    expect(inked.measure(["fa"], "Swash", 20)).toEqual([{ width: 20, before: 2, after: 0 }]);
    expect(inked.measure(["af"], "Swash", 20)).toEqual([{ width: 20, before: 0, after: 4 }]);
  });

  test("leaves room for ink it can't read", () => {
    const [{ before, after }] = fonts.measure(["ab"], "Nowhere Sans", 20);
    expect([before, after]).toEqual([UNKNOWN_INK * 20, UNKNOWN_INK * 20]);
  });

  test("measures a family it has no widths for as Arial", () => {
    expect(fonts.widths(["Moon"], "Nowhere Sans", 30)).toEqual(fonts.widths(["Moon"], "Arial", 30));
  });
});

// scripts/rendered_widths.py writes the widths libass draws these lines at, in faux bold.
describe("widths against libass", () => {
  test.each(Object.entries(rendered.widths))(
    "are within 1%% under and 2.5%% over in %s",
    (family, inks) => {
      for (const [line, ink] of Object.entries(inks as Record<string, number>)) {
        const [width] = new FontLibrary().widths([line], family, rendered.size);
        expect(width, line).toBeGreaterThanOrEqual(ink * 0.99);
        expect(width, line).toBeLessThanOrEqual(ink * 1.025);
      }
    },
  );
});
