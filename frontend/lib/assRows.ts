// Joining the rows the app writes for a line back into one event, as an import reads lines.

import { AssEvent, parseKaraoke } from "./ass";
import { ROW_MARKERS, RowStart } from "./timing";

const ROW_STARTS = Object.entries(ROW_MARKERS) as [RowStart, string][];

/**
 * The events, with each row that continues a line joined to the event before it.
 * The app writes a line's rows one after another, with the same period and override tags.
 */
export function joinRows(events: AssEvent[]): AssEvent[] {
  const joined: AssEvent[] = [];
  for (const event of events) {
    const row = ROW_STARTS.find(([, marker]) => event.text.startsWith(marker));
    const previous = joined[joined.length - 1];
    if (!row || !previous) {
      joined.push(event);
      continue;
    }
    const [rowStart, marker] = row;
    const text = joinText(previous.text, event.text.slice(marker.length), rowStart);
    joined[joined.length - 1] = { ...previous, text };
  }
  return joined;
}

/**
 * The text of a row followed by the next one, whose override blocks before its first syllable
 * repeat the row's own, apart from its lead-in.
 * A break from the lyrics becomes a hard line break at the start of the next row's text.
 */
function joinText(row: string, next: string, rowStart: RowStart): string {
  const [leading] = next.match(/^(\{[^}]*\})*/)!;
  const blocks = leading.match(/\{[^}]*\}/g) ?? [];
  // A row's first syllable starts with a \kf tag, after a lead-in that is a bare \k.
  const first = blocks.findIndex((block) => /\\kf/.test(block));
  const kept = first === -1 ? [] : blocks.slice(first);
  const body = kept.join("") + (rowStart === "break" ? "\\N" : "") + next.slice(leading.length);
  const leadIn = Number(leading.match(/\\k(\d+)/)?.[1] ?? 0);

  const { timed, syllables } = parseKaraoke(row);
  if (!timed) {
    return row + body;
  }
  const last = syllables[syllables.length - 1];
  const gap = Math.max(0, leadIn - (last.start + last.duration));
  if (rowStart !== "wrapInSyllable") {
    return row + (gap > 0 ? `{\\k${gap}}` : "") + body;
  }
  // The two halves of the syllable become one again.
  // The second half's \kf follows the whitespace between the rows, which the lead-in holds.
  const [halfTag, space, half] = body.match(/^(\s*)\{\\kf(\d+)\}/) ?? ["", "", "0"];
  const lastTag = row.lastIndexOf("\\kf");
  const [whole, duration] = row.slice(lastTag).match(/^\\kf(\d+)/)!;
  return (
    row.slice(0, lastTag) +
    `\\kf${Number(duration) + gap + Number(half)}` +
    row.slice(lastTag + whole.length) +
    space +
    body.slice(halfTag.length)
  );
}
