<template>
  <div class="video-container">
    <video
      class="background-video"
      v-if="videoBlob"
      ref="video"
      :src="videoDataUrl"
    />
    <canvas
      class="subtitle-canvas"
      ref="subtitleCanvas"
      :style="{
        backgroundColor: videoBlob ? 'transparent' : backgroundColor,
      }"
    >
    </canvas>
  </div>
</template>

<script lang="ts">
/* A component that displays an .ass file */

import { throttle, mapKeys } from "lodash-es";
import { defineComponent } from "vue";
import SubtitlesOctopus from "libass-wasm";

export default defineComponent({
  props: {
    subtitles: {
      type: String,
      required: true,
    },
    fonts: {
      type: Object,
    },
    backgroundColor: {
      type: String,
      default: "#000000",
    },
    videoBlob: {
      type: Blob,
      required: false,
    },
    // Needed to display video properly
    audioDelay: {
      type: Number,
      default: 0.0,
    },
  },
  data() {
    return {
      subtitleManager: null,
      currentTime: null,
    };
  },
  computed: {
    videoDataUrl() {
      if (this.videoBlob) {
        return URL.createObjectURL(this.videoBlob);
      }
      return null;
    },
  },
  created() {
    // Chrome video stutters when currentTime is set frequently, so we throttle it to 15fps
    this.setVideoPlayhead = throttle(this.setVideoPlayhead, 1000 / 15);
  },
  mounted() {
    this.currentTime = 0.0;
    this.createSubtitleManager();
  },
  watch: {
    subtitles(newSubs: string) {
      if (this.subtitleManager) {
        this.subtitleManager.setTrack(newSubs);
      } else {
        this.createSubtitleManager();
      }
    },
    currentTime(newTime: number) {
      this.subtitleManager?.setCurrentTime(newTime);
    },
  },
  methods: {
    createSubtitleManager() {
      // The worker can't start without subtitle content (it falls back to an
      // unset subUrl and crashes), so wait until we have some.
      if (!this.subtitles) {
        return;
      }
      const canvas = this.$refs.subtitleCanvas;
      // SubtitleOctopus expects font names to be lowercase
      const fontMap = mapKeys(this.fonts, (_, key) => key.toLowerCase());
      // Create a subtitle renderer and tie it to our player and canvas
      var options = {
        debug: false,
        canvas: canvas,
        subContent: this.subtitles,
        lazyFileLoading: true,
        availableFonts: fontMap,
        // workerUrl: require("!!file-loader?name=[name].[ext]!libass-wasm/dist/subtitles-octopus-worker.js"),
        // workerUrl: workerUrl,
        workerUrl: "/static/subtitles-octopus-worker.js", // Link to WebAssembly-based file "libassjs-worker.js"
        legacyWorkerUrl: "/static/subtitles-octopus-worker-legacy.js", // Link to non-WebAssembly worker
      };
      this.subtitleManager = new SubtitlesOctopus(options);
      this.subtitleManager.setCurrentTime(this.currentTime);
    },
    setPlayhead(playhead: number) {
      this.currentTime = playhead;
      this.setVideoPlayhead(Math.max(0, playhead - this.audioDelay));
    },
    setVideoPlayhead(playhead: number) {
      if (this.$refs.video) {
        this.$refs.video.currentTime = playhead;
      }
    },
    pause() {
      this.subtitleManager?.setIsPaused(true, this.currentTime);
    },
    play() {
      this.subtitleManager?.setIsPaused(false, this.currentTime);
    },
  },
});
</script>

<style scoped>
.video-container {
  position: relative;
  height: 240px;
  width: 320px;
}

.background-video {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.subtitle-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
</style>