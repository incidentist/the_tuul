<template>
  <b-tab-item
    value="timing"
    label="Timing (legacy)"
    icon="stopwatch"
    class="wrapper song-timing-tab"
    headerClass="song-timing-tab-header"
    :disabled="!songFile || lyricSegments.length == 0"
    :visible="legacyTimingStore.isShown"
  >
    <template #header>
      <b-icon icon="stopwatch" />
      <span>
        Timing
        <span class="tab-label-note">(legacy)</span>
      </span>
    </template>
    <div class="title-row">
      <h2 class="title">Song Timing</h2>
      <voice-selector />
    </div>
    <help-section>
      <p>
        Press <kbd>{{ startKeyLabel }}</kbd> when the singer starts the highlighted segment.
      </p>
      <p>
        Press <kbd>{{ endKeyLabel }}</kbd> when the singer finishes the <em>previous</em>
        highlighted segment.
      </p>
      <p>
        Press <kbd>{{ redoKeyLabel }}</kbd> to jump back and redo the current screen. The keyboard
        button at the top of the page changes these keys.
      </p>
      <p>Adjust the playback speed to slow down fast parts or skip through long instrumentals.</p>
    </help-section>
    <b-message
      v-model="warningMessageVisible"
      type="is-warning"
      has-icon
      icon="warning"
      icon-size="is-small"
    >
      Almost done! Press <kbd>{{ endKeyLabel }}</kbd> when the last line ends.
    </b-message>
    <b-message
      v-model="successMessageVisible"
      type="is-success"
      has-icon
      icon="check"
      icon-size="is-small"
    >
      Done! You've got everything you need to create your video. Go to the Submit tab.
    </b-message>
    <audio
      ref="audio"
      :src="audioSource"
      @ended="onAudioEvent"
      @pause="onAudioEvent"
      @play="onAudioEvent"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onLoadedMetadata"
    ></audio>
    <div class="level">
      <div class="level-item">
        <div class="buttons">
          <b-button type="is-primary" @click="playPause" name="song-timing-play-pause">
            {{ isPlaying ? "Pause" : "Play" }}
          </b-button>
          <b-button
            type="is-primary"
            @click="redoScreen"
            :active="isPlaying"
            :title="`Redo the current screen (${redoKeyLabel})`"
          >
            &laquo; Redo This Screen
          </b-button>
          <div class="field">
            <b-button
              @click="showButtonKeyboard = !showButtonKeyboard"
              icon-right="keyboard"
              :type="showButtonKeyboard ? 'is-primary' : ''"
              aria-label="Timing buttons"
              :aria-pressed="showButtonKeyboard"
              title="Show or hide buttons for entering timings, if you don't have a keyboard"
            ></b-button>
          </div>
        </div>
      </div>
      <div class="level-item">
        <b-field class="playback-speed" label="Speed: " horizontal>
          <b-field class="has-addons">
            <template v-for="val in [0.3, 0.5, 0.7, 0.9, 1.0, 1.5]" :key="val">
              <b-radio-button
                :size="isMobile ? 'is-small' : ''"
                v-model="playbackRate"
                :native-value="val"
                class="is-flex-shrink-0"
              >
                {{ val }}
              </b-radio-button>
            </template>
          </b-field>
        </b-field>
      </div>
      <div class="level-item">
        <b-field horizontal class="preserve-pitch">
          <template #label>
            Preserve pitch
            <viewport-tooltip
              label="Hold the original key at other speeds. The stretching it needs sounds rough well below 1x."
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </viewport-tooltip>
          </template>
          <b-switch v-model="preservePitch" :size="isMobile ? 'is-small' : ''"></b-switch>
        </b-field>
      </div>
    </div>

    <div class="seek-bar">
      <span class="seek-time">{{ formatTime(currentTime) }}</span>
      <input
        class="seek-slider"
        type="range"
        min="0"
        :max="duration || 0"
        step="0.01"
        :value="currentTime"
        :disabled="!duration"
        @input="onSeek"
        title="Drag to jump to a position in the track"
      />
      <span class="seek-time">{{ formatTime(duration) }}</span>
    </div>

    <lyric-display
      :lyric-segments="segments"
      :current-segment="currentSegment"
      @keydown="onKeyDown"
    >
    </lyric-display>
    <timing-buttons
      v-if="showButtonKeyboard"
      :start-key="timingKeys.start"
      :end-key="timingKeys.end"
      :start-label="startKeyLabel"
      :end-label="endKeyLabel"
      @keydown="onKeyDown"
    />
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { storeToRefs } from "pinia";
import { LYRIC_MARKERS } from "@/constants";
import { isMobile } from "@/lib/device";
import { Segment } from "@/lib/timing";
import HelpSection from "@/components/HelpSection.vue";
import LyricDisplay from "@/components/LyricDisplay.vue";
import TimingButtons from "@/components/TimingButtons.vue";
import VoiceSelector from "@/components/VoiceSelector.vue";
import ViewportTooltip from "@/components/ViewportTooltip.vue";
import { useTimingsStore } from "@/stores/timings";
import { useHistoryStore } from "@/stores/history";
import { useLyricsStore } from "@/stores/lyrics";
import { useMediaStore } from "@/stores/media";
import { useLegacyTimingStore } from "@/stores/legacyTiming";
import { useSettingsStore } from "@/stores/settings";
import { TimingKeys, bindingLabel, findBinding } from "@/lib/timingKeys";
import { claimMediaKeys, registerPlayer } from "@/lib/exclusivePlayback";
import { VoiceId } from "@/lib/voices";

interface VoiceTimingState {
  currentSegment: number;
  playbackRate: number;
  playhead: number;
}

function defaultVoiceState(): VoiceTimingState {
  return { currentSegment: 0, playbackRate: 1.0, playhead: 0 };
}

export default defineComponent({
  components: { HelpSection, LyricDisplay, TimingButtons, VoiceSelector, ViewportTooltip },
  setup() {
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    const mediaStore = useMediaStore();
    const settingsStore = useSettingsStore();
    const { lyricSegments } = storeToRefs(lyricsStore);
    return {
      historyStore: useHistoryStore(),
      timingsStore,
      lyricsStore,
      lyricSegments,
      mediaStore,
      settingsStore,
      legacyTimingStore: useLegacyTimingStore(),
    };
  },
  data() {
    return {
      // Per-voice control state, keyed by voice id. Switching voices swaps the whole context (current segment,
      // playback speed, playhead).
      voiceState: {} as Record<VoiceId, VoiceTimingState>,
      isPlaying: false,
      // Default off: the browser's stretcher warbles at slow rates,
      // and a dropped key costs nothing while tapping timings.
      preservePitch: false,
      showButtonKeyboard: isMobile(),
      currentTime: 0,
      duration: 0,
      unregisterPlayer: null as (() => void) | null,
    };
  },
  mounted() {
    const audio = this.audioElement();
    if (audio) {
      this.unregisterPlayer = registerPlayer(audio, {
        isShown: () => (this.$el as HTMLElement).getClientRects().length > 0,
      });
    }
  },
  beforeUnmount() {
    this.unregisterPlayer?.();
  },
  computed: {
    isMobile,
    timingKeys(): TimingKeys {
      return this.settingsStore.timingKeys;
    },
    startKeyLabel(): string {
      return bindingLabel(this.timingKeys.start);
    },
    endKeyLabel(): string {
      return bindingLabel(this.timingKeys.end);
    },
    redoKeyLabel(): string {
      return bindingLabel(this.timingKeys.redo);
    },
    activeVoice(): VoiceId {
      return this.timingsStore.activeVoice;
    },
    // The active voice's lyric segments drive the timing UI.
    segments() {
      return this.lyricsStore.segmentsForVoice(this.activeVoice);
    },
    activeState(): VoiceTimingState {
      return this.voiceState[this.activeVoice] ?? defaultVoiceState();
    },
    currentSegment: {
      get(): number {
        return this.activeState.currentSegment;
      },
      set(value: number) {
        this.ensureVoiceState(this.activeVoice).currentSegment = value;
      },
    },
    playbackRate: {
      get(): number {
        return this.activeState.playbackRate;
      },
      set(value: number) {
        this.ensureVoiceState(this.activeVoice).playbackRate = value;
      },
    },
    songFile() {
      return this.mediaStore.songFile;
    },
    audioSource() {
      return this.songFile ? URL.createObjectURL(this.songFile) : undefined;
    },
    warningMessageVisible: {
      get() {
        return this.timingsStore.areTimingsUsable && !this.timingsStore.areTimingsFinished;
      },
      set() {},
    },
    successMessageVisible: {
      get() {
        return this.timingsStore.areTimingsFinished;
      },
      set() {},
    },
    currentScreen() {
      let currentScreen = 0;
      for (let i = 0; i < this.segments.length; i++) {
        const segment = this.segments[i];
        if (i == this.currentSegment) {
          break;
        }
        if (this.isSegmentEndOfScreen(segment, i)) {
          currentScreen += 1;
        }
      }
      return currentScreen;
    },
  },
  watch: {
    isPlaying(newVal) {
      if (newVal) {
        window.addEventListener("keydown", this.onKeyDown);
        this.audioElement()?.play();
      } else {
        window.removeEventListener("keydown", this.onKeyDown);
        this.audioElement()?.pause();
      }
    },
    playbackRate() {
      this.applyPlaybackSettings();
    },
    preservePitch() {
      this.applyPlaybackSettings();
    },
    activeVoice: {
      immediate: true,
      handler(newVoice: VoiceId, oldVoice?: VoiceId) {
        // Save the outgoing voice's playhead, then restore the incoming voice's context.
        const outgoing = this.audioElement();
        if (oldVoice && this.voiceState[oldVoice] && outgoing) {
          this.voiceState[oldVoice].playhead = outgoing.currentTime;
        }
        this.isPlaying = false;
        this.ensureVoiceState(newVoice);
        this.$nextTick(() => {
          const incoming = this.audioElement();
          if (incoming) {
            incoming.currentTime = this.voiceState[newVoice].playhead;
            this.applyPlaybackSettings();
          }
        });
      },
    },
  },
  methods: {
    audioElement(): HTMLAudioElement | undefined {
      return this.$refs.audio as HTMLAudioElement | undefined;
    },
    applyPlaybackSettings() {
      const audio = this.audioElement();
      if (!audio) return;
      audio.preservesPitch = this.preservePitch;
      audio.playbackRate = parseFloat(String(this.playbackRate));
    },
    ensureVoiceState(voice: VoiceId): VoiceTimingState {
      if (!this.voiceState[voice]) {
        this.voiceState = { ...this.voiceState, [voice]: defaultVoiceState() };
      }
      return this.voiceState[voice];
    },
    tapKeyFor(event: KeyboardEvent): "start" | "end" | "redo" | undefined {
      return findBinding(event, this.timingKeys, ["redo", "start", "end"] as const);
    },
    // Timing keys are caught on `window`, so a key typed into a field must not also land as a timing.
    isTypingTarget(target: EventTarget | null): boolean {
      const element = target as HTMLElement | null;
      return (
        !!element &&
        (element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName))
      );
    },
    onKeyDown(e: KeyboardEvent) {
      if (this.isTypingTarget(e.target)) {
        return;
      }
      const tapKey = this.tapKeyFor(e);
      if (tapKey === "redo") {
        this.redoScreen();
        e.preventDefault();
        return false;
      }
      const marker =
        tapKey === "start"
          ? LYRIC_MARKERS.SEGMENT_START
          : tapKey === "end"
            ? LYRIC_MARKERS.SEGMENT_END
            : undefined;
      const audio = this.audioElement();
      if (marker !== undefined && this.isPlaying && audio) {
        const currentSongTime = audio.currentTime;
        if (!this.timingsStore.areTimingsUsable || marker == LYRIC_MARKERS.SEGMENT_END) {
          this.addTimingEvent(marker, currentSongTime);
        }
        e.preventDefault();
        return false;
      }
    },
    addTimingEvent(marker: number, currentSongTime: number) {
      if (marker == LYRIC_MARKERS.SEGMENT_END) {
        this.recordTap(() =>
          this.timingsStore.add(this.currentSegment - 1, marker, currentSongTime),
        );
      } else if (marker == LYRIC_MARKERS.SEGMENT_START) {
        this.advanceToNextSegment(marker, currentSongTime);
      }
    },
    advanceToNextSegment(marker: number, currentSongTime: number) {
      if (this.currentSegment >= this.segments.length) {
        return;
      }
      this.recordTap(() => this.timingsStore.add(this.currentSegment, marker, currentSongTime));
      this.currentSegment += 1;
    },
    recordTap(write: () => void) {
      this.historyStore.record({ label: "Tap", tab: "timing" }, write);
    },
    playPause() {
      this.isPlaying = !this.isPlaying;
    },
    onTimeUpdate() {
      this.currentTime = this.audioElement()?.currentTime ?? 0;
    },
    onLoadedMetadata() {
      this.duration = this.audioElement()?.duration ?? 0;
      this.applyPlaybackSettings();
    },
    onSeek(e: Event) {
      const audio = this.audioElement();
      if (!audio) return;
      audio.currentTime = parseFloat((e.target as HTMLInputElement).value);
      claimMediaKeys(audio);
    },
    formatTime(seconds: number): string {
      if (!seconds || !isFinite(seconds)) {
        return "0:00";
      }
      const totalSec = Math.floor(seconds);
      const mm = Math.floor(totalSec / 60);
      const ss = totalSec % 60;
      return `${mm}:${ss.toString().padStart(2, "0")}`;
    },
    onAudioEvent(e: Event) {
      const audioEl = this.audioElement();
      if (!audioEl) return;
      this.isPlaying = !(audioEl.paused || audioEl.ended);
      if (e.type == "ended" && !this.timingsStore.areTimingsFinished) {
        this.addTimingEvent(LYRIC_MARKERS.SEGMENT_END, audioEl.currentTime);
      }
    },
    redoScreen() {
      let firstSegmentInScreen = this.firstSegmentOfScreen(this.currentScreen);
      if (firstSegmentInScreen == this.currentSegment) {
        // User meant to go back a screen
        firstSegmentInScreen = this.firstSegmentOfScreen(Math.max(this.currentScreen - 1, 0));
      }
      const audio = this.audioElement();
      if (audio) {
        audio.currentTime = this.secondsBeforeSegment(firstSegmentInScreen, 5);
      }
      this.historyStore.record({ label: "Redo screen", tab: "timing" }, () =>
        this.timingsStore.setCurrentSegment(firstSegmentInScreen),
      );
      this.currentSegment = firstSegmentInScreen;
    },
    firstSegmentOfScreen(screenNum: number) {
      let currentScreen = 0,
        segmentNum = 0;

      for (segmentNum = 0; currentScreen < screenNum; segmentNum++) {
        if (segmentNum >= this.segments.length) {
          throw Error(`firstSegmentOfScreen: no such screen ${screenNum}`);
        }
        const segment = this.segments[segmentNum];
        if (this.isSegmentEndOfScreen(segment, segmentNum)) {
          currentScreen += 1;
        }
      }
      return segmentNum;
    },
    secondsBeforeSegment(segmentNum: number, seconds: number) {
      const segmentStart = this.timingsStore.timingForSegmentNum(segmentNum);
      return Math.max(segmentStart - seconds, 0);
    },
    isSegmentEndOfScreen(segment: Segment, segmentIndex: number) {
      return segment.text.endsWith("\n\n") || segmentIndex == this.segments.length - 1;
    },
  },
});
</script>

<style scoped>
/* The note goes under the name, so the tab list stays as narrow as the other names allow. */
.tab-label-note {
  display: block;
}

.title-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

/* Bulma only spaces a title that is :not(:last-child), and the voice selector beside it
   is v-if'd away for single-voice songs. The row owns the spacing instead. */
.title-row .title {
  margin-bottom: 0;
}

.playback-speed {
  display: flex;
  flex-grow: 1;
  padding-right: 2em;
}

.playback-speed :deep(.field-body) {
  display: flex;
  flex-direction: row;
}

.playback-speed :deep(.control) {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
}

.preserve-pitch :deep(.field-label) {
  white-space: nowrap;
}

.is-flex-shrink-0 {
  flex-shrink: 0;
  margin-right: 0.25rem;
}

.seek-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.seek-slider {
  flex-grow: 1;
  cursor: pointer;
  accent-color: #7957d5;
}

.seek-slider:disabled {
  cursor: default;
}

.seek-time {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  font-size: 0.9rem;
  color: var(--bulma-text, #4a4a4a);
  min-width: 3ch;
  text-align: center;
}
</style>
