// Fonts with simple widths, for tests that need exact ones.

import type { FontMetrics } from "./fontFile";
import { BUNDLED_METRICS } from "./fonts";
import { FontLibrary } from "./textWidth";

/**
 * A font in which every Latin character is half the font size wide, and a space a quarter.
 * No glyph's ink reaches outside its box.
 */
export const HALF: FontMetrics = {
  height: 1000,
  advances: new Map([
    [0x20, 250],
    ...Array.from({ length: 0x250 - 0x21 }, (_, i): [number, number] => [0x21 + i, 500]),
  ]),
  defaultAdvance: 500,
  ink: { before: new Map(), after: new Map() },
};

// The bundled fonts, and HALF as "Half".
export const HALF_FONTS = new FontLibrary({}, { ...BUNDLED_METRICS, Half: HALF });
