export interface LyricsProviderInfo {
  id: string;
  name: string;
  url: string;
}

export interface LyricsLookupMatch {
  title: string;
  artist: string;
  album: string | null;
  duration: number | null;
  url: string | null;
}

export interface LyricsLookupResult {
  lyrics: string | null;
  instrumental: boolean;
  match: LyricsLookupMatch;
}

export interface LyricsQuery {
  title: string;
  artist: string;
  duration: number;
}

/**
 * Asks the server which lyrics provider it looks lyrics up with, or null when the lookup is off.
 */
export async function fetchLyricsProvider(): Promise<LyricsProviderInfo | null> {
  const response = await fetch("/lyrics/provider");
  if (!response.ok) {
    throw new Error(`The lyrics provider request failed with status ${response.status}`);
  }
  const body = await response.json();
  return body.provider ?? null;
}

/**
 * Looks the song up through the server. Resolves to null when the provider found nothing.
 */
export async function fetchLyrics(
  query: LyricsQuery,
  signal?: AbortSignal,
): Promise<LyricsLookupResult | null> {
  const response = await fetch("/lyrics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
    signal,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`The lyrics lookup failed with status ${response.status}`);
  }
  return response.json();
}

// A line holding only a section label, such as "[Chorus]", which would read as a voice tag.
const SECTION_LABEL = /^\s*\[[^\]\n]*\]\s*$/;

/**
 * Turns a provider's plain lyrics into lyric text the editor reads as intended.
 */
export function convertFetchedLyrics(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !SECTION_LABEL.test(line))
    .map((line) => line.replace(/[/_|]/g, " ").trimEnd());
  const kept: string[] = [];
  for (const line of lines) {
    if (line.trim() === "" && (kept.length === 0 || kept[kept.length - 1] === "")) {
      continue;
    }
    kept.push(line.trim() === "" ? "" : line);
  }
  while (kept.length > 0 && kept[kept.length - 1] === "") {
    kept.pop();
  }
  return kept.join("\n");
}

/**
 * Formats a duration in seconds as m:ss.
 */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
