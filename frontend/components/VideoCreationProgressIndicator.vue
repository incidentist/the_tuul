<template>
  <div class="video-creation-progress-indicator">
    <b-message type="is-success" has-icon icon="wand-magic-sparkles">
      Creating your karaoke video. This might take a few minutes.
    </b-message>
    <b-progress
      type="is-success"
      size="is-medium"
      :rounded="false"
      :value="phaseProgress * 100"
      show-value
    >
      {{ progressMessage }}
    </b-progress>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { CreationPhase } from "@/types";

export default defineComponent({
  props: {
    // Progress of CreatingVideo phase, from 0 to 1
    progress: Number,
    // Millis elapsed since submission start
    elapsedTime: Number,
    // Duration of the song in seconds
    songDuration: Number,
    phase: Number as PropType<CreationPhase>,
  },
  data() {
    return {
      CreationPhase,
    };
  },
  computed: {
    progressMessage() {
      if (this.phase == CreationPhase.CreatingVideo) {
        return `Creating video: ${Math.round(this.phaseProgress * 100)}%`;
      } else if (this.phase == CreationPhase.SeparatingVocals) {
        return `Creating instrumental track: ${Math.round(
          this.phaseProgress * 100
        )}%`;
      }
    },
    phaseProgress() {
      if (this.phase == CreationPhase.CreatingVideo) {
        return this.progress;
      } else if (this.phase == CreationPhase.SeparatingVocals) {
        const elapsedSeconds = this.elapsedTime / 1000;
        return Math.min(elapsedSeconds / this.songDuration, 1);
      }
    },
  },
});
</script>

<style scoped>
.video-creation-progress-indicator {
  padding: 0.5rem;
}
</style>

