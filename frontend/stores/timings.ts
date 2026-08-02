// stores/timings.ts
import { defineStore } from 'pinia';
import { KEY_CODES, LYRIC_MARKERS } from "@/constants";
import { pullAt } from 'lodash-es';
import { useLyricsStore } from './lyrics';
import { useMediaStore } from './media';
import { useSettingsStore } from './settings';
import { createAssFile, DEFAULT_KARAOKE_OPTIONS, LyricEvent } from "@/lib/timing";
import { VideoSettings } from './settings';

export const useTimingsStore = defineStore('timings', {
  state: () => ({
    _timings: [] as LyricEvent[]
  }),

  getters: {
    length(state): number { return state._timings.length; },

    last(state): LyricEvent | null {
      return this.length > 0 ? state._timings[this.length - 1] : null;
    },

    rawTimings: (state): LyricEvent[] => state._timings,

    toArray: (state) => () => {
      return state._timings;
    },

    toJson: (state) => () => {
      return JSON.stringify(state._timings);
    },
    areTimingsUsable(state): boolean {
      // Check if we have any timings
      if (this.length === 0) {
        return false;
      }

      // Get the lyric segments from the lyrics store
      const lyricsStore = useLyricsStore();
      const lyricSegments = lyricsStore.lyricSegments;

      if (!lyricSegments || lyricSegments.length === 0) {
        return false;
      }

      // Count how many segment starts we have
      const startMarkers = state._timings.filter(t => t[1] === LYRIC_MARKERS.SEGMENT_START);

      // Check if we have timing markers for all segments
      if (startMarkers.length < lyricSegments.length) {
        return false;
      }
      return true;
    },
    areTimingsFinished(state): boolean {
      // Timings are fully finished when we've marked the end of the last segment
      return this.areTimingsUsable && state._timings[this.length - 1][1] === LYRIC_MARKERS.SEGMENT_END;
    },
    subtitles() {
      return (options: Partial<VideoSettings> = {}): string => {
        // Return empty string if there are no timings at all
        if (this.length === 0) {
          return "";
        }

        const lyricsStore = useLyricsStore();
        const mediaStore = useMediaStore();
        const settingsStore = useSettingsStore();

        if (mediaStore.songDuration === null || mediaStore.songTitle === null || mediaStore.songArtist === null) {
          return "";
        }

        try {
          const videoOptions = settingsStore.videoOptions || DEFAULT_KARAOKE_OPTIONS;
          
          const adjustedOptions = {
            ...videoOptions,
            ...options
          };
          
          return createAssFile(
            lyricsStore.lyricText,
            this.rawTimings,
            mediaStore.songDuration,
            mediaStore.songTitle,
            mediaStore.songArtist,
            adjustedOptions
          );
        } catch (e) {
          console.error("Failed to create subtitles", e);
          return "";
        }
      };
    }
  },

  actions: {
    add(currentSegmentNum: number, keyCode: number, timestamp: number) {
      if (currentSegmentNum < 0) {
        return;
      }

      const marker =
        keyCode == KEY_CODES.SPACEBAR
          ? LYRIC_MARKERS.SEGMENT_START
          : LYRIC_MARKERS.SEGMENT_END;

      if (marker == LYRIC_MARKERS.SEGMENT_START) {
        this.handleConflictWithPreviousSegment(timestamp);
      }

      this._timings.push([timestamp, marker]);
    },

    handleConflictWithPreviousSegment(segmentStartTimestamp: number) {
      // If the user has entered a segment start time that is before the end of
      // the previous segment, adjust the end of the previous segment
      const previousTiming = this._timings.at(-1);
      if (!previousTiming || segmentStartTimestamp > previousTiming[0]) {
        return;
      }

      if (previousTiming[1] == LYRIC_MARKERS.SEGMENT_END) {
        pullAt(this._timings, [this._timings.length - 1]);
      }
    },

    timingForSegmentNum(segmentNum: number) {
      const starts = this._timings.filter(
        (t) => t[1] == LYRIC_MARKERS.SEGMENT_START
      );

      if (segmentNum >= starts.length) {
        return 0;
      }

      return starts[segmentNum][0];
    },

    setCurrentSegment(segmentNum: number) {
      // Set the segment we're currently listening for to segmentNum
      let i = 0,
        currentSegment = 0;

      while (i < this._timings.length) {
        if (this._timings[i][1] == LYRIC_MARKERS.SEGMENT_START) {
          currentSegment += 1;
        }

        if (currentSegment > segmentNum) {
          break;
        }

        i++;
      }

      this.resetTimings(this._timings.slice(0, i));
    },

    resetTimings(newTimings: LyricEvent[] = []) {
      this._timings = [...newTimings];
    }
  }
});
