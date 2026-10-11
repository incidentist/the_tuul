import bufferToWav from "audiobuffer-to-wav";

// A note played from the start of the video.
export interface HintTone {
  frequency: number;
  // The title screen's length. The tone outlasts it by BLEED_SECONDS.
  seconds: number;
}

const LEVEL = 0.25;
const BLEED_SECONDS = 1;
const WAV_SAMPLE_RATE = 48000;

/**
 * The hint tone's samples, in mono: a sine that rises over its first third and falls over the
 * rest.
 */
export function renderHintTone(tone: HintTone, sampleRate: number): Float32Array {
  const { frequency } = tone;
  const seconds = tone.seconds + BLEED_SECONDS;
  const out = new Float32Array(Math.round(seconds * sampleRate));
  const rise = seconds / 3;
  for (let index = 0; index < out.length; index++) {
    const t = index / sampleRate;
    const envelope = Math.min(t / rise, (seconds - t) / (seconds - rise));
    out[index] = envelope * LEVEL * Math.sin(2 * Math.PI * frequency * t);
  }
  return out;
}

/**
 * Add the hint tone to the start of every channel.
 */
export function addHintTone(
  buffer: Pick<AudioBuffer, "sampleRate" | "numberOfChannels" | "getChannelData">,
  tone: HintTone,
): void {
  const samples = renderHintTone(tone, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < Math.min(samples.length, data.length); index++) {
      data[index] += samples[index];
    }
  }
}

/**
 * The hint tone as a mono WAV file.
 */
export function hintToneWav(tone: HintTone): ArrayBuffer {
  const samples = renderHintTone(tone, WAV_SAMPLE_RATE);
  return bufferToWav({
    numberOfChannels: 1,
    sampleRate: WAV_SAMPLE_RATE,
    getChannelData: () => samples,
  } as unknown as AudioBuffer);
}
