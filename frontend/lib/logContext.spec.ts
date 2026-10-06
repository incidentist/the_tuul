import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { LYRIC_MARKERS } from "@/constants";
import { useLyricsStore } from "@/stores/lyrics";
import { useTimingsStore } from "@/stores/timings";
import { collectLogContext } from "./logContext";

describe("collectLogContext", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("is empty before the user has entered anything", () => {
        expect(collectLogContext()).toEqual({});
    });

    it("includes the lyrics", () => {
        useLyricsStore().setLyrics("la la\nla\n\n");

        expect(collectLogContext()).toEqual({ lyrics: "la la\nla\n\n" });
    });

    it("includes the timings", () => {
        const timings = [
            [1.5, LYRIC_MARKERS.SEGMENT_START],
            [2.25, LYRIC_MARKERS.SEGMENT_END],
        ] as [number, number][];
        useTimingsStore().resetTimings(timings);

        expect(collectLogContext()).toEqual({ timings });
    });

    it("includes both together", () => {
        useLyricsStore().setLyrics("la la");
        useTimingsStore().resetTimings([[1.5, LYRIC_MARKERS.SEGMENT_START]]);

        expect(Object.keys(collectLogContext()).sort()).toEqual(["lyrics", "timings"]);
    });
});
