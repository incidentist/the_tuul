<template>
  <div class="preview-container">
    <b-message type="is-info">
      Audio in this preview includes vocals, but the finished video won't.
    </b-message>
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
      ></canvas>
    </div>
    <audio
      ref="player"
      controls
      :src="audioDataUrl"
      @timeupdate="onAudioTimeUpdate"
      @playing="onAudioPlaying"
      @pause="onAudioPause"
      @seeking="onAudioSeeking"
      @seeked="onAudioSeeked"
      @waiting="onAudioWaiting"
    />
  </div>
</template>

<script lang="ts">
/* A component that displays WebVTT subtitles over a black screen, with an audio file provided as a prop */
// TODO: Incorporate audio delay

import * as _ from "lodash";
import { defineComponent } from "vue";
import bufferToWav from "audiobuffer-to-wav";
import SubtitlesOctopus from "libass-wasm";

export default defineComponent({
  props: {
    songFile: {
      type: Blob,
      required: true,
    },
    subtitles: {
      type: String,
      required: true,
    },
    audioDelay: {
      type: Number,
      default: 0.0,
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
  },
  data() {
    return {
      subtitleManager: null,
      audioDataUrl: "",
    };
  },
  mounted() {
    const canvas = this.$refs.subtitleCanvas;
    // SubtitleOctopus expects font names to be lowercase
    const fontMap = _.mapKeys(this.fonts, (_, key) => key.toLowerCase());
    // Create a subtitle renderer and tie it to our player and canvas
    // console.log(fontMap);
    const workerUrl = new URL(
      "libass-wasm/dist/js/subtitles-octopus-worker.js",
      import.meta.url
    ); // Link to WebAssembly-based file "libassjs-worker.js"
    const workerObjectUrl = URL.createObjectURL(
      new Blob([`importScripts("${workerUrl.toString()}")`], {
        type: "application/javascript",
      })
    );
    console.log(workerUrl.toString());
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

    this.updateAudio(this.songFile, this.audioDelay);
  },
  watch: {
    subtitles(newSubs: string) {
      this.subtitleManager.setTrack(newSubs);
    },
    songFile(newSongFile: Blob) {
      this.updateAudio(newSongFile, this.audioDelay);
    },
  },
  computed: {
    videoDataUrl() {
      if (this.videoBlob) {
        return URL.createObjectURL(this.videoBlob);
      }
      return null;
    },
  },
  methods: {
    async updateAudio(audioData: Blob, silence: number) {
      const audioWithSilence = await this.prependSilence(audioData, silence);
      this.audioDataUrl = URL.createObjectURL(audioWithSilence);
    },
    async prependSilence(
      audioData: Blob,
      secondsOfSilence: number
    ): Promise<Blob> {
      // Prepend N seconds of silence to the start of the songfile
      if (secondsOfSilence == 0) {
        return audioData;
      }

      // TODO: can we do some of these steps in parallel?
      const audioContext = new AudioContext();
      const arrayBuffer = await audioData.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Create an OfflineAudioContext with the desired duration
      const offlineAudioContext = new OfflineAudioContext({
        numberOfChannels: audioBuffer.numberOfChannels,
        length: audioBuffer.length + secondsOfSilence * audioBuffer.sampleRate,
        sampleRate: audioBuffer.sampleRate,
      });

      // Create a source node from the original audio buffer
      const source = offlineAudioContext.createBufferSource();
      source.buffer = audioBuffer;

      // Connect the source node to the destination node (output)
      source.connect(offlineAudioContext.destination);

      // Start rendering the audio
      source.start();

      // Wait for the audio to finish rendering
      const songBuffer = await offlineAudioContext.startRendering();

      // Create a new AudioBuffer with the desired length
      const songWithSilenceBuffer = audioContext.createBuffer(
        songBuffer.numberOfChannels,
        songBuffer.length + secondsOfSilence * audioBuffer.sampleRate,
        songBuffer.sampleRate
      );

      // Get the channel data from the result buffer
      for (let channel = 0; channel < songBuffer.numberOfChannels; channel++) {
        const resultData = songBuffer.getChannelData(channel);
        const silenceData = songWithSilenceBuffer.getChannelData(channel);

        // Copy the result data to the end of the silence buffer
        silenceData.set(resultData, secondsOfSilence * audioBuffer.sampleRate);
      }

      // Convert the result buffer to a wav
      const wavAudio: ArrayBuffer = bufferToWav(songWithSilenceBuffer);
      const result = new Blob([new DataView(wavAudio)], {
        type: "audio/wav",
      });

      return result;
    },

    onAudioTimeUpdate() {
      const currentTime = this.$refs.player.currentTime;
      this.subtitleManager.setCurrentTime(currentTime);
      if (this.$refs.video) {
        this.$refs.video.currentTime = Math.max(
          0,
          currentTime - this.audioDelay
        );
      }
    },
    // These listeners call some internal libass-wasm functions that dramatically
    // improve rendering performance
    onAudioPlaying() {
      this.subtitleManager.setIsPaused(false, this.$refs.player.currentTime);
      // this.$refs.video?.play();
    },

    onAudioPause() {
      this.subtitleManager.setIsPaused(true, this.$refs.player.currentTime);
      // this.$refs.video?.pause();
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
      if (this.$refs.video) {
        this.$refs.video.currentTime = Math.max(
          0,
          currentTime - this.audioDelay
        );
      }
    },
    onAudioWaiting() {
      this.subtitleManager.setIsPaused(true, this.$refs.player.currentTime);
      // this.$refs.video?.pause();
    },
  },
});
</script>
<style scoped>
.preview-container {
  text-align: center;
  width: 320px;
}

.video-container {
  position: relative;
  height: 240px;
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