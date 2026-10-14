import { describe, expect, it } from "vitest";
import { lineMarkup } from "./lyricMarkup";

describe("lineMarkup", () => {
  it("finds underscores and slashes", () => {
    expect(lineMarkup("Vel_o/ma trin").ranges).toEqual([
      { from: 3, to: 4, kind: "separator" },
      { from: 5, to: 6, kind: "separator" },
    ]);
  });

  it("finds row breaks", () => {
    expect(lineMarkup("Vel|o/|ma").ranges).toEqual([
      { from: 3, to: 4, kind: "separator" },
      { from: 5, to: 6, kind: "separator" },
      { from: 6, to: 7, kind: "separator" },
    ]);
  });

  it("finds a leading voice tag, and no separators inside it", () => {
    expect(lineMarkup("  [Ann_Bo+Cy/D] sos_sa").ranges).toEqual([
      { from: 2, to: 15, kind: "voice-tag" },
      { from: 19, to: 20, kind: "separator" },
    ]);
  });

  it("leaves a bracket after the start of the line alone", () => {
    expect(lineMarkup("lein [Ann]").ranges).toEqual([]);
  });

  it("marks a spacer line's slash", () => {
    expect(lineMarkup("/")).toEqual({ ranges: [{ from: 0, to: 1, kind: "separator" }] });
  });

  it("marks empty and whitespace-only lines as screen breaks", () => {
    expect(lineMarkup("").line).toBe("screen-break");
    expect(lineMarkup("  \t").line).toBe("screen-break");
    expect(lineMarkup("[Ann]").line).toBeUndefined();
  });
});
