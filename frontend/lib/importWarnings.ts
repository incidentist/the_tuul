// Messages shared by the importers,
// so every kind of imported file reports the same change the same way.
export const MARKUP_REMOVED =
  "A / or _ in the lyrics was removed, since the app uses both as markup";
export const BRACKETS_REMOVED =
  "Square brackets starting a line were removed, since they would read as a voice tag";
export const SPACER_PAGE_DROPPED = "A page holding only blank spacer lines was dropped";
export const SPACER_BOUNDS_DROPPED =
  "A blank spacer line's display times were dropped, since it shows nothing";
export const DISPLAY_PERIOD_WIDENED = "A line's display period was widened to contain its timings";
export const SPACER_MUTE_DROPPED =
  "A blank spacer line's mute times were dropped, since nobody sings it";
export const MUTE_PERIOD_WIDENED = "A line's muted period was widened to cover its timings";
export const TIMES_WENT_BACKWARDS = "A line's times go backwards, so it was flagged for review";

export function fontLeftOut(fontName: string): string {
  return `The font "${fontName}" isn't bundled with the app, so it was left out`;
}

/**
 * Counts each kind of dropped item once, so a long song yields a short list.
 */
export class Warnings {
  private counts = new Map<string, number>();

  add(message: string): void {
    this.counts.set(message, (this.counts.get(message) ?? 0) + 1);
  }

  list(): string[] {
    return [...this.counts].map(([message, count]) =>
      count > 1 ? `${message} (×${count})` : message,
    );
  }
}
