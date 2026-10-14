// stores/timings.ts
import { defineStore } from "pinia";
import { watch } from "vue";
import { LYRIC_MARKERS } from "@/constants";
import { findLastIndex } from "lodash-es";
import { useLyricsStore } from "./lyrics";
import { useMediaStore } from "./media";
import { useSettingsStore } from "./settings";
import { useAdvancedStore } from "./advanced";
import { useHistoryStore } from "./history";
import {
  createAssFile,
  createMultiVoiceAssFile,
  layOutVoices,
  resolveStarts,
  DEFAULT_KARAOKE_OPTIONS,
  Segment,
  VoiceTrack,
} from "@/lib/timing";
import { LinePlacement, placeLines } from "@/lib/linePlacements";
import { songOffset, titleFrameTime } from "@/lib/screenSlots";
import {
  TimedSegment,
  carryMovedLines,
  clearRetimedFlags,
  fromEvents,
  fromLyric,
  hasDisplayPeriod,
  normalizeDisplayPeriods,
  hasMuteBounds,
  normalizeMuteBounds,
  reconcile,
  toEvents,
} from "@/lib/timedSegments";
import { applyVoiceStyle } from "@/lib/voiceStyle";
import { VideoSettings } from "./settings";
import { VoiceId, DEFAULT_VOICE_ID, parseAnnotatedLyrics } from "@/lib/voices";
import { loadJsonFromStorage } from "@/lib/persistence";
import { writeTimingsText } from "@/lib/timingsText";
import { PendingSync, SyncResult, withSyncResult } from "@/lib/alignment";
import { GapPlan, planGaps } from "@/lib/gapRestore";

const SEGMENTS_STORAGE_KEY = "timings._segments";
// This key is read-only now.
// It holds the pre-TimedSegment shape, which is migrated on load and
// left in place so a failed migration can't destroy a user's timings.
const LEGACY_TIMINGS_STORAGE_KEY = "timings._timings";
const ACTIVE_VOICE_STORAGE_KEY = "timings._activeVoice";
// The undo history restores the baseline with the segments, so it must survive a reload with them.
const BASELINE_STORAGE_KEY = "timings._baseline";

type Timings = Array<[number, number]>;

// Video settings as a subtitle caller may override them:
// any subset, down to a single font or color field.
type VideoSettingsOverride = Partial<Omit<VideoSettings, "font" | "color">> & {
  font?: Partial<VideoSettings["font"]>;
  color?: Partial<VideoSettings["color"]>;
};
type TimingsByVoice = Record<VoiceId, Timings>;
type EditOptions = { keepReview?: boolean };
type SegmentsByVoice = Record<VoiceId, TimedSegment[]>;

/**
 * The lyrics as persisted, split per voice.
 * Read straight from localStorage rather than through the lyrics store,
 * which may not have hydrated yet when this store initializes.
 */
function storedLyricTextByVoice(): Record<VoiceId, string> {
  const text = loadJsonFromStorage<string>("lyrics.lyricText", "");
  return parseAnnotatedLyrics(text).lyricTextByVoice;
}

function migrateEvents(byVoice: TimingsByVoice): SegmentsByVoice {
  const lyricTextByVoice = storedLyricTextByVoice();
  const migrated: SegmentsByVoice = {};
  for (const [voice, events] of Object.entries(byVoice)) {
    migrated[voice] = fromEvents(lyricTextByVoice[voice] ?? "", events);
  }
  return migrated;
}

function loadSegmentsByVoice(): SegmentsByVoice {
  const stored = loadJsonFromStorage<SegmentsByVoice | null>(SEGMENTS_STORAGE_KEY, null);
  if (stored != null) {
    return stored;
  }

  const legacy = loadJsonFromStorage<Timings | TimingsByVoice | null>(
    LEGACY_TIMINGS_STORAGE_KEY,
    null,
  );
  if (legacy == null) {
    return {};
  }
  // The oldest shape is a single voice's flat event array.
  if (Array.isArray(legacy)) {
    return legacy.length > 0 ? migrateEvents({ [DEFAULT_VOICE_ID]: legacy }) : {};
  }
  return migrateEvents(legacy);
}

function isTimed(segments: TimedSegment[] | undefined): boolean {
  return segments?.some((segment) => segment.start !== undefined) ?? false;
}

function copySegments(segments: TimedSegment[]): TimedSegment[] {
  return segments.map((segment) => ({ ...segment }));
}

function copySegmentsByVoice(byVoice: SegmentsByVoice): SegmentsByVoice {
  return Object.fromEntries(
    Object.entries(byVoice).map(([voice, segments]) => [voice, copySegments(segments)]),
  );
}

/**
 * The voice rename that the lyric voices imply, if it is unambiguous (see `reconcileVoices`).
 */
function findVoiceRename(
  segmentsByVoice: SegmentsByVoice,
  voices: VoiceId[],
): { from: VoiceId; to: VoiceId } | null {
  const timed = (voice: VoiceId) => isTimed(segmentsByVoice[voice]);
  const orphans = Object.keys(segmentsByVoice).filter(
    (voice) => timed(voice) && !voices.includes(voice),
  );
  const untimed = voices.filter((voice) => !timed(voice));
  if (orphans.length !== 1 || untimed.length !== 1) {
    return null;
  }
  return { from: orphans[0], to: untimed[0] };
}

function renameVoice<T>(
  byVoice: Record<VoiceId, T>,
  from: VoiceId,
  to: VoiceId,
): Record<VoiceId, T> {
  const { [from]: moved, ...rest } = byVoice;
  return { ...rest, [to]: moved };
}

/**
 * Every voice's segments carried across to the lyrics that `lyricSegmentsFor` gives.
 * Each voice is reconciled from its baseline, with the lines that a tag change moved from another
 * voice, and a voice the lyrics no longer mention is kept as it is.
 */
function reconcileByVoice(
  segmentsByVoice: SegmentsByVoice,
  baselineByVoice: SegmentsByVoice,
  voices: VoiceId[],
  previousVoices: VoiceId[],
  lyricSegmentsFor: (voice: VoiceId) => Segment[],
): SegmentsByVoice {
  // A voice with no baseline yet falls back to its current segments,
  // which is the older chaining behavior, rather than a crash.
  const baselines = Object.fromEntries(
    Object.entries(segmentsByVoice).map(([voice, segments]) => [
      voice,
      baselineByVoice[voice] ?? segments,
    ]),
  );
  // A voice that has just left the lyrics can give its lines away, but a parked one can't,
  // or a line typed today could take the timing of one deleted long ago.
  const departed = previousVoices.filter((voice) => !voices.includes(voice));
  const carried = carryMovedLines(
    baselines,
    Object.fromEntries([
      ...voices.map((voice) => [voice, lyricSegmentsFor(voice)]),
      ...departed.map((voice) => [voice, []]),
    ]),
  );
  const updated: SegmentsByVoice = {};
  for (const [voice, baseline] of Object.entries(carried)) {
    // A voice the lyrics no longer mention is parked, not reconciled against nothing:
    // retyping its tag has to bring the timings back (see reconcileVoices).
    updated[voice] = voices.includes(voice)
      ? reconcile(baseline, lyricSegmentsFor(voice))
      : segmentsByVoice[voice];
  }
  return updated;
}

export const useTimingsStore = defineStore("timings", {
  // Timings are stored per voice, never as a single shared stream.
  // Voices are fully independent (see frontend/lib/voices.ts for why):
  // they can overlap in time, so there is no one ordered timeline to share.
  // The single-array API below (rawTimings, add, resetTimings, ...) operates on the *active* voice,
  // which keeps every existing single-voice consumer working unchanged.
  // For a one-voice project the active voice is simply the only voice.
  state: () => {
    const segments = loadSegmentsByVoice();
    return {
      _segmentsByVoice: segments,
      // The last known state before a lyric change.
      // This is the only data `reconcileSegments` works from.
      // Reconciliation is lossy, so feeding it its own output once per keystroke destroys timings
      // that the finished edit would have kept.
      _baselineByVoice:
        loadJsonFromStorage<SegmentsByVoice | null>(BASELINE_STORAGE_KEY, null) ??
        copySegmentsByVoice(segments),
      _activeVoice: loadJsonFromStorage<VoiceId | null>(ACTIVE_VOICE_STORAGE_KEY, null),
      // The lyrics the segments were last carried across to.
      // The watchers skip a lyric write that was already reconciled, or restored by an undo.
      _reconciledLyricText: null as string | null,
      // Bumped to ask the Timing tab to go to the active voice's first segment to review.
      reviewRequest: 0,
    };
  },

  getters: {
    // The voice currently being timed.
    // All the single-array getters/actions below operate on this voice,
    // so existing single-voice consumers are unchanged (the active voice is the only voice).
    // Falls back to the first lyrics voice, then the default.
    activeVoice(state): VoiceId {
      const voices = useLyricsStore().voices;
      if (state._activeVoice && voices.includes(state._activeVoice)) {
        return state._activeVoice;
      }
      return voices[0] ?? DEFAULT_VOICE_ID;
    },

    /**
     * The positional event form the rest of the app still uses.
     * Untimed segments have no event, so this is lossy on purpose and is never read back into storage.
     */
    rawTimings(state): Timings {
      return toEvents(state._segmentsByVoice[this.activeVoice] ?? []);
    },

    activeSegments(state): TimedSegment[] {
      return state._segmentsByVoice[this.activeVoice] ?? [];
    },

    // The full per-voice timing map (used to export/import all voices at once).
    allTimings(state): TimingsByVoice {
      return Object.fromEntries(
        Object.entries(state._segmentsByVoice).map(([voice, segments]) => [
          voice,
          toEvents(segments),
        ]),
      );
    },

    length(): number {
      return this.rawTimings.length;
    },

    last(): [number, number] | null {
      const timings = this.rawTimings;
      return timings.length > 0 ? timings[timings.length - 1] : null;
    },

    toArray() {
      return () => this.rawTimings;
    },

    toJson() {
      return () => JSON.stringify(this.rawTimings);
    },

    areTimingsUsable(): boolean {
      if (this.length === 0) {
        return false;
      }

      const lyricSegments = useLyricsStore().segmentsForVoice(this.activeVoice);
      if (!lyricSegments || lyricSegments.length === 0) {
        return false;
      }

      // Every segment has to resolve a start,
      // but a hole between two timed segments resolves by interpolation,
      // so splitting a word you already timed doesn't put the song back to "unfinished" when it renders perfectly well.
      return resolveStarts(this.activeSegments).every((segment) => segment.start !== undefined);
    },

    areTimingsFinished(): boolean {
      // Timings are fully finished when we've marked the end of the last segment
      return (
        this.areTimingsUsable && this.rawTimings[this.length - 1][1] === LYRIC_MARKERS.SEGMENT_END
      );
    },

    subtitles() {
      return (options: VideoSettingsOverride = {}): string => {
        // Return empty string if there are no timings at all
        if (this.length === 0) {
          return "";
        }

        const mediaStore = useMediaStore();
        const settingsStore = useSettingsStore();

        try {
          const baseOptions = settingsStore.renderOptions || DEFAULT_KARAOKE_OPTIONS;
          // Apply the active voice's style override (no-op when it has none).
          const voiceOptions = applyVoiceStyle(
            baseOptions,
            settingsStore.renderVoiceStyle(this.activeVoice),
          );

          // font and color merge field by field, so a caller can override one of them
          // (the Adjust preview's own palette) without restating the rest.
          const adjustedOptions = {
            ...voiceOptions,
            ...options,
            font: { ...voiceOptions.font, ...options.font },
            color: { ...voiceOptions.color, ...options.color },
          };

          return createAssFile(
            this.activeSegments,
            mediaStore.songDuration ?? 0,
            mediaStore.songTitle ?? "",
            mediaStore.songArtist ?? "",
            adjustedOptions,
            settingsStore.fonts,
          );
        } catch (e) {
          console.error("Failed to create subtitles", e);
          return "";
        }
      };
    },

    /**
     * Voices that actually have timings, in document order.
     * A voice can hold segments with nothing tapped yet,
     * so this asks whether anything is timed, not whether the array is populated.
     */
    voicesWithTimings(state): VoiceId[] {
      return useLyricsStore().voices.filter((v) => isTimed(state._segmentsByVoice[v]));
    },

    /**
     * Whether any timing is stored at all.
     * Unlike `voicesWithTimings` this counts voices the lyrics no longer name,
     * which loading a timings file also replaces.
     */
    hasDisplayPeriods(state): boolean {
      return Object.values(state._segmentsByVoice).some((segments) =>
        segments.some(hasDisplayPeriod),
      );
    },

    hasMuteBounds(state): boolean {
      return Object.values(state._segmentsByVoice).some((segments) => segments.some(hasMuteBounds));
    },

    /**
     * How many segments each voice has to review after a lyric edit.
     */
    reviewCountByVoice(state): Record<VoiceId, number> {
      return Object.fromEntries(
        Object.entries(state._segmentsByVoice).map(([voice, segments]) => [
          voice,
          segments.filter(({ review }) => review).length,
        ]),
      );
    },

    hasAnyTimings(state): boolean {
      return Object.values(state._segmentsByVoice).some(isTimed);
    },

    timingsForVoice(state) {
      return (voice: VoiceId): Timings => toEvents(state._segmentsByVoice[voice] ?? []);
    },

    timedSegmentsForVoice(state) {
      return (voice: VoiceId): TimedSegment[] => state._segmentsByVoice[voice] ?? [];
    },

    /**
     * Every voice's segments, which the KBP export reads.
     * Unlike `allTimings` this keeps untimed segments and display periods.
     */
    segmentsByVoice(state): SegmentsByVoice {
      return state._segmentsByVoice;
    },

    /**
     * The `timings.txt` the Submit tab and the project download write.
     */
    timingsText(state): string {
      return writeTimingsText(state._segmentsByVoice, useLyricsStore().voices);
    },

    /**
     * Each timed voice with the segments and styled options the video renders it with.
     */
    voiceTracks() {
      return (options: Partial<VideoSettings> = {}): VoiceTrack[] => {
        const settingsStore = useSettingsStore();
        const baseOptions = settingsStore.renderOptions || DEFAULT_KARAOKE_OPTIONS;
        return this.voicesWithTimings.map((voice) => ({
          voice,
          segments: this.timedSegmentsForVoice(voice),
          options: {
            ...applyVoiceStyle(baseOptions, settingsStore.renderVoiceStyle(voice)),
            ...options,
          },
        }));
      };
    },

    // Composited subtitles for ALL voices (used by the Submit preview and final video), as opposed to `subtitles`,
    // which renders only the active voice (used by Adjust).
    allVoicesSubtitles() {
      return (options: Partial<VideoSettings> = {}): string => {
        const settingsStore = useSettingsStore();
        const mediaStore = useMediaStore();
        const tracks = this.voiceTracks(options);
        if (tracks.length === 0) {
          return "";
        }

        try {
          return createMultiVoiceAssFile(
            tracks,
            mediaStore.songDuration ?? 0,
            mediaStore.songTitle ?? "",
            mediaStore.songArtist ?? "",
            settingsStore.fonts,
            settingsStore.subtitleSettings,
          );
        } catch (e) {
          console.error("Failed to create multi-voice subtitles", e);
          return "";
        }
      };
    },

    /**
     * Each line's muted period, and the gaps where the video plays the original song, for every
     * voice the lyrics name. A voice with lyrics but no segments yet counts as untimed.
     */
    gapPlan(state): GapPlan {
      const lyricsStore = useLyricsStore();
      const duration = useMediaStore().songDuration;
      if (!duration) {
        return { lines: [], gaps: [], complete: false };
      }
      const options = useSettingsStore().videoOptions;
      const voices = Object.fromEntries(
        lyricsStore.voices.map((voice) => [
          voice,
          state._segmentsByVoice[voice] ?? lyricsStore.segmentsForVoice(voice).map(fromLyric),
        ]),
      );
      return planGaps(voices, duration, {
        preRoll: options.gapPreRoll,
        postRoll: options.gapPostRoll,
        minGap: options.gapMinLength,
        fade: options.gapFade,
        pausesInLines: options.restorePausesInLines,
      });
    },

    /**
     * The gaps the video restores, which is none outside advanced mode, while the switch is off,
     * or while the song is partly timed.
     */
    restoredGaps(): GapPlan["gaps"] {
      const restores = useAdvancedStore().isAdvanced && useSettingsStore().videoOptions.restoreGaps;
      return restores ? this.gapPlan.gaps : [];
    },

    /**
     * How long the video holds the song back for the title screen and a quick-start count-in.
     */
    audioDelay(): number {
      const mediaStore = useMediaStore();
      const tracks = this.voiceTracks();
      if (tracks.length === 0) {
        return 0;
      }
      try {
        const [primary] = layOutVoices(
          tracks,
          mediaStore.songDuration ?? 0,
          mediaStore.songTitle ?? "",
          mediaStore.songArtist ?? "",
          useSettingsStore().fonts,
        );
        return songOffset(primary);
      } catch (e) {
        console.error("Failed to compute the audio delay", e);
        return 0;
      }
    },

    /**
     * When the video shows the title and artist, or null when it doesn't show them.
     */
    titleFrameTime(): number | null {
      const mediaStore = useMediaStore();
      const tracks = this.voiceTracks();
      if (tracks.length === 0) {
        return null;
      }
      try {
        const [primary] = layOutVoices(
          tracks,
          mediaStore.songDuration ?? 0,
          mediaStore.songTitle ?? "",
          mediaStore.songArtist ?? "",
          useSettingsStore().fonts,
        );
        return titleFrameTime(primary);
      } catch (e) {
        console.error("Failed to find the title frame", e);
        return null;
      }
    },

    /**
     * Where the video draws each of the active voice's lines, keyed by the index of its first segment.
     */
    activeLinePlacements(): Map<number, LinePlacement> {
      const mediaStore = useMediaStore();
      try {
        const placements = placeLines(
          this.voiceTracks(),
          mediaStore.songDuration ?? 0,
          mediaStore.songTitle ?? "",
          mediaStore.songArtist ?? "",
          useSettingsStore().fonts,
        );
        return placements[this.activeVoice] ?? new Map();
      } catch (e) {
        console.error("Failed to place lines", e);
        return new Map();
      }
    },
  },

  actions: {
    /**
     * Mark the current segments as the state that lyric edits reconcile from.
     * Every action that writes segments for a reason other than a lyric edit has to end with this,
     * or the edit that follows will be carried across from a stale baseline.
     */
    commitBaseline() {
      this._baselineByVoice = copySegmentsByVoice(this._segmentsByVoice);
    },

    /**
     * Keep every voice's stored display and muted periods valid after a timing write.
     * Voices without any are left as they are, so timing a song that uses none costs nothing.
     */
    normalizeLineBounds() {
      const normalize = (
        has: (segment: TimedSegment) => boolean,
        fix: (segments: TimedSegment[]) => TimedSegment[],
      ) => {
        const uses = (segments: TimedSegment[]) => segments.some(has);
        if (!Object.values(this._segmentsByVoice).some(uses)) {
          return;
        }
        this._segmentsByVoice = Object.fromEntries(
          Object.entries(this._segmentsByVoice).map(([voice, segments]) => [
            voice,
            uses(segments) ? fix(segments) : segments,
          ]),
        );
      };
      normalize(hasDisplayPeriod, normalizeDisplayPeriods);
      normalize(hasMuteBounds, normalizeMuteBounds);
    },

    /**
     * Put every line of one voice back on the automatic display rules, as one edit that can be
     * undone.
     */
    clearDisplayPeriods(voice: VoiceId) {
      this.applyVoiceEdit(
        voice,
        (this._segmentsByVoice[voice] ?? []).map(
          ({ displayStart: _start, displayEnd: _end, ...segment }) => segment,
        ),
        "Reset display periods",
      );
    },

    /**
     * Put every line of every voice back on the automatic mute rules, as one edit that can be
     * undone.
     */
    clearMuteBounds() {
      useHistoryStore().record({ label: "Reset mute times", tab: "adjust" }, () => {
        this._segmentsByVoice = Object.fromEntries(
          Object.entries(this._segmentsByVoice).map(([voice, segments]) => [
            voice,
            segments.map(({ muteStart: _start, muteEnd: _end, ...segment }) => segment),
          ]),
        );
        this.commitBaseline();
      });
    },

    /**
     * Replace the active voice's segments with an edit made in the Adjust tab, which can be undone.
     */
    applyAdjustEdit(segments: TimedSegment[], label = "Timing edit", options: EditOptions = {}) {
      this.applyVoiceEdit(this.activeVoice, segments, label, options);
    },

    /**
     * Replace one voice's segments with an edit that can be undone, whichever voice is active.
     * A segment whose start or end the edit changes loses its review flag,
     * unless `keepReview` is set for an edit that moves timings without the user checking them.
     */
    applyVoiceEdit(
      voice: VoiceId,
      segments: TimedSegment[],
      label = "Timing edit",
      { keepReview = false }: EditOptions = {},
    ) {
      useHistoryStore().record({ label, tab: "adjust" }, () => {
        const written = keepReview
          ? segments
          : clearRetimedFlags(this._segmentsByVoice[voice] ?? [], segments);
        this._segmentsByVoice = { ...this._segmentsByVoice, [voice]: copySegments(written) };
        this.normalizeLineBounds();
        this.commitBaseline();
      });
    },

    /**
     * Write a sync's result into the voice it was made for, as one edit that can be undone.
     * Returns false, writing nothing, when the voice has changed since the sync was requested.
     */
    applySegmentTimes(voice: VoiceId, pending: PendingSync, result: SyncResult): boolean {
      const current =
        this._segmentsByVoice[voice] ?? useLyricsStore().segmentsForVoice(voice).map(fromLyric);
      const written = withSyncResult(current, pending, result);
      if (!written) return false;
      // The sync sets the flags of what it wrote, which a plain edit would clear.
      this.applyVoiceEdit(voice, written, "Sync", { keepReview: true });
      return true;
    },

    /**
     * Replace one voice's segments with each of `steps` in turn, as one edit per step.
     */
    applyVoiceEdits(voice: VoiceId, steps: TimedSegment[][], label = "Timing edit") {
      for (const segments of steps) {
        this.applyVoiceEdit(voice, segments, label);
      }
    },

    /**
     * Write a state that the undo history restores. It is already reconciled, so the watchers
     * leave it alone.
     */
    restoreHistoryState(lyricText: string, segments: SegmentsByVoice, baseline: SegmentsByVoice) {
      useLyricsStore().setLyrics(lyricText);
      this._segmentsByVoice = segments;
      this._baselineByVoice = baseline;
      this._reconciledLyricText = lyricText;
    },

    setActiveVoice(voice: VoiceId) {
      this._activeVoice = voice;
    },

    /**
     * Ask the Timing tab to go to the first segment to review, in the active voice if it has one.
     */
    requestReview() {
      const voice = [this.activeVoice, ...useLyricsStore().voices].find(
        (voice) => this.reviewCountByVoice[voice] > 0,
      );
      if (voice) this.setActiveVoice(voice);
      this.reviewRequest++;
    },

    /**
     * Reassigning the map (vs mutating in place) keeps a newly-added voice key reactive.
     */
    ensureActiveSegments(): TimedSegment[] {
      const voice = this.activeVoice;
      if (!this._segmentsByVoice[voice]) {
        const seeded = useLyricsStore().segmentsForVoice(voice).map(fromLyric);
        this._segmentsByVoice = { ...this._segmentsByVoice, [voice]: seeded };
      }
      return this._segmentsByVoice[voice];
    },

    add(currentSegmentNum: number, marker: number, timestamp: number) {
      if (currentSegmentNum < 0) {
        return;
      }

      const segments = this.ensureActiveSegments();
      // Timings can be entered before any lyrics are, so grow to reach the index rather than dropping the input.
      // Reconciliation fills the text in later.
      while (segments.length <= currentSegmentNum) {
        segments.push({ text: "" });
      }

      if (marker == LYRIC_MARKERS.SEGMENT_START) {
        this.handleConflictWithPreviousSegment(timestamp);
        segments[currentSegmentNum].start = timestamp;
        delete segments[currentSegmentNum].review;
        this.normalizeLineBounds();
        this.commitBaseline();
        return;
      }

      // An end belongs to the segment that is actually sounding,
      // which is the last one started at or before this index, not necessarily the one at the index itself.
      const started = findLastIndex(
        segments,
        (segment) => segment.start !== undefined,
        currentSegmentNum,
      );
      if (started >= 0) {
        segments[started].end = timestamp;
        delete segments[started].review;
      }
      this.normalizeLineBounds();
      this.commitBaseline();
    },

    handleConflictWithPreviousSegment(segmentStartTimestamp: number) {
      // A new start at or before the previous segment's end would make the two overlap,
      // so the end is dropped and the previous segment simply runs into this one.
      const segments = this._segmentsByVoice[this.activeVoice];
      if (!segments) {
        return;
      }

      const lastEnd = findLastIndex(segments, (segment) => segment.end !== undefined);
      if (lastEnd < 0) {
        return;
      }
      // Something started after that end, so it isn't what this start collides with.
      if (segments.slice(lastEnd + 1).some((segment) => segment.start !== undefined)) {
        return;
      }
      if (segmentStartTimestamp > (segments[lastEnd].end as number)) {
        return;
      }
      segments[lastEnd].end = undefined;
    },

    timingForSegmentNum(segmentNum: number) {
      return this.activeSegments[segmentNum]?.start ?? 0;
    },

    setCurrentSegment(segmentNum: number) {
      // Drop the timings from segmentNum on, so timing resumes there.
      const segments = this.ensureActiveSegments();
      for (const segment of segments.slice(segmentNum)) {
        segment.start = undefined;
        segment.end = undefined;
        delete segment.review;
      }
      this.normalizeLineBounds();
      this.commitBaseline();
    },

    resetSegments(segments: TimedSegment[]) {
      this._segmentsByVoice = {
        ...this._segmentsByVoice,
        [this.activeVoice]: copySegments(segments),
      };
      this.normalizeLineBounds();
      this.commitBaseline();
    },

    resetTimings(newTimings: Timings = []) {
      const lyricText = useLyricsStore().lyricTextForVoice(this.activeVoice);
      this._segmentsByVoice = {
        ...this._segmentsByVoice,
        [this.activeVoice]: fromEvents(lyricText, newTimings),
      };
      this.commitBaseline();
    },

    /**
     * Replace all voices at once from a versioned timings file, holes included.
     */
    setAllSegments(byVoice: SegmentsByVoice) {
      this._segmentsByVoice = copySegmentsByVoice(byVoice);
      this.normalizeLineBounds();
      this.commitBaseline();
      this.reconcileVoices();
    },

    /**
     * Replace all voices' timings at once (used when importing a multi-voice timings file).
     */
    setAllTimings(byVoice: TimingsByVoice) {
      const lyricsStore = useLyricsStore();
      this._segmentsByVoice = Object.fromEntries(
        Object.entries(byVoice).map(([voice, events]) => [
          voice,
          fromEvents(lyricsStore.lyricTextForVoice(voice), events),
        ]),
      );
      this.commitBaseline();
      // An imported file may key its timings under a voice name the current lyrics no
      // longer use (typically the default voice of a pre-tag session).
      this.reconcileVoices();
    },

    /**
     * Carry timings across a voice rename.
     *
     * Voices are named by the lyric tags, so tagging previously untagged lyrics, or editing an existing tag,
     * renames a voice, and timings keyed under the old name would look lost.
     * When exactly one timed voice has vanished from the lyrics and exactly one voice in the lyrics has no timings,
     * that is unambiguously a rename, so the timings (and the style override, if the new name has none) move over.
     * This is what makes "switch to multi-voice by adding a tag at the top" keep the timings that were tapped out
     * before any tag existed.
     *
     * Anything more ambiguous (several renames at once, or a voice merged into another that is already
     * timed) is left alone. Orphaned entries are never deleted, so re-typing the old tag brings them back.
     */
    reconcileVoices() {
      const rename = findVoiceRename(this._segmentsByVoice, useLyricsStore().voices);
      if (!rename) {
        return;
      }

      const { from, to } = rename;
      this._segmentsByVoice = renameVoice(this._segmentsByVoice, from, to);
      // The rename is the only thing that moves, so the baseline follows the key rather than being recommitted.
      // Recommitting here would fold in the edit that triggered the rename.
      if (this._baselineByVoice[from]) {
        this._baselineByVoice = renameVoice(this._baselineByVoice, from, to);
      }
      if (this._activeVoice === from) {
        this._activeVoice = to;
      }
      useSettingsStore().renameVoiceStyle(from, to);
    },

    clear() {
      this._segmentsByVoice = {};
      this._baselineByVoice = {};
    },

    /**
     * Follow voice renames as the user edits the lyric tags.
     * Registered once at app start (options stores can't call watch() from a setup scope).
     * Runs immediately so timings restored from a previous, tag-less session are picked up on load too.
     */
    setupVoiceReconciliation() {
      const lyricsStore = useLyricsStore();
      watch(
        () => lyricsStore.voices.join("\n"),
        () => {
          if (lyricsStore.lyricText !== this._reconciledLyricText) {
            this.reconcileVoices();
          }
        },
        { immediate: true },
      );
    },

    /**
     * Carry every voice's timings across an edit to the lyrics.
     * The source is always `_baselineByVoice` and never this action's own previous output,
     * so a word typed one letter at a time costs nothing the finished word would not have cost.
     * Runs after reconcileVoices, which handles the coarser case of a voice being renamed by its tag.
     */
    reconcileSegments() {
      const lyricsStore = useLyricsStore();
      this._segmentsByVoice = reconcileByVoice(
        this._segmentsByVoice,
        this._baselineByVoice,
        lyricsStore.voices,
        parseAnnotatedLyrics(this._reconciledLyricText ?? "").voices,
        (voice) => lyricsStore.segmentsForVoice(voice),
      );
      this.normalizeLineBounds();
    },

    /**
     * This is registered once at app start, like the watcher above.
     */
    setupSegmentReconciliation() {
      const lyricsStore = useLyricsStore();
      // The stored segments were carried across to the stored lyrics.
      this._reconciledLyricText ??= lyricsStore.lyricText;
      watch(
        () => lyricsStore.lyricText,
        (lyricText) => {
          if (lyricText !== this._reconciledLyricText) {
            this.reconcileSegments();
            this._reconciledLyricText = lyricText;
          }
        },
      );
    },

    /**
     * Carry the timings across a lyric write at once, rather than when the watchers run, so that
     * the undo history records what the reconciliation changed.
     */
    reconcileLyricEdit(voicesChanged: boolean) {
      if (voicesChanged) {
        this.reconcileVoices();
      }
      this.reconcileSegments();
      this._reconciledLyricText = useLyricsStore().lyricText;
    },

    /**
     * Write the timings and their baseline to localStorage now, rather than after the change that
     * asked for it.
     */
    saveToStorage() {
      try {
        localStorage.setItem(SEGMENTS_STORAGE_KEY, JSON.stringify(this._segmentsByVoice));
        localStorage.setItem(ACTIVE_VOICE_STORAGE_KEY, JSON.stringify(this._activeVoice));
        localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(this._baselineByVoice));
      } catch (e) {
        console.error("Failed to save the timings to localStorage", e);
      }
    },

    setupPersistence() {
      this.$subscribe(() => this.saveToStorage());
    },
  },
});
