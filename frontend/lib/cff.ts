// Reading how wide each glyph's ink is from a CFF table, which OpenType fonts with PostScript
// outlines hold in place of `glyf`. Only what that needs is read: the charstrings, their
// subroutines, and the font dicts of a CID-keyed font such as the bundled CJK font.

// The ink's left and right edges, from the glyph's origin, in font units.
export interface InkSpan {
  xMin: number;
  xMax: number;
}

interface Index {
  count: number;
  start: (i: number) => number;
  end: (i: number) => number;
  // The offset just past the index.
  after: number;
}

type Dict = Map<number, number[]>;

// Operators that take an escape byte are stored as 1200 plus the second byte.
const CHARSTRINGS = 17;
const PRIVATE = 18;
const SUBRS = 19;
const FD_ARRAY = 1236;
const FD_SELECT = 1237;

class UnsupportedCharstring extends Error {}

/**
 * Each glyph's ink span, by glyph index, or null for a glyph that draws nothing.
 * Throws when the table can't be read, so the caller can treat the font's spans as unknown.
 */
export function cffInkSpans(view: DataView, cff: number): (glyph: number) => InkSpan | null {
  const headerSize = view.getUint8(cff + 2);
  const names = readIndex(view, cff + headerSize);
  const topDicts = readIndex(view, names.after);
  const strings = readIndex(view, topDicts.after);
  const globalSubrs = readIndex(view, strings.after);
  const top = readDict(view, topDicts.start(0), topDicts.end(0));
  const charStrings = readIndex(view, cff + top.get(CHARSTRINGS)![0]);

  const localSubrsOf = (dict: Dict): Index | null => {
    const [size, offset] = dict.get(PRIVATE) ?? [];
    if (size === undefined) return null;
    const privateDict = readDict(view, cff + offset, cff + offset + size);
    const subrs = privateDict.get(SUBRS);
    return subrs ? readIndex(view, cff + offset + subrs[0]) : null;
  };
  let subrsOf: (glyph: number) => Index | null;
  if (top.has(FD_ARRAY)) {
    const fonts = readIndex(view, cff + top.get(FD_ARRAY)![0]);
    const fontSubrs = Array.from({ length: fonts.count }, (_, i) =>
      localSubrsOf(readDict(view, fonts.start(i), fonts.end(i))),
    );
    const fdOf = fdSelect(view, cff + top.get(FD_SELECT)![0], charStrings.count);
    subrsOf = (glyph) => fontSubrs[fdOf(glyph)];
  } else {
    const subrs = localSubrsOf(top);
    subrsOf = () => subrs;
  }

  return (glyph) => {
    if (glyph >= charStrings.count) return null;
    return inkSpan(
      view,
      charStrings.start(glyph),
      charStrings.end(glyph),
      globalSubrs,
      subrsOf(glyph),
    );
  };
}

function readIndex(view: DataView, offset: number): Index {
  const count = view.getUint16(offset);
  if (count === 0) {
    return { count, start: () => offset, end: () => offset, after: offset + 2 };
  }
  const offSize = view.getUint8(offset + 2);
  const readOffset = (i: number) => {
    let value = 0;
    for (let b = 0; b < offSize; b++) {
      value = value * 256 + view.getUint8(offset + 3 + i * offSize + b);
    }
    return value;
  };
  // Offsets count from 1, from the byte before the data.
  const base = offset + 2 + (count + 1) * offSize;
  return {
    count,
    start: (i) => base + readOffset(i),
    end: (i) => base + readOffset(i + 1),
    after: base + readOffset(count),
  };
}

function readDict(view: DataView, start: number, end: number): Dict {
  const dict: Dict = new Map();
  let operands: number[] = [];
  for (let i = start; i < end;) {
    const b0 = view.getUint8(i);
    if (b0 <= 21) {
      const key = b0 === 12 ? 1200 + view.getUint8(i + 1) : b0;
      i += b0 === 12 ? 2 : 1;
      dict.set(key, operands);
      operands = [];
    } else if (b0 === 30) {
      // A real number, as nibbles. Bounds never need one, so it's skipped.
      for (i++; ; i++) {
        const byte = view.getUint8(i);
        if ((byte & 0x0f) === 0x0f || byte >> 4 === 0x0f) break;
      }
      i++;
      operands.push(0);
    } else {
      const [value, length] = readNumber(view, i);
      operands.push(value);
      i += length;
    }
  }
  return dict;
}

/**
 * A DICT or charstring integer operand, and how many bytes it takes.
 */
function readNumber(view: DataView, i: number): [number, number] {
  const b0 = view.getUint8(i);
  if (b0 >= 32 && b0 <= 246) return [b0 - 139, 1];
  if (b0 >= 247 && b0 <= 250) return [(b0 - 247) * 256 + view.getUint8(i + 1) + 108, 2];
  if (b0 >= 251 && b0 <= 254) return [-(b0 - 251) * 256 - view.getUint8(i + 1) - 108, 2];
  if (b0 === 28) return [view.getInt16(i + 1), 3];
  if (b0 === 29) return [view.getInt32(i + 1), 5];
  throw new UnsupportedCharstring(`Unknown operand ${b0}`);
}

/**
 * The font dict index of each glyph of a CID-keyed font.
 */
function fdSelect(view: DataView, offset: number, glyphs: number): (glyph: number) => number {
  const format = view.getUint8(offset);
  if (format === 0) {
    return (glyph) => view.getUint8(offset + 1 + glyph);
  }
  if (format !== 3) {
    throw new UnsupportedCharstring(`Unknown FDSelect format ${format}`);
  }
  const ranges = view.getUint16(offset + 1);
  const fds = new Uint8Array(glyphs);
  for (let r = 0; r < ranges; r++) {
    const range = offset + 3 + r * 3;
    const first = view.getUint16(range);
    const next = view.getUint16(range + 3);
    fds.fill(view.getUint8(range + 2), first, Math.min(next, glyphs));
  }
  return (glyph) => fds[glyph];
}

function subrBias(subrs: Index | null): number {
  const count = subrs?.count ?? 0;
  return count < 1240 ? 107 : count < 33900 ? 1131 : 32768;
}

/**
 * Run a Type 2 charstring for the horizontal extent of its points.
 * Control points count too, which can only widen the span a little.
 */
function inkSpan(
  view: DataView,
  start: number,
  end: number,
  globalSubrs: Index,
  localSubrs: Index | null,
): InkSpan | null {
  let x = 0;
  let y = 0;
  let xMin = Infinity;
  let xMax = -Infinity;
  let stack: number[] = [];
  let stems = 0;
  let widthRead = false;
  let ended = false;

  const point = (dx: number, dy: number) => {
    x += dx;
    y += dy;
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
  };
  // The first stack-clearing operator may hold the advance width as an extra first operand.
  const dropWidth = (hasWidth: boolean) => {
    if (!widthRead && hasWidth) stack.shift();
    widthRead = true;
  };
  const curves = (args: number[]) => {
    for (let i = 0; i + 6 <= args.length; i += 6) {
      point(args[i], args[i + 1]);
      point(args[i + 2], args[i + 3]);
      point(args[i + 4], args[i + 5]);
    }
  };

  const run = (from: number, to: number, depth: number) => {
    if (depth > 10) throw new UnsupportedCharstring("Subroutines nest too deep");
    for (let i = from; i < to && !ended;) {
      const b0 = view.getUint8(i);
      if (b0 === 255) {
        stack.push(view.getInt32(i + 1) / 65536);
        i += 5;
        continue;
      }
      if (b0 >= 32 || b0 === 28) {
        const [value, length] = readNumber(view, i);
        stack.push(value);
        i += length;
        continue;
      }
      i++;
      switch (b0) {
        case 1: // hstem
        case 3: // vstem
        case 18: // hstemhm
        case 23: // vstemhm
          dropWidth(stack.length % 2 === 1);
          stems += stack.length >> 1;
          stack = [];
          break;
        case 19: // hintmask
        case 20: // cntrmask
          dropWidth(stack.length % 2 === 1);
          stems += stack.length >> 1;
          stack = [];
          i += (stems + 7) >> 3;
          break;
        case 21: // rmoveto
          dropWidth(stack.length > 2);
          point(stack[0], stack[1]);
          stack = [];
          break;
        case 22: // hmoveto
          dropWidth(stack.length > 1);
          point(stack[0], 0);
          stack = [];
          break;
        case 4: // vmoveto
          dropWidth(stack.length > 1);
          point(0, stack[0]);
          stack = [];
          break;
        case 5: // rlineto
          for (let k = 0; k + 2 <= stack.length; k += 2) point(stack[k], stack[k + 1]);
          stack = [];
          break;
        case 6: // hlineto
        case 7: // vlineto
          stack.forEach((delta, k) => {
            const horizontal = (k % 2 === 0) === (b0 === 6);
            point(horizontal ? delta : 0, horizontal ? 0 : delta);
          });
          stack = [];
          break;
        case 8: // rrcurveto
          curves(stack);
          stack = [];
          break;
        case 24: // rcurveline
          curves(stack.slice(0, -2));
          point(stack[stack.length - 2], stack[stack.length - 1]);
          stack = [];
          break;
        case 25: // rlinecurve
          for (let k = 0; k + 2 <= stack.length - 6; k += 2) point(stack[k], stack[k + 1]);
          curves(stack.slice(-6));
          stack = [];
          break;
        case 26: // vvcurveto
        case 27: {
          // hhcurveto
          let k = 0;
          let first = stack.length % 4 === 1 ? stack[k++] : 0;
          for (; k + 4 <= stack.length; k += 4) {
            if (b0 === 26) curves([first, stack[k], stack[k + 1], stack[k + 2], 0, stack[k + 3]]);
            else curves([stack[k], first, stack[k + 1], stack[k + 2], stack[k + 3], 0]);
            first = 0;
          }
          stack = [];
          break;
        }
        case 30: // vhcurveto
        case 31: {
          // hvcurveto
          let horizontal = b0 === 31;
          for (let k = 0; k + 4 <= stack.length; k += 4) {
            const last = k + 8 > stack.length && k + 5 === stack.length ? stack[k + 4] : 0;
            const [a, b, c, d] = stack.slice(k, k + 4);
            curves(horizontal ? [a, 0, b, c, last, d] : [0, a, b, c, d, last]);
            horizontal = !horizontal;
          }
          stack = [];
          break;
        }
        case 10: // callsubr
        case 29: {
          // callgsubr
          const subrs = b0 === 10 ? localSubrs : globalSubrs;
          const index = stack.pop()! + subrBias(subrs);
          if (!subrs || index < 0 || index >= subrs.count) {
            throw new UnsupportedCharstring("Missing subroutine");
          }
          run(subrs.start(index), subrs.end(index), depth + 1);
          break;
        }
        case 11: // return
          return;
        case 14: // endchar
          dropWidth(stack.length === 1 || stack.length === 5);
          ended = true;
          return;
        case 12: {
          const op = view.getUint8(i++);
          const s = stack;
          if (op === 34) {
            // hflex
            curves([s[0], 0, s[1], s[2], s[3], 0, s[4], 0, s[5], -s[2], s[6], 0]);
          } else if (op === 35) {
            // flex
            curves(s.slice(0, 12));
          } else if (op === 36) {
            // hflex1
            curves([
              s[0],
              s[1],
              s[2],
              s[3],
              s[4],
              0,
              s[5],
              0,
              s[6],
              s[7],
              s[8],
              -(s[1] + s[3] + s[7]),
            ]);
          } else if (op === 37) {
            // flex1
            const dx = s[0] + s[2] + s[4] + s[6] + s[8];
            const dy = s[1] + s[3] + s[5] + s[7] + s[9];
            const last = Math.abs(dx) > Math.abs(dy) ? [s[10], -dy] : [-dx, s[10]];
            curves([...s.slice(0, 10), ...last]);
          } else {
            throw new UnsupportedCharstring(`Unsupported operator 12 ${op}`);
          }
          stack = [];
          break;
        }
        default:
          throw new UnsupportedCharstring(`Unsupported operator ${b0}`);
      }
    }
  };

  run(start, end, 0);
  return xMin <= xMax ? { xMin, xMax } : null;
}
