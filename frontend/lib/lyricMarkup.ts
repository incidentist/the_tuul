import { LineMarkup, MarkupRange, markupHighlighter } from "@/lib/codeEditor";
import { TAG_PATTERN } from "@/lib/voices";

/**
 * The markup in one line of lyrics, in order: a leading voice tag, then each `_`, `/` and `|`.
 * A blank line breaks the screen rather than holding a lyric.
 */
export function lineMarkup(line: string): LineMarkup {
  if (line.trim() === "") {
    return { ranges: [], line: "screen-break" };
  }
  const ranges: MarkupRange[] = [];
  const tag = line.match(TAG_PATTERN);
  let start = 0;
  if (tag) {
    start = tag[0].length;
    ranges.push({ from: line.indexOf("["), to: line.indexOf("]") + 1, kind: "voice-tag" });
  }
  for (let i = start; i < line.length; i++) {
    if (line[i] === "_" || line[i] === "/" || line[i] === "|") {
      ranges.push({ from: i, to: i + 1, kind: "separator" });
    }
  }
  return { ranges };
}

/**
 * Highlights the lyric markup: voice tags, separators, and the blank lines between screens.
 */
export const lyricMarkup = markupHighlighter(lineMarkup);
