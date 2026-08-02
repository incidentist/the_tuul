import { createPinia, setActivePinia } from 'pinia';
import { useTimingsStore } from './timings';
import { useLyricsStore } from './lyrics';
import { useMediaStore } from './media';
import { useSettingsStore } from './settings';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { KEY_CODES, LYRIC_MARKERS } from '@/constants';
import type { LyricEvent } from '@/lib/timing';

// Mock the createAssFile function
vi.mock('@/lib/timing', () => ({
  createAssFile: vi.fn().mockReturnValue('mock subtitles content'),
  DEFAULT_KARAOKE_OPTIONS: {}
}));

describe('Timings Store', () => {
  beforeEach(() => {
    // Create a fresh pinia instance for each test
    setActivePinia(createPinia());
  });

  test('should initialize with empty timings', () => {
    const timingsStore = useTimingsStore();
    expect(timingsStore.length).toBe(0);
    expect(timingsStore.rawTimings).toEqual([]);
  });

  test('should add timing events', () => {
    const timingsStore = useTimingsStore();
    timingsStore.add(0, 32, 1.0); // 32 is SPACEBAR code

    expect(timingsStore.length).toBe(1);
    expect(timingsStore.rawTimings).toEqual([[1.0, LYRIC_MARKERS.SEGMENT_START]]);
  });

  test('conflicts should be resolved', () => {
    const timings = useTimingsStore();

    timings.add(0, KEY_CODES.SPACEBAR, 1.0);
    timings.add(1, KEY_CODES.ENTER, 3.0);
    timings.add(2, KEY_CODES.SPACEBAR, 2.5);

    expect(timings.rawTimings[1]).toStrictEqual([2.5, LYRIC_MARKERS.SEGMENT_START]);
  });

  test('length should reflect the number of timings', () => {
    const timings = useTimingsStore();

    expect(timings.length).toBe(0);

    timings.add(0, KEY_CODES.SPACEBAR, 1.0);
    expect(timings.length).toBe(1);

    timings.add(1, KEY_CODES.ENTER, 3.0);
    expect(timings.length).toBe(2);
  });

  test('last should return the most recent timing', () => {
    const timings = useTimingsStore();

    // Initial state should return null
    expect(timings.last).toStrictEqual(null);

    timings.add(0, KEY_CODES.SPACEBAR, 1.0);
    expect(timings.last).toStrictEqual([1.0, LYRIC_MARKERS.SEGMENT_START]);

    timings.add(0, KEY_CODES.ENTER, 3.0);
    expect(timings.last).toStrictEqual([3.0, LYRIC_MARKERS.SEGMENT_END]);
  });

  test('resetTimings should replace all timings', () => {
    const timings = useTimingsStore();

    timings.add(0, KEY_CODES.SPACEBAR, 1.0);
    expect(timings.length).toBe(1);

    const newTimings: LyricEvent[] = [[2.0, LYRIC_MARKERS.SEGMENT_START], [5.0, LYRIC_MARKERS.SEGMENT_END]];
    timings.resetTimings(newTimings);

    expect(timings.length).toBe(2);
    expect(timings.rawTimings).toStrictEqual(newTimings);
  });

  test('timingForSegmentNum should find the correct segment start time', () => {
    const timings = useTimingsStore();

    timings.add(0, KEY_CODES.SPACEBAR, 1.0);
    timings.add(0, KEY_CODES.ENTER, 2.0);
    timings.add(1, KEY_CODES.SPACEBAR, 3.0);
    timings.add(1, KEY_CODES.ENTER, 4.0);

    expect(timings.timingForSegmentNum(0)).toBe(1.0);
    expect(timings.timingForSegmentNum(1)).toBe(3.0);
    // Segment that doesn't exist should return 0
    expect(timings.timingForSegmentNum(2)).toBe(0);
  });

  test('setCurrentSegment should truncate timings to the specified segment', () => {
    const timings = useTimingsStore();

    timings.add(0, KEY_CODES.SPACEBAR, 1.0);
    timings.add(0, KEY_CODES.ENTER, 2.0);
    timings.add(1, KEY_CODES.SPACEBAR, 3.0);
    timings.add(1, KEY_CODES.ENTER, 4.0);
    timings.add(2, KEY_CODES.SPACEBAR, 5.0);

    expect(timings.length).toBe(5);

    // Set back to segment 1
    timings.setCurrentSegment(1);

    // Should have removed the last timing (segment 2 start)
    expect(timings.length).toBe(2);
    expect(timings.last).toStrictEqual([2.0, LYRIC_MARKERS.SEGMENT_END]);

    // Set back to segment 0
    timings.setCurrentSegment(0);

    // Should have removed segment 1 timings
    expect(timings.length).toBe(0);
    expect(timings.last).toStrictEqual(null);
  });

  test('subtitles should return empty string if timings is empty', () => {
    const timingsStore = useTimingsStore();
    expect(timingsStore.subtitles()).toBe('');
  });

  test('subtitles should call createAssFile with correct parameters when timings exist', () => {
    // Setup the stores
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    const mediaStore = useMediaStore();
    const settingsStore = useSettingsStore();

    // Mock the store data
    lyricsStore.setLyrics('Test lyrics');
    // @ts-ignore - Mocking private property
    timingsStore._timings = [[1.0, LYRIC_MARKERS.SEGMENT_START], [2.0, LYRIC_MARKERS.SEGMENT_END]];
    // @ts-ignore - Mocking private properties
    mediaStore.songDuration = 10;
    mediaStore.songTitle = 'Test Song';
    mediaStore.songArtist = 'Test Artist';
    settingsStore.videoOptions = { test: 'options' };

    // Check the result
    expect(timingsStore.subtitles()).toBe('mock subtitles content');

    // Verify that createAssFile was called with the correct parameters
    const { createAssFile } = require('@/lib/timing');
    expect(createAssFile).toHaveBeenCalledWith(
      'Test lyrics',
      timingsStore.rawTimings,
      10,
      'Test Song',
      'Test Artist',
      { test: 'options' }
    );
  });
});
