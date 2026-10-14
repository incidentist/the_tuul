import { describe, expect, test } from "vitest";
import { Boundary, chooseRows, Piece } from "./lineWrap";

/**
 * Words of the given widths, a space of 1 after each, any of which may wrap.
 * A width ending in "," ends a clause, and one ending in "|" is followed by a break.
 */
function words(...specs: (number | string)[]): Piece[] {
  return specs.map((spec) => {
    const text = String(spec);
    const after: Boundary = text.endsWith("|") ? "break" : "wrap";
    return {
      width: parseFloat(text),
      space: 1,
      inkBefore: 0,
      inkAfter: 0,
      after,
      clause: text.endsWith(","),
    };
  });
}

describe("chooseRows", () => {
  test("keeps a line within the budget on one row", () => {
    expect(chooseRows(words(10, 10, 10), 32)).toEqual([]);
  });

  test("doesn't count the space after the last piece", () => {
    expect(chooseRows(words(10, 10), 21)).toEqual([]);
  });

  test("wraps into the fewest rows", () => {
    expect(chooseRows(words(10, 10, 10, 10, 10), 32)).toHaveLength(1);
    expect(chooseRows(words(10, 10, 10, 10, 10, 10, 10), 32)).toHaveLength(2);
  });

  test("balances the rows rather than filling the first one", () => {
    // Filling would give rows of 32 and 10.
    expect(chooseRows(words(10, 10, 10, 10), 35)).toEqual([2]);
  });

  test("prefers a wrap at the end of a clause over balance", () => {
    // The most even rows would wrap after the fourth word.
    expect(chooseRows(words(10, 10, "10,", 10, 10, 10, 10, 10), 60)).toEqual([3]);
    expect(chooseRows(words(10, 10, 10, 10, "10,", 10, 10, 10), 60)).toEqual([5]);
  });

  test("ignores a clause that would leave a row less than half as wide as another", () => {
    expect(chooseRows(words(10, 10, 10, "10,", 10), 45)).toEqual([2]);
  });

  test("still takes the fewest rows over a clause", () => {
    expect(chooseRows(words("10,", 10, 10, 10, 10, 10), 40)).toEqual([3]);
  });

  test("breaks a line that fits", () => {
    expect(chooseRows(words("10|", 10), 100)).toEqual([1]);
  });

  test("wraps a part between breaks that is too wide", () => {
    expect(chooseRows(words("10|", 10, 10, 10, 10), 25)).toEqual([1, 3]);
  });

  test("gives a piece wider than the budget a row of its own", () => {
    expect(chooseRows(words(10, 50, 10), 30)).toEqual([1, 2]);
  });

  test("wraps only where a piece allows it", () => {
    const piece = (space: number, after: Boundary): Piece => ({
      width: 10,
      space,
      inkBefore: 0,
      inkAfter: 0,
      after,
      clause: false,
    });
    const pieces = [piece(0, "none"), piece(1, "wrap"), piece(0, "none"), piece(0, "none")];
    expect(chooseRows(pieces, 30)).toEqual([2]);
  });

  test("counts the ink reaching out of a row on its wider side, twice, since it's centred", () => {
    const swash = (width: number, inkBefore: number, inkAfter: number): Piece => ({
      ...words(width)[0],
      inkBefore,
      inkAfter,
    });
    // Rows of 21 fit 25 unless their ink reaches out more than 2 on a side.
    expect(chooseRows([swash(10, 2, 0), ...words(10)], 25)).toEqual([]);
    expect(chooseRows([swash(10, 3, 0), ...words(10)], 25)).toEqual([1]);
    expect(chooseRows([...words(10), swash(10, 0, 3)], 25)).toEqual([1]);
  });

  test("only counts the ink of a row's ends", () => {
    const inner: Piece = { ...words(10)[0], inkBefore: 8, inkAfter: 8 };
    expect(chooseRows([...words(10), inner, ...words(10)], 32)).toEqual([]);
  });

  test("takes no time over a very long line", () => {
    const start = performance.now();
    chooseRows(words(...Array.from({ length: 400 }, () => 3)), 60);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
