import { describe, it, expect } from "vitest";
import { lyricsMatch, lyricsOf } from "./timingsLyrics";
import { parseTimingsText, writeTimingsText } from "./timingsText";
import { parseAnnotatedLyrics } from "./voices";
import { parseLyrics } from "./timing";
import { fromLyric } from "./timedSegments";

function timed(lyrics: string) {
  const { lyricTextByVoice } = parseAnnotatedLyrics(lyrics);
  return Object.fromEntries(
    Object.entries(lyricTextByVoice).map(([voice, text]) => [
      voice,
      parseLyrics(text, true).map((segment, i) => ({ ...fromLyric(segment), start: i + 1 })),
    ]),
  );
}

describe("lyricsOf", () => {
  it("gives back lyrics that cut into the same segments", () => {
    const voices = timed("ka/den_lu\nso ta\n\nve_lo");
    expect(lyricsMatch(lyricsOf(voices), voices)).toBe(true);
  });

  it("keeps spacer lines", () => {
    const voices = timed("/\nka_den\n\nlu\n/");
    expect(lyricsMatch(lyricsOf(voices), voices)).toBe(true);
  });

  it("tags each voice when there is more than one", () => {
    const voices = timed("[Anna] ka_den\n[Ben] lu so\n[Anna] ve");
    const lyrics = lyricsOf(voices);
    expect(parseAnnotatedLyrics(lyrics).voices).toEqual(["Anna", "Ben"]);
    expect(lyricsMatch(lyrics, voices)).toBe(true);
  });

  it("reads back what a timings.txt file was written from", () => {
    const voices = timed("ka/den_lu\nso");
    const { voices: read } = parseTimingsText(writeTimingsText(voices, Object.keys(voices)));
    expect(lyricsMatch(lyricsOf(read), voices)).toBe(true);
  });
});

describe("lyricsMatch", () => {
  it("matches lyrics that only differ in formatting", () => {
    expect(lyricsMatch("ka__den\n\n\nlu\n", timed("ka_den\n\nlu"))).toBe(true);
  });

  it("tells a changed word apart", () => {
    expect(lyricsMatch("ka_den\nlo", timed("ka_den\nlu"))).toBe(false);
  });

  it("tells a split syllable apart", () => {
    expect(lyricsMatch("ka/den", timed("kaden"))).toBe(false);
  });

  it("tells another voice apart", () => {
    expect(lyricsMatch("[Anna] ka", timed("ka"))).toBe(false);
  });

  it("ignores a voice the lyrics don't name", () => {
    expect(lyricsMatch("[Anna] ka", timed("[Anna] ka\n[Ben] lu"))).toBe(true);
  });

  it("tells a voice the file doesn't hold apart", () => {
    expect(lyricsMatch("[Anna] ka\n[Ben] lu", timed("[Anna] ka"))).toBe(false);
  });

  it("doesn't match empty lyrics to a file with voices", () => {
    expect(lyricsMatch("", timed("ka"))).toBe(false);
  });
});
