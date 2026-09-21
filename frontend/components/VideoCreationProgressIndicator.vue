<template>
  <div class="video-creation-progress-indicator">
    <b-message type="is-success" has-icon icon="wand-magic-sparkles">
      Creating your karaoke video. This might take a few minutes.
    </b-message>
    <b-progress
      type="is-success"
      size="is-medium"
      :rounded="false"
      :value="progressValue"
      show-value
    >
      {{ progressMessage }}
    </b-progress>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { CreationPhase, SeparationPhase, SeparationProgress } from "@/types";

export default defineComponent({
  props: {
    // Progress of CreatingVideo phase, from 0 to 1
    progress: Number,
    // Millis elapsed since submission start
    elapsedTime: Number,
    // Duration of the song in seconds
    songDuration: Number,
    phase: Number as PropType<CreationPhase>,
    // Progress reported by the separation backend during SeparatingVocals.
    // Null when the backend reports nothing, in which case progress is
    // estimated from elapsed time.
    separationProgress: {
      type: Object as PropType<SeparationProgress | null>,
      default: null,
    },
  },
  data() {
    return {
      CreationPhase,
    };
  },
  computed: {
    // Fraction complete for the current phase, or null when unknown
    phaseProgress(): number | null {
      if (this.phase == CreationPhase.CreatingVideo) {
        return this.progress;
      } else if (this.phase == CreationPhase.SeparatingVocals) {
        return this.separationFraction;
      }
      return null;
    },
    separationFraction(): number | null {
      if (this.separationProgress) {
        return this.separationProgress.fraction;
      }
      // Nothing reported: guess that separation takes about as long as the song
      const elapsedSeconds = this.elapsedTime / 1000;
      return Math.min(elapsedSeconds / this.songDuration, 1);
    },
    // Value for the progress bar; undefined renders Buefy's indeterminate bar
    progressValue(): number | undefined {
      return this.phaseProgress == null ? undefined : this.phaseProgress * 100;
    },
    percentComplete(): string {
      return `${Math.round(this.phaseProgress * 100)}%`;
    },
    progressMessage(): string {
      if (this.phase == CreationPhase.CreatingVideo) {
        return `Creating video: ${this.percentComplete}`;
      } else if (this.phase == CreationPhase.SeparatingVocals) {
        return this.separationMessage;
      }
      return "";
    },
    separationMessage(): string {
      switch (this.separationProgress?.phase) {
        case SeparationPhase.LoadingModel:
          return this.withPercent("Loading separation model");
        case SeparationPhase.WritingOutput:
          return this.withPercent("Writing separated tracks");
        default:
          return this.withPercent("Creating instrumental track");
      }
    },
  },
  methods: {
    withPercent(message: string): string {
      return this.phaseProgress == null
        ? `${message}...`
        : `${message}: ${this.percentComplete}`;
    },
  },
});
</script>

<style scoped>
.video-creation-progress-indicator {
  padding: 0.5rem;
}
</style>
