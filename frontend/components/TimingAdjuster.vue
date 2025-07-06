<template>
  <div>
    <smooth-audio-player ref="audioPlayer" controls :src="audioSource" @timeupdate="onAudioTimeUpdate"
      @seeking="onAudioSeeking" @play="onAudioPlay" @pause="onAudioPause" @error="onAudioError" />
    <wavesurfer ref="wavesurfer" :audioData="vocalTrack || audioData" :regions="regions" :mediaControls="false"
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
import { useSettingsStore } from "@/stores/settings";

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
  setup() {
    const settingsStore = useSettingsStore();
    return {
      settingsStore,
    };
  },
  data() {
    return {
      regions: [],
      audioSource: null as string | null,
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
    this.regions = this.createRegions(this.timings, this.splitLyrics);
    if (this.audioData) {
      this.audioSource = URL.createObjectURL(this.audioData);
    }
  },
  watch: {
    timings: {
      handler: function (newTimings: Array<LyricEvent>) {
        this.regions = this.createRegions(newTimings, this.splitLyrics);
      },
      deep: true
    },
    lyrics(newLyrics: String) {
      this.regions = this.createRegions(this.timings, this.splitLyrics);
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
      const newPlayhead = Math.max(0, region.start - this.settingsStore.videoOptions.skipBackSecs);
      this.setAudioPlayhead(newPlayhead);
    },
    onTimeUpdate(time: number) {
      this.$emit("timeupdate", time);
    },
    onSeeking(time: number) {
      this.$emit("seeking", time);
    },
    setAdjusterPlayhead(playhead: number) {
      this.$refs.wavesurfer.setTime(playhead);
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
      this.$refs.wavesurfer.pause();
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
</style>