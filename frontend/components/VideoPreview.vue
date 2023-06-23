<template>
  <div>
    <canvas
      class="subtitle-canvas"
      ref="subtitleCanvas"
      width="320"
      height="240"
    ></canvas>
    <audio
      ref="player"
      controls
      :src="audioData"
      @timeupdate="onAudioTimeUpdate"
      @playing="onAudioPlaying"
      @pause="onAudioPause"
      @seeking="onAudioSeeking"
      @seeked="onAudioSeeked"
      @waiting="onAudioWaiting"
    />
    <!-- <button @click="play">Play</button> -->
  </div>
</template>

<script lang="ts">
/* A component that displays WebVTT subtitles over a black screen, with an audio file provided as a prop */
// TODO: Incorporate audio delay

import { defineComponent } from "vue";
import SubtitlesOctopus from "libass-wasm";

export default defineComponent({
  props: {
    songFile: {
      type: File,
      required: true,
    },
    subtitles: {
      type: String,
      required: true,
    },
  },
  data() {
    return {
      subtitleManager: null,
    };
  },
  mounted() {
    const canvas = this.$refs.subtitleCanvas;
    const audioElement = this.$refs.player;

    // Create a subtitle renderer and tie it to our player and canvas
    var options = {
      debug: false,
      canvas: canvas,
      subContent: this.subtitles,
      fonts: ["/static/ArialNarrow.ttf"], // Links to fonts (not required, default font already included in build)
      workerUrl: "/static/subtitles-octopus-worker.js", // Link to WebAssembly-based file "libassjs-worker.js"
      legacyWorkerUrl: "/static/subtitles-octopus-worker-legacy.js", // Link to non-WebAssembly worker
    };
    this.subtitleManager = new SubtitlesOctopus(options);
  },
  watch: {
    subtitles(newSubs: string) {
      this.subtitleManager.setTrack(newSubs);
    },
  },
  computed: {
    audioData(): string {
      return this.songFile ? URL.createObjectURL(this.songFile) : "";
    },
    videoData(): string {
      const durationInSeconds = 10;
      const fillColor = "#000000";
      const width = 640;
      const height = 480;
      const canvas = document.createElement("canvas") as HTMLCanvasElement;
      canvas.width = width;
      canvas.height = height;

      // Fill canvas with black
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = fillColor;
      ctx.fillRect(0, 0, width, height);

      var dataUrl = canvas.toDataURL("video/webm");
      // Set the duration in the data url
      const durationString = "#t=0," + durationInSeconds;
      dataUrl = dataUrl.replace(/#t=0,/, durationString);

      return dataUrl;
    },
  },
  methods: {
    onAudioTimeUpdate() {
      this.subtitleManager.setCurrentTime(this.$refs.player.currentTime);
    },
    // These listeners call some internal libass-wasm functions that dramatically
    // improve rendering performance
    onAudioPlaying() {
      this.subtitleManager.setIsPaused(false, this.$refs.player.currentTime);
    },

    onAudioPause() {
      this.subtitleManager.setIsPaused(true, this.$refs.player.currentTime);
    },
    onAudioSeeking() {
      this.$refs.player.removeEventListener(
        "timeupdate",
        this.onAudioTimeUpdate,
        false
      );
    },

    onAudioSeeked() {
      this.$refs.player.addEventListener(
        "timeupdate",
        this.onAudioTimeUpdate,
        false
      );

      var currentTime = this.$refs.player.currentTime;

      this.subtitleManager.setCurrentTime(currentTime);
    },
    onAudioWaiting() {
      this.subtitleManager.setIsPaused(true, this.$refs.player.currentTime);
    },
  },
});
</script>
<style scoped>
.subtitle-canvas {
  background-color: black;
}
</style>