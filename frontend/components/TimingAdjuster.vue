<template>
  <div>
    <smooth-audio-player ref="audioPlayer" controls :src="audioSource" @timeupdate="onAudioTimeUpdate"
      @seeking="onAudioSeeking" @play="onAudioPlay" @pause="onAudioPause" @error="onAudioError" />
    <b-message v-if="error" type="is-danger" has-icon icon="circle-exclamation" :closable="false"
      class="adjuster-error">
      <p>The timing adjuster couldn't be displayed for this song.</p>
      <p class="adjuster-error-detail">{{ error }}</p>
      <p>
        Your timings haven't been changed. You can still make your video from
        the Submit tab.
      </p>
    </b-message>
    <wavesurfer v-else ref="wavesurfer" :audioData="vocalTrack || audioData" :regions="regions" :mediaControls="false"
      :showWaveform="true || Boolean(vocalTrack)" @region-updated="onRegionUpdated" @seeking="onWavesurferSeeking" />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { LyricSegmentIterator } from "@/lib/timing";
import {
  RegionParams,
  Region,
} from "@/lib/wavesurferPlugins/OpenEndedRegionPlugin";
import Wavesurfer from "@/components/Wavesurfer.vue";
import SmoothAudioPlayer from "./SmoothAudioPlayer.vue";

import { LyricEvent, adjustSegmentTiming } from "@/lib/timing";
import { LYRIC_MARKERS } from "@/constants";

function createLyricRegion(id: number, params): RegionParams {
  return {
    id: `segment_${id}`,
    // The region plugin uses "channels" to display regions on different lines
    channelIdx: id % 5,
    loop: false,
    drag: false,
    resize: true,
    ...params,
  };
}

export default defineComponent({
  components: {
    Wavesurfer,
    SmoothAudioPlayer,
  },
  props: {
    lyrics: String,
    timings: Array<LyricEvent>,
    audioData: Blob,
    // URL to the vocal track audio file
    vocalTrack: { type: Blob, required: false },
  },
  data() {
    return {
      regions: [],
      audioSource: null as string | null,
      // Set when the adjuster can't be built, e.g. from timings that don't
      // match the lyrics. Shown in place of the waveform.
      error: null as string | null,
    };
  },
  computed: {
    splitLyrics(): Array<String> {
      if (this.lyrics == null) {
        return [];
      }
      const lyricIterator = new LyricSegmentIterator(this.lyrics)[
        Symbol.iterator
      ]();

      return [...lyricIterator].map((segment) => segment.text);
    },
  },
  mounted() {
    if (this.audioData) {
      this.audioSource = URL.createObjectURL(this.audioData);
    }
    this.rebuildRegions();
  },
  errorCaptured(e: unknown) {
    // The waveform or the audio player failed. Say so instead of leaving an
    // empty space under the preview. Returning nothing lets the error keep
    // propagating to the app's error handler, which logs it to the server.
    this.error = this.errorMessage(e);
  },
  watch: {
    timings: {
      handler: function () {
        this.rebuildRegions();
      },
      deep: true
    },
    lyrics(newLyrics: String) {
      this.rebuildRegions();
    },
    audioData(newAudioData: Blob) {
      if (newAudioData) {
        if (this.audioSource) {
          URL.revokeObjectURL(this.audioSource);
        }
        this.audioSource = URL.createObjectURL(newAudioData);
      }
    },
  },
  methods: {
    rebuildRegions() {
      try {
        this.regions = this.createRegions(this.timings, this.splitLyrics);
        this.error = null;
      } catch (e) {
        // console.error is what forwards the error to the server, so keep it
        // even though we're handling this one.
        console.error("Timing adjuster could not build regions", e);
        this.error = this.errorMessage(e);
      }
    },
    errorMessage(e: unknown): string {
      return e instanceof Error ? e.message : String(e);
    },
    createRegions(
      timings: Array<LyricEvent>,
      lyrics: Array<String>
    ): Array<RegionParams> {
      if (!timings || !lyrics) {
        return [];
      }
      let regions = [];
      let currentRegion = null;
      let currentLyricIndex = 0;
      for (let i = 0; i < timings.length; i++) {
        const [time, marker] = timings[i];
        if (marker === LYRIC_MARKERS.SEGMENT_START) {
          if (currentRegion) {
            regions.push(currentRegion);
            currentLyricIndex += 1;
          }
          const lyricSegment = lyrics[currentLyricIndex];
          currentRegion = createLyricRegion(regions.length, {
            start: time,
            end: null,
            content: lyricSegment,
            color: "rgba(102, 209, 255, 1)",
          });
        } else if (marker === LYRIC_MARKERS.SEGMENT_END) {
          currentRegion.end = time;
        }
      }
      if (currentRegion) {
        regions.push(currentRegion);
      }
      return regions;
    },
    onRegionUpdated(region: Region) {
      const newTimings = this.applyRegionUpdateToTimings(region, this.timings);
      this.$emit("timingschange", newTimings);
      this.$nextTick(() => {
        this.previewNewTiming(region);
      });
    },
    applyRegionUpdateToTimings(
      region: Region,
      timings: Array<LyricEvent>
    ): Array<LyricEvent> {
      const segmentNum = parseInt(region.id.split("_")[1]);
      return adjustSegmentTiming(segmentNum, timings, {
        start: region.start,
        end: region.end,
      });
    },
    previewNewTiming(region: Region) {
      // When a timing changes, set the playhead 5 seconds before the changed region
      const newPlayhead = Math.max(0, region.start - 5);
      this.setAudioPlayhead(newPlayhead);
    },
    onTimeUpdate(time: number) {
      this.$emit("timeupdate", time);
    },
    onSeeking(time: number) {
      this.$emit("seeking", time);
    },
    setAdjusterPlayhead(playhead: number) {
      this.$refs.wavesurfer?.setTime(playhead);
    },
    setAudioPlayhead(playhead: number) {
      this.$refs.audioPlayer.currentTime = playhead;
    },
    onAudioTimeUpdate(event: Event) {
      const time = (event.target as HTMLAudioElement).currentTime;
      this.setAdjusterPlayhead(time);
      this.$emit("timeupdate", time);
    },
    onAudioSeeking(event: Event) {
      const time = (event.target as HTMLAudioElement).currentTime;
      this.setAdjusterPlayhead(time);
      this.$emit("seeking", time);
    },
    onWavesurferSeeking(time: number) {
      console.log("Wavesurfer seeking", time);
      this.setAudioPlayhead(time);
    },
    onWavesurferSeeked(time: number) {
      this.setAudioPlayhead(time);
    },
    onAudioPlay() {
      // this.$refs.wavesurfer.play();
    },
    onAudioPause() {
      this.$refs.wavesurfer?.pause();
    },
    onAudioError(event: Event) {
      const audio = event.target as HTMLAudioElement;
      console.error("Audio loading error:", {
        error: audio.error,
        currentSrc: audio.currentSrc,
        readyState: audio.readyState,
        networkState: audio.networkState,
      });
    },
  },
  beforeUnmount() {
    if (this.audioSource) {
      URL.revokeObjectURL(this.audioSource);
    }
  },
});
</script>

<style scoped>
audio {
  width: 100%;
  margin-bottom: 1em;
}

.adjuster-error-detail {
  font-family: monospace;
  overflow-wrap: anywhere;
}
</style>