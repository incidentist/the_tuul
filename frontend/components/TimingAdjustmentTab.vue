<template>
  <b-tab-item icon="flask" label="Adjust (BETA)" :disabled="!isEnabled" class="timing-adjustment-tab"
    headerClass="timing-adjustment-tab-header">
    <h2 class="title">Adjust Timings</h2>
    <div class="content">
      <p>
        Use this tab to adjust lyric timings by dragging the start of the
        lyric's rectangle. If you marked the end of a lyric with the Enter key,
        you can also adjust the end of it.
      </p>
      <b-field label="Skip Back Seconds" label-position="on-border">
        <template #label>
          Skip Back Seconds
          <b-tooltip label="Number of seconds to rewind when a timing is adjusted." position="is-right">
            <b-icon icon="help-circle-outline" size="is-small" />
          </b-tooltip>
        </template>
        <b-input type="number" v-model.number="settingsStore.videoOptions.skipBackSecs" min="0" />
      </b-field>
    </div>
    <subtitle-display class="subtitle-display" v-if="songFile && adjustmentSubtitles" ref="subtitleDisplay" :subtitles="adjustmentSubtitles"
      :fonts="{}" :backgroundColor="settingsStore.videoOptions.color.background.toString()" />
    <timing-adjuster v-if="songFile && adjustmentSubtitles" ref="timing-adjuster" :lyrics="lyricText"
      :timings="timingsStore.rawTimings" :audioData="songFile" :vocalTrack="vocalTrack" @timingschange="onTimingsChange"
      @timeupdate="onPlayheadUpdate" @seeking="onPlayheadUpdate" />
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { LyricEvent } from "@/lib/timing";
import TimingAdjuster from "@/components/TimingAdjuster.vue";
import SubtitleDisplay from "./SubtitleDisplay.vue";
import { useMediaStore } from "@/stores/media";
import { useTimingsStore } from "@/stores/timings";
import { useLyricsStore } from "@/stores/lyrics";
import { useSettingsStore } from "@/stores/settings";
import { storeToRefs } from "pinia";

export default defineComponent({
  components: { TimingAdjuster, SubtitleDisplay },
  setup() {
    const mediaStore = useMediaStore();
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    const settingsStore = useSettingsStore();
    const { lyricText } = storeToRefs(lyricsStore);
    const { subtitles } = storeToRefs(timingsStore);
    return {
      mediaStore,
      timingsStore,
      settingsStore,
      lyricText,
      subtitles,
    };
  },
  data() {
    return {
      // Controls playhead in video and adjuster (in seconds)
      playhead: 0.0,
    };
  },
  computed: {
    songFile(): Blob | null {
      return this.mediaStore.songFile;
    },
    vocalTrack(): Blob | null {
      return this.mediaStore.separatedTrack?.vocals || null;
    },
    isEnabled(): boolean {
      return this.timingsStore.length > 0;
    },
    adjustmentSubtitles(): string {
      return this.subtitles({ addTitleScreen: false, addCountIns: false });
    },
  },
  watch: {
    playhead(newPlayhead: number) {
      if (this.$refs.subtitleDisplay) {
        this.$refs.subtitleDisplay.setPlayhead(newPlayhead);
      }
    },
  },
  methods: {
    onTimingsChange(newTimings: Array<LyricEvent>) {
      this.timingsStore.resetTimings(newTimings);
    },
    onPlayheadUpdate(newPlayhead: number) {
      if (newPlayhead !== this.playhead) {
        this.playhead = newPlayhead;
      }
    },
  },
});
</script>

<style scoped>
.timing-adjustment-tab {
  display: flex;
  flex-direction: column;
}

.subtitle-display {
  align-self: center;
}
</style>
