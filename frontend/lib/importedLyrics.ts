// What the project importers share: lines of syllables become lyric markup with voice tags,
// and each voice's syllables become its timed segments.

import { parseLyrics } from "./timing";
import { clampDisplayPeriods, fromLyric, segmentWord, TimedSegment } from "./timedSegments";
import { parseAnnotatedLyrics, VoiceId } from "./voices";
import { BRACKETS_REMOVED, DISPLAY_PERIOD_WIDENED, Warnings } from "./importWarnings";

export interface ImportedSyllable {
  // The segment text without its separator, as parseLyrics will yield it.
  word: string;
  wordEnd: boolean;
  // A row break follows the syllable, within its line.
  breakAfter?: boolean;
  // Seconds.
  start?: number;
  end?: number;
  // The line's display period, on its first syllable only.
  displayStart?: number;
  displayEnd?: number;
}

/**
 * The line as lyric markup. Square brackets starting it would read as a voice tag, so they are
 * removed from the markup and the words alike.
 */
export function lineMarkup(syllables: ImportedSyllable[], warnings: Warnings): string {
  const separator = (s: ImportedSyllable) =>
    (s.wordEnd ? "" : "/") + (s.breakAfter ? "|" : s.wordEnd ? "_" : "");
  const markup = syllables
    .map((s, i) => (i === syllables.length - 1 ? s.word : s.word + separator(s)))
    .join("");
  if (!markup.startsWith("[")) {
    return markup;
  }
  warnings.add(BRACKETS_REMOVED);
  syllables.forEach((s) => (s.word = s.word.replace(/[[\]]/g, "")));
  return markup.replace(/[[\]]/g, "");
}

/**
 * Names as voice tags, where `+` separates voices and brackets delimit the tag.
 * A name left blank takes its fallback, and a repeated one a number.
 */
export function voiceNames(names: string[], fallback: (index: number) => string): VoiceId[] {
  const taken = new Set<string>();
  return names.map((name, index) => {
    const base =
      name
        .replace(/[+[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim() || fallback(index);
    let unique = base;
    for (let n = 2; taken.has(unique); n++) {
      unique = `${base} ${n}`;
    }
    taken.add(unique);
    return unique;
  });
}

/**
 * Each voice's segments, from the lyrics and the syllables of each voice in lyric order.
 * Throws when the syllables don't line up with the segments the lyrics yield.
 */
export function importedTimings(
  lyrics: string,
  syllablesByVoice: Record<VoiceId, ImportedSyllable[]>,
  warnings: Warnings,
): Record<VoiceId, TimedSegment[]> {
  const timings: Record<VoiceId, TimedSegment[]> = {};
  const annotated = parseAnnotatedLyrics(lyrics);
  for (const [voice, syllables] of Object.entries(syllablesByVoice)) {
    const segments = parseLyrics(annotated.lyricTextByVoice[voice] ?? "", true);
    const mismatch =
      segments.length !== syllables.length ||
      segments.some((segment, i) => segmentWord(segment.text).trim() !== syllables[i].word);
    if (mismatch) {
      throw new Error(`The converted timings for ${voice} don't line up with its lyrics.`);
    }
    const clamped = clampDisplayPeriods(
      segments.map((segment, i): TimedSegment => {
        const { start, end, displayStart, displayEnd } = syllables[i];
        return {
          ...fromLyric(segment),
          ...(start !== undefined ? { start } : {}),
          ...(end !== undefined ? { end } : {}),
          ...(displayStart !== undefined ? { displayStart } : {}),
          ...(displayEnd !== undefined ? { displayEnd } : {}),
        };
      }),
    );
    for (let i = 0; i < clamped.widened; i++) {
      warnings.add(DISPLAY_PERIOD_WIDENED);
    }
    timings[voice] = clamped.segments;
  }
  return timings;
}
