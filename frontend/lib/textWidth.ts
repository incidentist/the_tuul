// Measuring ASS text as libass lays it out, so that the app can choose where lines wrap.
// Kerning is left out. It narrows text, so a measured width errs on the wide side.

import type { FontMetrics } from "./fontFile";
import {
  BUNDLED_METRICS,
  BUNDLED_SYMBOLS,
  GlyphCoverage,
  GlyphWidth,
  WIDEST_BUNDLED,
  withFallbackFonts,
} from "./fonts";

// A family with no metrics, such as one an imported file names, is measured in this one.
const UNKNOWN_FAMILY = "Arial";

// How far a glyph's ink may reach outside its box on either side, in font sizes,
// when its font's outlines can't be read.
// The furthest measured on one side, across 84 fonts, was 0.47 of the font size.
export const UNKNOWN_INK = 0.47;

interface Style {
  family: string;
  size: number;
}

interface DrawState extends Style {
  // \fscx as a fraction.
  scaleX: number;
  // The \p level. Zero draws text.
  drawing: number;
}

// A fragment's width, and how far its ink reaches outside the box of that width, in canvas units.
export interface Extent {
  width: number;
  before: number;
  after: number;
}

/**
 * The fonts a render can draw with: which fallback characters each one covers, and its widths.
 */
export class FontLibrary {
  constructor(
    private readonly coverage: GlyphCoverage = {},
    private readonly metrics: Readonly<Record<string, FontMetrics>> = BUNDLED_METRICS,
  ) {}

  /**
   * Which of the characters the fallback fonts stand in for the family draws itself.
   */
  covered(family: string): ReadonlySet<number> | undefined {
    return this.coverage[family] ?? BUNDLED_SYMBOLS[family];
  }

  /**
   * The width of each fragment of ASS text, drawn one after another in the style, in canvas units.
   */
  widths(fragments: string[], family: string, size: number): number[] {
    return this.measure(fragments, family, size).map(({ width }) => width);
  }

  /**
   * The extent of each fragment of ASS text, drawn one after another in the style.
   * Override tags carry over from one fragment to the next, as they do within an event.
   */
  measure(fragments: string[], family: string, size: number): Extent[] {
    const style = { family, size };
    let state: DrawState = { ...style, scaleX: 1, drawing: 0 };
    return fragments.map((fragment) => {
      // `inkEnd` is where the furthest ink ends, from the fragment's start.
      const extent = { width: 0, before: 0, inkEnd: 0 };
      const text = withFallbackFonts(fragment, family, this.covered(family));
      for (const [, block, chunk] of text.matchAll(/\{([^}]*)\}?|([^{]+)/g)) {
        if (block !== undefined) {
          state = withTags(state, block, style);
        } else if (state.drawing > 0) {
          extent.width += drawingWidth(chunk, state);
          extent.inkEnd = Math.max(extent.inkEnd, extent.width);
        } else {
          this.addText(chunk, state, extent);
        }
      }
      const { width, before, inkEnd } = extent;
      return { width, before, after: Math.max(0, inkEnd - width) };
    });
  }

  private addText(
    text: string,
    { family, size, scaleX }: DrawState,
    extent: { width: number; before: number; inkEnd: number },
  ): void {
    const scale = size * scaleX;
    for (const char of text.replace(/\\[Nn]/g, "").replace(/\\h/g, " ")) {
      const { advance, before, after } = this.glyph(char.codePointAt(0)!, family);
      extent.before = Math.max(extent.before, before * scale - extent.width);
      extent.inkEnd = Math.max(extent.inkEnd, extent.width + (advance + after) * scale);
      extent.width += advance * scale;
    }
  }

  /**
   * How wide a character is drawn in the family, in font sizes.
   */
  private glyph(c: number, family: string): GlyphWidth {
    const known = this.metrics[family];
    const { height, advances, defaultAdvance } = known ?? this.metrics[UNKNOWN_FAMILY];
    const advance = advances.get(c);
    if (advance === undefined) {
      return WIDEST_BUNDLED.get(c) ?? { advance: defaultAdvance / height, before: 0, after: 0 };
    }
    const ink = known?.ink;
    return {
      advance: advance / height,
      before: ink ? (ink.before.get(c) ?? 0) / height : UNKNOWN_INK,
      after: ink ? (ink.after.get(c) ?? 0) / height : UNKNOWN_INK,
    };
  }
}

/**
 * The state after the tags of an override block. Tags that don't change widths are ignored.
 */
function withTags(state: DrawState, block: string, style: Style): DrawState {
  const next = { ...state };
  // Text in braces before the first backslash is a comment.
  const tags = block
    .split("\\")
    .slice(1)
    .map((tag) => tag.trim());
  for (const tag of tags) {
    const family = tag.match(/^fn(.*)$/);
    const scaleX = tag.match(/^fscx([\d.]*)$/);
    const size = tag.match(/^fs([\d.]*)$/);
    const drawing = tag.match(/^p(\d+)$/);
    if (family) {
      next.family = family[1].trim() || style.family;
    } else if (scaleX) {
      next.scaleX = scaleX[1] ? Number(scaleX[1]) / 100 : 1;
    } else if (size) {
      next.size = Number(size[1]) || style.size;
    } else if (drawing) {
      next.drawing = Number(drawing[1]);
    } else if (tag.startsWith("r")) {
      Object.assign(next, style, { scaleX: 1 });
    }
  }
  return next;
}

/**
 * libass gives a drawing the width of its bounding box.
 * Every drawing command takes x and y pairs, so the x coordinates are every other number.
 */
function drawingWidth(commands: string, { drawing, scaleX }: DrawState): number {
  const xs = (commands.match(/-?\d+(?:\.\d+)?/g) ?? []).filter((_, i) => i % 2 === 0).map(Number);
  if (xs.length === 0) {
    return 0;
  }
  return ((Math.max(...xs) - Math.min(...xs)) / 2 ** (drawing - 1)) * scaleX;
}
