import type { Playable } from "@/lib/exclusivePlayback";

// Firefox only routes the media keys to a page whose media element plays loud enough to count.
// It ignored −78 dBFS and took −60 dBFS. A 15 Hz sine is below the range of hearing.
const FREQUENCY = 15;
const LEVEL_DBFS = -54;
const SAMPLE_RATE = 8000;
// Firefox ignores media shorter than 3 s, taking it for a notification sound.
const SECONDS = 4;

let anchorUrl: string | null = null;

/**
 * The sine as a 16-bit mono WAV, which loops without a seam as it holds whole periods.
 */
function sineWav(): Blob {
  const samples = SAMPLE_RATE * SECONDS;
  const view = new DataView(new ArrayBuffer(44 + samples * 2));
  const text = (offset: number, value: string) =>
    [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  const amplitude = 0x7fff * 10 ** (LEVEL_DBFS / 20);
  for (let i = 0; i < samples; i++) {
    const sample = amplitude * Math.sin((2 * Math.PI * FREQUENCY * i) / SAMPLE_RATE);
    view.setInt16(44 + i * 2, Math.round(sample), true);
  }
  return new Blob([view], { type: "audio/wav" });
}

/**
 * Loop an inaudible media element for as long as `player` plays, so that a player outside any
 * media element still gets the media keys in Firefox.
 */
export function anchorMediaKeys(player: Playable): () => void {
  anchorUrl ??= URL.createObjectURL(sineWav());
  const anchor = new Audio(anchorUrl);
  anchor.loop = true;
  const onPlay = () => {
    anchor.play().catch((error) => console.warn("Could not take the media keys:", error));
  };
  const onStop = () => anchor.pause();
  player.addEventListener("play", onPlay);
  player.addEventListener("pause", onStop);
  return () => {
    player.removeEventListener("play", onPlay);
    player.removeEventListener("pause", onStop);
    anchor.pause();
    anchor.removeAttribute("src");
    anchor.load();
  };
}
