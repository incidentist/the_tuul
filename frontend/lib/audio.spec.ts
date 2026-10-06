import { describe, it, expect } from "vitest";
import { prependSilenceToChannels } from "./audio";

describe("prependSilenceToChannels", () => {
    it("pads each channel with exactly the delay, followed by the song", () => {
        const sampleRate = 10;
        const left = Float32Array.from([1, 2, 3]);
        const right = Float32Array.from([-1, -2, -3]);

        const [paddedLeft, paddedRight] = prependSilenceToChannels([left, right], sampleRate, 0.5);

        expect(Array.from(paddedLeft)).toEqual([0, 0, 0, 0, 0, 1, 2, 3]);
        expect(Array.from(paddedRight)).toEqual([0, 0, 0, 0, 0, -1, -2, -3]);
    });

    it("rounds a fractional sample offset to an integer", () => {
        // 5.88 s at 44.1 kHz is 259308 samples; 0.123 s at 1 kHz is 123
        const song = new Float32Array(3 * 44100).fill(0.5);
        const [padded] = prependSilenceToChannels([song], 44100, 5.88);
        expect(padded.length).toBe(song.length + 259308);
        expect(padded[259307]).toBe(0);
        expect(padded[259308]).toBe(0.5);
        expect(padded[padded.length - 1]).toBe(0.5);

        const [short] = prependSilenceToChannels([Float32Array.from([1])], 1000, 0.1234);
        expect(short.length).toBe(124);
        expect(short[123]).toBe(1);
    });

    it("returns an unpadded copy for zero delay", () => {
        const song = Float32Array.from([1, 2]);
        const [padded] = prependSilenceToChannels([song], 44100, 0);
        expect(Array.from(padded)).toEqual([1, 2]);
        expect(padded).not.toBe(song);
    });
});
