// The lyrics a timings.txt file carries, since each of its syllables holds its own text.

import { joinLyrics, parseLyrics } from "./timing";
import { TimedSegment } from "./timedSegments";
import { DEFAULT_VOICE_ID, VoiceId, parseAnnotatedLyrics } from "./voices";

/**
 * The lyric text the voices' segments were cut from. Each voice is tagged on a line of its own,
 * unless the default voice is the only one.
 */
export function lyricsOf(voices: Record<VoiceId, TimedSegment[]>): string {
  const entries = Object.entries(voices);
  if (entries.length === 1 && entries[0][0] === DEFAULT_VOICE_ID) {
    return joinLyrics(entries[0][1]);
  }
  return entries.map(([voice, segments]) => `[${voice}]\n${joinLyrics(segments)}`).join("\n\n");
}

/**
 * Whether the lyrics cut into the same segments as the voices they name, whatever their formatting.
 * Files once carried voices that had left the lyrics, so a voice the lyrics don't name doesn't count,
 * unless the lyrics name none at all.
 */
export function lyricsMatch(lyricText: string, voices: Record<VoiceId, TimedSegment[]>): boolean {
  const { voices: lyricVoices, lyricTextByVoice } = parseAnnotatedLyrics(lyricText);
  if (lyricVoices.length === 0) return Object.keys(voices).length === 0;
  return lyricVoices.every((voice) => {
    const cut = parseLyrics(lyricTextByVoice[voice] ?? "", true);
    const segments = voices[voice] ?? [];
    return (
      voice in voices &&
      cut.length === segments.length &&
      cut.every(
        (segment, i) =>
          segment.text === segments[i].text &&
          (segment.spacersBefore ?? 0) === (segments[i].spacersBefore ?? 0) &&
          (segment.spacersAfter ?? 0) === (segments[i].spacersAfter ?? 0),
      )
    );
  });
}
