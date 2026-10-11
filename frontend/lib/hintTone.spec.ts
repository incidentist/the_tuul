import { describe, expect, it } from "vitest";
import { addHintTone, hintToneWav, renderHintTone } from "./hintTone";

const SAMPLE_RATE = 8000;

function peak(samples: Float32Array, from: number, to: number): number {
  return samples
    .slice(Math.round(from * SAMPLE_RATE), Math.round(to * SAMPLE_RATE))
    .reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
}

describe("renderHintTone", () => {
  it("rises over its first third, and falls over the rest until a second after the title", () => {
    const samples = renderHintTone({ frequency: 220, seconds: 2 }, SAMPLE_RATE);

    expect(samples.length).toBe(3 * SAMPLE_RATE);
    expect(samples[0]).toBe(0);
    expect(peak(samples, 0, 0.1)).toBeLessThan(0.03);
    expect(peak(samples, 0.495, 0.505)).toBeCloseTo(0.125, 2);
    expect(peak(samples, 0.995, 1.005)).toBeCloseTo(0.25, 2);
    expect(peak(samples, 1.995, 2.005)).toBeCloseTo(0.125, 2);
    expect(peak(samples, 2.9, 3)).toBeLessThan(0.02);
  });

  it("plays the note's frequency", () => {
    const samples = renderHintTone({ frequency: 440, seconds: 1 }, SAMPLE_RATE);
    const rising = samples.filter(
      (sample, index) => index > 0 && samples[index - 1] < 0 && sample >= 0,
    ).length;

    expect(rising).toBeGreaterThanOrEqual(879);
    expect(rising).toBeLessThanOrEqual(880);
  });
});

describe("addHintTone", () => {
  it("adds the tone to every channel and leaves the rest of the track alone", () => {
    const channels = [new Float32Array(4 * SAMPLE_RATE), new Float32Array(4 * SAMPLE_RATE)];
    channels.forEach((channel) => channel.fill(0.1));
    const track = {
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 2,
      getChannelData: (channel: number) => channels[channel],
    };
    const tone = renderHintTone({ frequency: 110, seconds: 2 }, SAMPLE_RATE);
    addHintTone(track, { frequency: 110, seconds: 2 });

    expect(channels[1]).toEqual(channels[0]);
    expect(channels[0].slice(0, 3 * SAMPLE_RATE)).toEqual(
      tone.map((sample) => sample + Math.fround(0.1)),
    );
    expect(channels[0].slice(3 * SAMPLE_RATE).every((sample) => sample === Math.fround(0.1))).toBe(
      true,
    );
  });

  it("stops at the end of a track shorter than the tone", () => {
    const data = new Float32Array(SAMPLE_RATE);
    const track = { sampleRate: SAMPLE_RATE, numberOfChannels: 1, getChannelData: () => data };
    addHintTone(track, { frequency: 220, seconds: 4 });

    expect(data).toEqual(
      renderHintTone({ frequency: 220, seconds: 4 }, SAMPLE_RATE).slice(0, SAMPLE_RATE),
    );
  });
});

describe("hintToneWav", () => {
  it("writes the tone as a mono 16-bit WAV at 48 kHz", () => {
    const view = new DataView(hintToneWav({ frequency: 220, seconds: 1 }));
    const text = (offset: number) =>
      String.fromCharCode(...[0, 1, 2, 3].map((index) => view.getUint8(offset + index)));

    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(2 * 48000 * 2);
  });
});
