<template>
  <div class="preview-container">
    <b-message type="is-info">
      Audio in this preview includes vocals, but the finished video won't.
    </b-message>
    <subtitle-display
      ref="subtitleDisplay"
      :subtitles="subtitles"
      :audioDelay="audioDelay"
      :fonts="fonts"
      :backgroundColor="backgroundColor"
      :videoBlob="videoBlob"
    />
    <smooth-audio-player
      ref="player"
      :src="audioDataUrl"
      controls
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
import SubtitleDisplay from "./SubtitleDisplay.vue";
import SmoothAudioPlayer from "./SmoothAudioPlayer.vue";
import { prependSilenceToChannels } from "@/lib/audio";

export default defineComponent({
  components: { SubtitleDisplay, SmoothAudioPlayer },
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
      audioDataUrl: "",
    };
  },
  mounted() {
    this.updateAudio(this.songFile, this.audioDelay);
  },
  watch: {
    songFile(newSongFile: Blob) {
      this.updateAudio(newSongFile, this.audioDelay);
    },
  },
  methods: {
    setPlayhead(playhead: number) {
      if (playhead != this.$refs.player.currentTime) {
        this.$refs.player.currentTime = playhead;
      }
      this.$refs.subtitleDisplay.setPlayhead(playhead);
    },
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

      const channels = Array.from(
        { length: audioBuffer.numberOfChannels },
        (_, channel) => audioBuffer.getChannelData(channel)
      );
      const paddedChannels = prependSilenceToChannels(
        channels,
        audioBuffer.sampleRate,
        secondsOfSilence
      );

      const songWithSilenceBuffer = audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        paddedChannels[0].length,
        audioBuffer.sampleRate
      );
      paddedChannels.forEach((data, channel) =>
        songWithSilenceBuffer.copyToChannel(data, channel)
      );
      audioContext.close();

      // Convert the result buffer to a wav
      const wavAudio: ArrayBuffer = bufferToWav(songWithSilenceBuffer);
      const result = new Blob([new DataView(wavAudio)], {
        type: "audio/wav",
      });

      return result;
    },

    onAudioTimeUpdate(e: Event) {
      const currentTime = (e.target as HTMLAudioElement).currentTime;
      this.setPlayhead(currentTime);
      this.$emit("timeupdate", currentTime);
    },
    // These listeners call some internal libass-wasm functions that dramatically
    // improve rendering performance
    onAudioPlaying() {
      this.$refs.subtitleDisplay.play();
      this.$emit("playing");
    },

    onAudioPause() {
      this.$refs.subtitleDisplay.pause();
      this.$emit("pause");
    },
    onAudioSeeking(e: Event) {
      this.$refs.player.removeEventListener(
        "timeupdate",
        this.onAudioTimeUpdate,
        false
      );
      this.$emit("seeking");
    },

    onAudioSeeked(e: Event) {
      this.$refs.player.addEventListener(
        "timeupdate",
        this.onAudioTimeUpdate,
        false
      );

      var currentTime = (e.target as HTMLAudioElement).currentTime;
      this.$refs.subtitleDisplay.setPlayhead(currentTime);

      this.$emit("seeked", currentTime);
    },
    onAudioWaiting() {
      this.$refs.subtitleDisplay.pause();
      this.$emit("waiting");
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