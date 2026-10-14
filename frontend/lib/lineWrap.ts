// Choosing where a line breaks into rows.
// A line is a list of measured pieces here, with no knowledge of segments, fonts or timings.

// What may follow a piece: nothing, a wrap when the line is too wide,
// or a break whatever its width.
export type Boundary = "none" | "wrap" | "break";

export interface Piece {
  // The drawn width, without the whitespace after the piece.
  width: number;
  // The width of the whitespace after the piece, which a row doesn't draw at its end.
  space: number;
  // How far the piece's ink reaches before its start and past its width.
  inkBefore: number;
  inkAfter: number;
  after: Boundary;
  // Whether a wrap after the piece reads well, as at the end of a clause.
  clause: boolean;
}

// Pieces that can only wrap together.
interface Unit {
  first: number;
  width: number;
  space: number;
  inkBefore: number;
  // Where the furthest ink ends, from the unit's start.
  inkEnd: number;
  clause: boolean;
}

// A wrap at the end of a clause only counts when every row is at least this share of the widest,
// so that a comma near the end of a line doesn't leave a word alone on a row.
const CLAUSE_ROW_SHARE = 0.5;

// A pathologically long line can wrap in very many ways. Past this many, the best so far stands.
const MAX_CANDIDATES = 5000;

/**
 * The indexes of the pieces that start each row after the first.
 * A break always starts a row.
 * Between breaks, a part that doesn't fit wraps into the fewest rows that do,
 * preferring wraps at the end of a clause, and then rows of even widths.
 * A row fits when its ink, centred, spans no more than `budget`.
 */
export function chooseRows(pieces: Piece[], budget: number): number[] {
  const starts: number[] = [];
  let first = 0;
  pieces.forEach((piece, i) => {
    if (piece.after === "break" || i === pieces.length - 1) {
      starts.push(...(first > 0 ? [first] : []), ...wrapPart(pieces, first, i + 1, budget));
      first = i + 1;
    }
  });
  return starts;
}

/**
 * The row starts that wrap pieces[from, to), which hold no break.
 */
function wrapPart(pieces: Piece[], from: number, to: number, budget: number): number[] {
  const units = unitsOf(pieces, from, to);
  // offsets[i] is where unit i starts when the units before it share its row.
  const offsets = [0];
  units.forEach((unit) => offsets.push(offsets[offsets.length - 1] + unit.width + unit.space));
  const rowWidth = (i: number, j: number) => offsets[j] - offsets[i] - units[j - 1].space;
  // A row is centred on its width, so its ink spans twice what reaches out on the wider side.
  const inkSpan = (i: number, j: number) => {
    const last = units[j - 1];
    return rowWidth(i, j) + 2 * Math.max(units[i].inkBefore, last.inkEnd - last.width, 0);
  };
  // A unit wider than the budget can't wrap, so it takes a row of its own.
  const fits = (i: number, j: number) => j === i + 1 || inkSpan(i, j) <= budget;
  const n = units.length;
  if (fits(0, n)) {
    return [];
  }

  // The fewest rows the units from i on take.
  const fewest = new Array<number>(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    fewest[i] = Infinity;
    for (let j = i + 1; j <= n && fits(i, j); j++) {
      fewest[i] = Math.min(fewest[i], 1 + fewest[j]);
    }
  }

  let best = undefined as { starts: number[]; score: number; widest: number } | undefined;
  let candidates = 0;
  const visit = (starts: number[], rows: number) => {
    const i = starts[starts.length - 1];
    if (rows === 1) {
      if (!fits(i, n)) return;
      candidates++;
      const ends = [...starts.slice(1), n];
      const widths = starts.map((start, k) => rowWidth(start, ends[k]));
      const widest = Math.max(...widths);
      const even = Math.min(...widths) >= widest * CLAUSE_ROW_SHARE;
      const score = even ? starts.slice(1).filter((start) => units[start - 1].clause).length : 0;
      if (!best || score > best.score || (score === best.score && widest < best.widest)) {
        best = { starts, score, widest };
      }
      return;
    }
    for (let j = i + 1; j < n && fits(i, j) && candidates < MAX_CANDIDATES; j++) {
      if (fewest[j] === rows - 1) {
        visit([...starts, j], rows - 1);
      }
    }
  };
  visit([0], fewest[0]);
  return best!.starts.slice(1).map((unit) => units[unit].first);
}

/**
 * The part's pieces, joined into units wherever they can't wrap.
 */
function unitsOf(pieces: Piece[], from: number, to: number): Unit[] {
  const units: Unit[] = [];
  let unit: Unit | null = null;
  for (let i = from; i < to; i++) {
    const piece = pieces[i];
    unit ??= { first: i, width: 0, space: 0, inkBefore: 0, inkEnd: 0, clause: false };
    const start = i === unit.first ? 0 : unit.width + unit.space;
    unit.inkBefore = Math.max(unit.inkBefore, piece.inkBefore - start);
    unit.inkEnd = Math.max(unit.inkEnd, start + piece.width + piece.inkAfter);
    unit.width = start + piece.width;
    unit.space = piece.space;
    unit.clause = piece.clause;
    if (piece.after !== "none" || i === to - 1) {
      units.push(unit);
      unit = null;
    }
  }
  return units;
}
