<template>
  <div class="preview-container">
    <b-message type="is-info">
      Audio in this preview includes vocals, but the finished video won't.
    </b-message>
    <canvas
      class="subtitle-canvas"
      ref="subtitleCanvas"
      width="320"
      height="240"
      :style="{ backgroundColor }"
    ></canvas>
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

import { defineComponent } from "vue";
import bufferToWav from "audiobuffer-to-wav";
import SubtitlesOctopus from "libass-wasm";
import { Color } from "buefy/src/utils/color";

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
    backgroundColor: {
      type: String,
      default: "#000000",
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
.preview-container {
  text-align: center;
  width: 320px;
}
</style>