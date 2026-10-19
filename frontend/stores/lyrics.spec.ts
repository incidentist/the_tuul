import { createPinia, setActivePinia } from 'pinia';
import { useLyricsStore } from './lyrics';
import { beforeEach, describe, expect, test } from 'vitest';

describe('Lyrics Store', () => {
  beforeEach(() => {
    // Create a fresh pinia instance for each test
    setActivePinia(createPinia());
  });

  test('should initialize with empty lyrics', () => {
    const lyricsStore = useLyricsStore();
    expect(lyricsStore.lyricText).toBe('');
    expect(lyricsStore.lyricSegments).toEqual([]);
  });

  test('should update lyricText with setLyrics action', () => {
    const lyricsStore = useLyricsStore();
    const testLyrics = 'Hello world';

    lyricsStore.setLyrics(testLyrics);

    expect(lyricsStore.lyricText).toBe(testLyrics);
  });

  test('should parse simple lyrics into segments', () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('Hello\nWorld');

    expect(lyricsStore.lyricSegments).toEqual([
      { text: 'Hello\n' },
      { text: 'World' }
    ]);
  });

  test('should handle underscore separators', () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('Hello_World');

    expect(lyricsStore.lyricSegments).toEqual([
      { text: 'Hello_' },
      { text: 'World' }
    ]);
  });

  test('should handle slash separators within words', () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('Hel/lo');

    expect(lyricsStore.lyricSegments).toEqual([
      { text: 'Hel/' },
      { text: 'lo' }
    ]);
  });

  test('should handle combined separators', () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('Hell/o_World\nNew_Line');

    expect(lyricsStore.lyricSegments).toEqual([
      { text: 'Hell/' },
      { text: 'o_' },
      { text: 'World\n' },
      { text: 'New_' },
      { text: 'Line' }
    ]);
  });

  test('should handle empty lyrics', () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('');

    expect(lyricsStore.lyricSegments).toEqual([]);
  });

  test('should handle consecutive newlines', () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('Line 1\n\nLine 2');

    expect(lyricsStore.lyricSegments).toEqual([
      { text: 'Line 1\n\n' },
      { text: 'Line 2' }
    ]);
  });

  test('should handle leading newlines without crashing', () => {
    const lyricsStore = useLyricsStore();
    
    // This should not crash due to empty segments array access
    expect(() => {
      lyricsStore.setLyrics('\n\nHello world');
    }).not.toThrow();

    expect(lyricsStore.lyricSegments).toEqual([
      { text: 'Hello world' }
    ]);
  });

  test('should split lines into word segments when syncing by word', () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('Hello  big world\nNew line\n\nNext screen');
    lyricsStore.setSyncByWord(true);

    expect(lyricsStore.lyricText).toBe('Hello  big world\nNew line\n\nNext screen');
    expect(lyricsStore.timedLyricText).toBe('Hello_big_world\nNew_line\n\nNext_screen');
    expect(lyricsStore.lyricSegments).toEqual([
      { text: 'Hello_' },
      { text: 'big_' },
      { text: 'world\n' },
      { text: 'New_' },
      { text: 'line\n\n' },
      { text: 'Next_' },
      { text: 'screen' }
    ]);

    lyricsStore.setSyncByWord(false);
    expect(lyricsStore.timedLyricText).toBe(lyricsStore.lyricText);
    expect(lyricsStore.lyricSegments).toHaveLength(3);
  });
});
