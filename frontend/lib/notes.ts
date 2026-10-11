const PITCH_CLASSES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACCIDENTALS: Record<string, number> = { "": 0, "#": 1, "♯": 1, b: -1, "♭": -1 };

const NOTE_PATTERN = /^([A-Ga-g])([#♯b♭]?)(\d)$/;
const FREQUENCY_PATTERN = /^(\d+(?:\.\d+)?)\s*(?:hz)?$/i;

// MIDI numbers of A1 and G6.
const LOWEST_NOTE = 33;
const HIGHEST_NOTE = 91;

/**
 * The frequency of a MIDI note, in equal temperament with A4 at 440 Hz.
 */
function midiFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export const LOWEST_HINT_FREQUENCY = Math.round(midiFrequency(LOWEST_NOTE));
export const HIGHEST_HINT_FREQUENCY = Math.round(midiFrequency(HIGHEST_NOTE));

/**
 * The frequency of a hint typed as a note, such as "C#4" or "Bb2", or in Hz, such as "220",
 * or null when it is neither or falls outside A1 to G6.
 */
export function hintFrequency(text: string): number | null {
  const trimmed = text.trim();
  const note = NOTE_PATTERN.exec(trimmed);
  if (note) {
    const [, letter, accidental, octave] = note;
    const midi =
      12 * (Number(octave) + 1) + PITCH_CLASSES[letter.toUpperCase()] + ACCIDENTALS[accidental];
    return midi >= LOWEST_NOTE && midi <= HIGHEST_NOTE ? midiFrequency(midi) : null;
  }
  const frequency = FREQUENCY_PATTERN.exec(trimmed);
  if (frequency) {
    const hertz = Number(frequency[1]);
    return hertz >= LOWEST_HINT_FREQUENCY && hertz <= HIGHEST_HINT_FREQUENCY ? hertz : null;
  }
  return null;
}
