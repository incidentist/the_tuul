import { describe, expect, it } from "vitest";
import { hintFrequency } from "./notes";

describe("hintFrequency", () => {
  it.each([
    ["A4", 440],
    ["a4", 440],
    ["C4", 261.63],
    ["F#3", 185],
    ["Gb3", 185],
    ["G♭3", 185],
    ["Bb2", 116.54],
    ["b2", 123.47],
    [" A1 ", 55],
    ["G6", 1567.98],
  ])("tunes the note %j to %f Hz", (text, frequency) => {
    expect(hintFrequency(text)).toBeCloseTo(frequency, 2);
  });

  it.each([
    ["432", 432],
    ["219.5", 219.5],
    ["440 Hz", 440],
    ["55hz", 55],
    ["1568", 1568],
  ])("takes %j as a frequency", (text, frequency) => {
    expect(hintFrequency(text)).toBe(frequency);
  });

  it.each(["", "H4", "A#", "4", "G1", "G#6", "A7", "54", "1569", "-220", "1e3"])(
    "has no frequency for %j",
    (text) => {
      expect(hintFrequency(text)).toBeNull();
    },
  );
});
