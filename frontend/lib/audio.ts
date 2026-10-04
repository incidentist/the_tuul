/**
 * Return copies of each channel with `secondsOfSilence` of silence at the start.
 * The silence is rounded to a whole number of samples, so the result is exactly
 * that many samples longer than the input.
 */
export function prependSilenceToChannels(
    channels: Float32Array[],
    sampleRate: number,
    secondsOfSilence: number
): Float32Array[] {
    const silenceSamples = Math.max(0, Math.round(secondsOfSilence * sampleRate));
    return channels.map((channel) => {
        const padded = new Float32Array(channel.length + silenceSamples);
        padded.set(channel, silenceSamples);
        return padded;
    });
}
