import { useLyricsStore } from "@/stores/lyrics";
import { useTimingsStore } from "@/stores/timings";

export function collectLogContext(): Record<string, unknown> {
    const lyrics = useLyricsStore().lyricText;
    const timings = useTimingsStore().rawTimings;

    const context: Record<string, unknown> = {};
    if (lyrics) {
        context.lyrics = lyrics;
    }
    if (timings.length > 0) {
        context.timings = timings;
    }
    return context;
}
