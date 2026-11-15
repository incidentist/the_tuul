// Conversion of the app's project to a line-synced LRC file, for music players that show lyrics.

import { appName } from "@/constants";
import { displayText } from "./timing";
import { TimedSegment } from "./timedSegments";
import { parseAnnotatedLyrics, VoiceId } from "./voices";
import { parseSettingsYaml } from "./settingsFile";
import { Warnings } from "./importWarnings";

// Players usually show a line until the next one starts,
// so a longer silence after a released line gets an empty line of its own.
const CLEAR_AFTER_GAP = 3;

export const UNTIMED_LINES_LEFT_OUT = "Lines with no timed word were left out";

export interface LrcExportSource {
  lyrics: string;
  timings: Record<VoiceId, TimedSegment[]>;
  settings: string;
}

export interface LrcExport {
  lrc: string;
  warnings: string[];
}

interface LrcLine {
  start: number;
  // Only known when the line's last word has a release.
  end?: number;
  text: string;
}

/**
 * Formats seconds as `mm:ss.xx`.
 */
function timestamp(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const minutes = Math.floor(cs / 6000);
  const rest = cs % 6000;
  const secs = Math.floor(rest / 100);
  const hundredths = rest % 100;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(minutes)}:${pad(secs)}.${pad(hundredths)}`;
}

/**
 * A voice's segments as lines. A line is stamped with its first timed word.
 */
function voiceLines(segments: TimedSegment[], warnings: Warnings): LrcLine[] {
  const lines: LrcLine[] = [];
  let line: TimedSegment[] = [];

  const closeLine = () => {
    const text = line
      .map((segment) => displayText(segment.text.replace(/\n+$/, "")))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    const timed = line.filter((segment) => segment.start !== undefined);
    if (text !== "" && timed.length === 0) {
      warnings.add(UNTIMED_LINES_LEFT_OUT);
    } else if (text !== "") {
      lines.push({
        start: timed[0].start as number,
        end: timed[timed.length - 1].end,
        text,
      });
    }
    line = [];
  };

  for (const segment of segments) {
    line.push(segment);
    if (segment.text.endsWith("\n")) {
      closeLine();
    }
  }
  closeLine();
  return lines;
}

function tag(name: string, value: string | undefined): string[] {
  const clean = value?.replace(/[\r\n\]]+/g, " ").trim();
  return clean ? [`[${name}:${clean}]`] : [];
}

/**
 * Every voice's lines in one list ordered by time, since LRC has no voices.
 */
export function projectFilesToLrc(source: LrcExportSource): LrcExport {
  const warnings = new Warnings();
  const { song } = parseSettingsYaml(source.settings);
  const voices = parseAnnotatedLyrics(source.lyrics).voices;
  const lines = voices
    .flatMap((voice) => voiceLines(source.timings[voice] ?? [], warnings))
    .sort((a, b) => a.start - b.start);

  const body: string[] = [];
  // A line without a release lasts until the next line starts, so it never needs clearing.
  let lastRelease = -Infinity;
  lines.forEach((line, i) => {
    body.push(`[${timestamp(line.start)}]${line.text}`);
    if (line.end === undefined) return;
    lastRelease = Math.max(lastRelease, line.end);
    const next = lines[i + 1];
    if (!next || next.start - lastRelease >= CLEAR_AFTER_GAP) {
      body.push(`[${timestamp(lastRelease)}]`);
    }
  });

  const header = [
    ...tag("ti", song.title),
    ...tag("ar", song.artist),
    ...(song.duration ? tag("length", timestamp(song.duration).slice(0, 5)) : []),
    ...tag("re", appName()),
  ];
  return { lrc: [...header, ...body].join("\n") + "\n", warnings: warnings.list() };
}
