<template>
  <div class="timing-adjuster">
    <playback-transport :player="player">
      <template v-if="overviewBuffer" #slider>
        <overview-strip
          :player="player"
          :buffer="overviewBuffer"
          :regions="overviewRegions"
          :view="view"
          :centered="tapMode"
          @scroll-to="scrollTo"
          @scroll-wheel="onOverviewWheel"
        />
      </template>
    </playback-transport>
    <Teleport v-if="immersive && overviewBuffer" defer to="#immersive-overview">
      <overview-strip
        class="floating-overview"
        :class="{ 'is-expanded': floatingOverview.expanded }"
        :collapsed="!floatingOverview.expanded"
        :player="player"
        :buffer="overviewBuffer"
        :regions="overviewRegions"
        :view="view"
        :centered="tapMode"
        :slider="false"
        @scroll-to="scrollTo"
        @scroll-wheel="onOverviewWheel"
        @expand="expandFloatingOverview"
        @grab="holdFloatingOverview"
        @release="collapseFloatingOverview(true)"
      />
    </Teleport>
    <div class="waveform-stage">
      <!-- Display only. It loads its own copy of the audio, so playing it would double up
         with the player above; the playhead is driven by setTime instead. -->
      <wavesurfer
        ref="wavesurfer"
        :audioData="vocalTrack || audioData"
        :regions="shownRegions"
        :bands="bands"
        :bandsEnabled="bandsEnabled"
        :mixFrames="mixFrames"
        :mixGaps="mixGaps"
        :mixEnabled="mixEnabled"
        :spectrogram="spectrogram"
        :selectable="!tapMode"
        :centered="tapMode"
        :mediaControls="false"
        :zoom="zoom"
        :initialScroll="initialScroll"
        @region-updated="onRegionUpdated"
        @regions-updated="onRegionsUpdated"
        @bands-updated="$emit('bands-updated', $event)"
        @band-reset="(...args: unknown[]) => $emit('band-reset', ...args)"
        @mute-updated="(...args: unknown[]) => $emit('mute-updated', ...args)"
        @mute-reset="(...args: unknown[]) => $emit('mute-reset', ...args)"
        @seeking="onWavesurferSeeking"
        @region-clicked="onRegionClicked"
        @selection-change="onSelectionChange"
        @scrub="seekBy"
        @zoom-change="$emit('zoom-change', $event)"
        @zoom-by="$emit('zoom-by', $event)"
        @scroll-change="$emit('scroll-change', $event)"
        @view-change="onViewChange"
        @hand-move="expandFloatingOverview"
        @decode="onDecode"
      />
      <tap-queue v-if="tapMode" :items="queue" @pick="$emit('segment-picked', $event)" />
      <slot />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, markRaw, PropType, reactive } from "vue";
import { RegionParams, Region } from "@/lib/wavesurferPlugins/OpenEndedRegionPlugin";
import Wavesurfer from "@/components/Wavesurfer.vue";
import PlaybackTransport from "./PlaybackTransport.vue";
import OverviewStrip, { OverviewRegion, TimeRange } from "./OverviewStrip.vue";
import TapQueue, { QueueItem } from "./TapQueue.vue";

import { findLastIndex } from "lodash-es";
import { displayText, resolveStarts } from "@/lib/timing";
import { registerPlayer } from "@/lib/exclusivePlayback";
import { WebAudioPlayer } from "@/lib/webAudioPlayer";
import { TimedSegment } from "@/lib/timedSegments";
import { DisplayBand } from "@/lib/displayBands";
import type { MixFrame, MixGap } from "@/lib/wavesurferPlugins/MixPlugin";

// The Tap queue runs across the middle of the waveform.
// An even number of channels leaves the middle between two of them.
const TAP_CHANNELS = 4;
const ADJUST_CHANNELS = 5;

// How long the floating overview stays expanded after the view was last moved by hand.
const FLOATING_OVERVIEW_MS = 2000;
// How long the floating overview stays expanded after a tap or drag on it, to show where the view
// landed.
const FLOATING_OVERVIEW_AFTER_USE_MS = 500;

const NO_REGIONS: RegionParams[] = [];

// An open-ended last segment is drawn up to the song's end,
// so the lost segments after it stack this long after its start instead.
const UNPLACED_AFTER_OPEN_END = 1;
// The lost segments before the first timed one stack this far before its start,
// so that they come first in the plugin's order.
const UNPLACED_BEFORE_FIRST = 0.001;

/**
 * Where to draw the lost segments that interpolation can't place,
 * since no timed segment lies on one side of them:
 * just before the first timed segment's start, or just after the last one's end.
 */
function unplacedStarts(segments: TimedSegment[], resolved: TimedSegment[]): Map<number, number> {
  const starts = new Map<number, number>();
  const first = resolved.findIndex((segment) => segment.start !== undefined);
  if (first === -1) return starts;
  const last = findLastIndex(resolved, (segment) => segment.start !== undefined);
  const { start: lastStart, end: lastEnd } = segments[last];
  const before = Math.max(0, (resolved[first].start as number) - UNPLACED_BEFORE_FIRST);
  const after = lastEnd ?? (lastStart as number) + UNPLACED_AFTER_OPEN_END;
  segments.forEach((segment, index) => {
    if (segment.review !== "lost") return;
    if (index < first) starts.set(index, before);
    if (index > last) starts.set(index, after);
  });
  return starts;
}

function createLyricRegion(
  id: number,
  params: Partial<RegionParams> & { start: number },
): RegionParams {
  return {
    id: `segment_${id}`,
    // The region plugin uses "channels" to display regions on different lines
    channelIdx: id % ADJUST_CHANNELS,
    channelCount: ADJUST_CHANNELS,
    ...params,
  };
}

export default defineComponent({
  emits: [
    "segmentschange",
    "bands-updated",
    "band-reset",
    "mute-updated",
    "mute-reset",
    "timeupdate",
    "seeking",
    "play",
    "pause",
    "segment-picked",
    "selection-change",
    "zoom-change",
    "zoom-by",
    "scroll-change",
    // A track given as `playbackTrack` is now the one playing.
    "playback-loaded",
  ],
  components: {
    Wavesurfer,
    PlaybackTransport,
    OverviewStrip,
    TapQueue,
  },
  props: {
    segments: Array<TimedSegment>,
    // Display mode draws each line's display period in place of the timing regions.
    displayMode: { type: Boolean, default: false },
    mixMode: { type: Boolean, default: false },
    // Tap mode draws the regions without handles, and a click on one doesn't select it.
    tapMode: { type: Boolean, default: false },
    // In Tap mode, the segment being tapped, whose region grows up to the playhead.
    growing: { type: Number, required: false },
    // In Tap mode, the next segment to tap, whose region is marked when it has one.
    head: { type: Number, required: false },
    // In Tap mode, the segments tapped in the pass under way. The others after the head are ghosts,
    // drawn faded, since the next taps replace them.
    tapped: { type: Array as PropType<number[]>, default: () => [] },
    // In Tap mode, the segments still to tap, drawn in a row from the playhead.
    queue: { type: Array as PropType<QueueItem[]>, default: () => [] },
    bands: { type: Array as PropType<DisplayBand[]>, default: () => [] },
    bandsEnabled: { type: Boolean, default: true },
    mixFrames: { type: Array as PropType<MixFrame[]>, default: () => [] },
    mixGaps: { type: Array as PropType<MixGap[]>, default: () => [] },
    mixEnabled: { type: Boolean, default: true },
    spectrogram: { type: Boolean, default: false },
    audioData: Blob,
    // URL to the vocal track audio file
    vocalTrack: { type: Blob, required: false },
    // Blob driving audio playback (the waveform stays on vocalTrack/audioData).
    // Lets the user switch what they hear without changing the waveform.
    playbackTrack: { type: Blob, required: false },
    prerollSeconds: { type: Number, default: 5 },
    // This is where playback resumes on load. It is read once, when the media is ready for it.
    initialPlayhead: { type: Number, default: 0 },
    // This is where the waveform was scrolled to, in seconds.
    initialScroll: { type: Number, default: 0 },
    zoom: { type: Number, default: 100 },
    playbackRate: { type: Number, default: 1 },
    preservePitch: { type: Boolean, default: false },
    // A phone held sideways, where the overview floats over the waveform as a thin line, and
    // expands while the view is moved by hand.
    immersive: { type: Boolean, default: false },
  },
  data() {
    return {
      regions: [] as RegionParams[],
      player: markRaw(new WebAudioPlayer()),
      unregisterPlayer: null as (() => void) | null,
      _playheadRestored: false,
      // The seek under way is the one that restores the playhead.
      restoringPlayhead: false,
      clockFrame: 0,
      // The time the Tap mode clock last showed. Nothing here is rendered, hence markRaw.
      clock: markRaw({ shown: -1 }),
      // The span being played by playRange, which pauses at its end and goes back to the preroll
      // before its start.
      playingRange: null as { start: number; end: number } | null,
      // The waveform the overview draws, once decoded.
      overviewBuffer: null as AudioBuffer | null,
      // Only the overview reads the fields, so a scroll re-renders the overview alone.
      view: reactive({ start: 0, end: 0 }) as TimeRange,
      selected: [] as number[],
      floatingOverview: { expanded: false, held: false, timer: 0 },
    };
  },
  computed: {
    // The same empty array every time, as a new one would rebuild the waveform's regions.
    shownRegions(): RegionParams[] {
      return this.displayMode || this.mixMode ? NO_REGIONS : this.regions;
    },
    overviewRegions(): OverviewRegion[] {
      const selected = new Set(this.selected);
      return this.regions.map((region) => {
        const index = parseInt(region.id!.split("_")[1]);
        return {
          start: region.start,
          end: region.end,
          review: region.review,
          selected: selected.has(index),
          hole: (this.segments ?? [])[index]?.start === undefined,
        };
      });
    },
  },
  mounted() {
    this.regions = this.createRegions(this.segments ?? []);
    const { player } = this;
    player.addEventListener("timeupdate", this.onAudioTimeUpdate);
    player.addEventListener("seeking", this.onAudioSeeking);
    player.addEventListener("play", this.onAudioPlay);
    player.addEventListener("pause", this.onAudioPause);
    player.addEventListener("ended", this.onAudioEnded);
    this.unregisterPlayer = registerPlayer(player, { mediaKeys: false });
    this.loadPlaybackSource(this.playbackTrack || this.audioData);
    this.applyPlaybackSettings();
    this.restorePlayhead();
    if (this.tapMode) this.startClock();
  },
  watch: {
    segments: {
      handler: function (newSegments: Array<TimedSegment>) {
        this.regions = this.createRegions(newSegments);
      },
      deep: true,
    },
    head() {
      if (this.tapMode) this.regions = this.createRegions(this.segments ?? []);
    },
    tapped() {
      if (this.tapMode) this.regions = this.createRegions(this.segments ?? []);
    },
    tapMode(tapMode: boolean) {
      this.playingRange = null;
      this.player.clearRange();
      this.regions = this.createRegions(this.segments ?? []);
      if (tapMode) {
        this.startClock();
      } else {
        this.stopClock();
      }
    },
    playbackRate() {
      this.applyPlaybackSettings();
    },
    preservePitch() {
      this.applyPlaybackSettings();
    },
    playbackTrack(newTrack: Blob) {
      this.loadPlaybackSource(newTrack || this.audioData);
    },
  },
  methods: {
    /**
     * Move the playhead to where it was left, once the track is decoded and its duration known.
     * This runs only once.
     */
    restorePlayhead() {
      if (this._playheadRestored || !this.initialPlayhead) return;
      this._playheadRestored = true;
      const time = this.initialPlayhead;
      // Seeking emits `seeking`, which updates the waveform and the caller.
      const seek = () => {
        this.restoringPlayhead = true;
        this.player.currentTime = time;
      };
      if (this.player.loading) {
        this.player.addEventListener("loadeddata", seek, { once: true });
      } else {
        seek();
      }
    },
    applyPlaybackSettings() {
      this.player.preservesPitch = this.preservePitch;
      this.player.playbackRate = this.playbackRate;
    },
    wavesurferRef() {
      return this.$refs.wavesurfer as InstanceType<typeof Wavesurfer> | undefined;
    },
    /**
     * There is one region per segment, indexed the same way, so a region id names its segment directly.
     * An untimed segment gets a shaded region at its interpolated position. Dragging it sets a real start.
     * A lost segment that has no interpolated position is drawn at the nearest timed edge.
     */
    createRegions(segments: Array<TimedSegment>): Array<RegionParams> {
      if (!segments) {
        return [];
      }
      const resolved = resolveStarts(segments);
      const unplaced = unplacedStarts(segments, resolved);
      const regions: RegionParams[] = [];
      resolved.forEach((segment, index) => {
        const start = segment.start ?? unplaced.get(index);
        if (start === undefined) {
          return;
        }
        regions.push(
          createLyricRegion(index, {
            start,
            // A lost segment placed at the nearest timed edge may start after its own end.
            end: segment.end !== undefined && segment.end > start ? segment.end : undefined,
            review: segments[index].review,
            content: displayText(segment.text),
            resize: !this.tapMode,
            highlighted: this.tapMode && index === this.head,
            faded:
              this.tapMode &&
              this.head !== undefined &&
              index > this.head &&
              !this.tapped.includes(index),
            ...(this.tapMode && {
              channelIdx: index % TAP_CHANNELS,
              channelCount: TAP_CHANNELS,
            }),
            color:
              segments[index].start === undefined
                ? "var(--region-fill-hole)"
                : "var(--region-fill)",
          }),
        );
      });
      return regions;
    },
    loadPlaybackSource(blob: Blob | undefined) {
      if (!blob) return;
      this.player
        .load(blob)
        .then(() => this.$emit("playback-loaded", blob))
        .catch((error) => {
          console.error("Could not decode the track:", error);
        });
    },
    onRegionUpdated(region: Region) {
      this.onRegionsUpdated([region]);
    },
    /**
     * A handle or a selection was released. While the song is paused, the regions play through with
     * their new timing. While it plays, the playhead moves to the preroll before them and playback
     * goes on. They come in time order.
     */
    onRegionsUpdated(regions: Array<Region>) {
      if (regions.length === 0) return;
      const start = regions[0].start;
      const end = regions[regions.length - 1].end;
      const updated = (this.segments ?? []).map((segment) => ({ ...segment }));
      for (const region of regions) {
        const index = parseInt(region.id.split("_")[1]);
        const segment = updated[index];
        if (!segment) continue;
        segment.start = region.start;
        segment.end = region.isOpenEnded ? undefined : region.end;
      }
      this.$emit("segmentschange", updated);
      this.$nextTick(() => {
        if (this.songIsPlaying()) {
          this.setAudioPlayhead(Math.max(0, start - this.prerollSeconds));
        } else {
          this.playRange(start, end);
        }
      });
    },
    onTimeUpdate(time: number) {
      this.$emit("timeupdate", time);
    },
    onSeeking(time: number) {
      this.$emit("seeking", time);
    },
    setAdjusterPlayhead(playhead: number) {
      this.wavesurferRef()?.setTime(playhead);
    },
    setAudioPlayhead(playhead: number) {
      this.player.currentTime = playhead;
    },
    // Jump to whichever end of the track `edge` names.
    seekToTrackEdge(edge: "start" | "end") {
      if (edge === "start") return this.setAudioPlayhead(0);
      if (!Number.isFinite(this.player.duration)) return;
      this.setAudioPlayhead(this.player.duration);
    },
    // Jump to whichever end of the scrolled-into-view waveform `edge` names.
    seekToViewEdge(edge: "start" | "end") {
      const range = this.wavesurferRef()?.visibleTimeRange();
      if (!range) return;
      this.setAudioPlayhead(edge === "start" ? range.start : range.end);
    },
    clearSelection() {
      this.wavesurferRef()?.clearSelection();
    },
    anchorZoomOnPlayhead() {
      this.wavesurferRef()?.anchorZoomOnPlayhead();
    },
    /**
     * Select a segment's region alone and scroll it into view, as a click on it would select it.
     */
    selectSegment(index: number) {
      const id = `segment_${index}`;
      const region = this.regions.find((params) => params.id === id);
      if (region) this.wavesurferRef()?.selectRegion(id, region.start);
    },
    onSelectionChange(ids: string[]) {
      this.selected = ids.map((id) => parseInt(id.split("_")[1]));
      this.$emit("selection-change", this.selected);
    },
    onDecode(buffer: AudioBuffer) {
      this.overviewBuffer = markRaw(buffer);
    },
    onViewChange(range: TimeRange) {
      this.view.start = range.start;
      this.view.end = range.end;
    },
    scrollTo(time: number) {
      this.wavesurferRef()?.scrollToTime(time);
    },
    onOverviewWheel(event: WheelEvent, time: number) {
      this.wavesurferRef()?.wheelFromOverview(event, time);
    },
    expandFloatingOverview() {
      if (!this.immersive) return;
      this.floatingOverview.expanded = true;
      if (!this.floatingOverview.held) this.collapseFloatingOverview();
    },
    /**
     * A finger on the overview keeps it expanded. The waveform may still be coasting from a swipe,
     * which no longer counts as moving it by hand.
     */
    holdFloatingOverview() {
      this.floatingOverview.held = true;
      clearTimeout(this.floatingOverview.timer);
      this.wavesurferRef()?.endSwipeMomentum();
    },
    collapseFloatingOverview(afterUse = false) {
      this.floatingOverview.held = false;
      clearTimeout(this.floatingOverview.timer);
      this.floatingOverview.timer = window.setTimeout(
        () => (this.floatingOverview.expanded = false),
        afterUse ? FLOATING_OVERVIEW_AFTER_USE_MS : FLOATING_OVERVIEW_MS,
      );
    },
    /**
     * The song time being heard, or the one heard at `at`, a `performance.now()` time such as an
     * event's `timeStamp`.
     */
    currentTime(at?: number): number {
      return at === undefined ? this.player.currentTime : this.player.timeAt(at);
    },
    isPaused(): boolean {
      return this.player.paused;
    },
    /**
     * Whether the song is playing on, as opposed to paused or playing a region through once.
     */
    songIsPlaying(): boolean {
      return !this.player.paused && !this.playingRange;
    },
    pause() {
      this.player.pause();
    },
    togglePlayPause() {
      if (this.player.paused) {
        this.play();
      } else {
        this.player.pause();
      }
    },
    play() {
      this.player.play().catch((error) => {
        console.error("Could not start playback:", error);
      });
    },
    // Move the playhead by `seconds`, staying inside the track.
    seekBy(seconds: number) {
      this.setAudioPlayhead(this.player.currentTime + seconds);
    },
    // Jump to `time` and play from there, whether or not playback is running.
    restartAt(time: number) {
      this.setAudioPlayhead(time);
      if (this.player.paused) this.play();
    },
    /**
     * Play from `start`, whether or not playback is running. At `end`, pause and move the playhead
     * to the preroll before `start`.
     */
    playRange(start: number, end: number) {
      if (end <= start) return;
      this.playingRange = { start, end };
      this.player.playRange(start, end);
    },
    onAudioTimeUpdate() {
      const time = this.player.currentTime;
      // In Tap mode the clock moves the playhead on every frame.
      if (!this.tapMode) this.setAdjusterPlayhead(time);
      this.$emit("timeupdate", time);
    },
    startClock() {
      if (this.clockFrame) return;
      this.clock.shown = -1;
      const tick = () => {
        this.clockFrame = requestAnimationFrame(tick);
        this.onClockFrame();
      };
      this.clockFrame = requestAnimationFrame(tick);
    },
    stopClock() {
      cancelAnimationFrame(this.clockFrame);
      this.clockFrame = 0;
    },
    /**
     * Keep the playhead in the middle of the view, and grow the region being tapped up to it.
     */
    onClockFrame() {
      const wavesurfer = this.wavesurferRef();
      if (!wavesurfer) return;
      const time = this.player.currentTime;
      if (time === this.clock.shown) return;
      this.clock.shown = time;
      wavesurfer.setTime(time);
      wavesurfer.centerOn(time);
      if (this.growing !== undefined && !this.player.paused) {
        wavesurfer.growRegion(`segment_${this.growing}`, time);
      }
    },
    onAudioSeeking() {
      const time = this.player.currentTime;
      this.clock.shown = -1;
      const range = this.playingRange;
      if (range && (time < range.start || time >= range.end)) {
        this.playingRange = null;
      }
      // The waveform restores its own scroll, which wins over a restored playhead outside it.
      this.wavesurferRef()?.setTime(time, this.restoringPlayhead);
      this.restoringPlayhead = false;
      this.$emit("seeking", time);
    },
    onRegionClicked(region: Region, event: MouseEvent) {
      // A click on a region picks it in Tap mode and toggles its selection otherwise.
      // Either way, it must not also seek to where it landed.
      event.stopPropagation();
      if (this.tapMode) {
        this.$emit("segment-picked", parseInt(region.id.split("_")[1]));
      } else if (!this.songIsPlaying()) {
        this.playRange(region.start, region.end);
      }
    },
    onWavesurferSeeking(time: number) {
      console.log("Wavesurfer seeking", time);
      this.setAudioPlayhead(time);
    },
    onWavesurferSeeked(time: number) {
      this.setAudioPlayhead(time);
    },
    onAudioPlay() {
      this.$emit("play");
    },
    onAudioPause() {
      this.playingRange = null;
      this.wavesurferRef()?.pause();
      this.$emit("pause");
    },
    /**
     * A range that has played to its end moves the playhead to the preroll before its start.
     */
    onAudioEnded() {
      const range = this.playingRange;
      this.playingRange = null;
      if (range) this.setAudioPlayhead(Math.max(0, range.start - this.prerollSeconds));
    },
  },
  beforeUnmount() {
    clearTimeout(this.floatingOverview.timer);
    this.stopClock();
    this.unregisterPlayer?.();
    this.player.dispose();
  },
});
</script>

<style scoped>
.timing-adjuster {
  display: flex;
  flex-direction: column;
}

/* The waveform takes whatever height the stage is given, so it can't size the stage itself. */
.waveform-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 300px;
}

.overview-strip.floating-overview {
  flex-grow: 0;
  width: 100%;
  height: 6px;
  background: color-mix(in srgb, var(--bulma-scheme-main) 55%, transparent);
  backdrop-filter: blur(3px);
  transition: height 150ms;
}

.overview-strip.floating-overview.is-expanded {
  height: 40px;
}

.waveform-stage > .wavesurfer-container {
  position: absolute;
  inset: 0;
}
</style>
