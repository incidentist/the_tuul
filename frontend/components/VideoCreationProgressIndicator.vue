<template>
  <div class="video-creation-progress-indicator">
    <b-progress
      type="is-warning"
      size="is-medium"
      :value="phase == CreationPhase.CreatingVideo ? progress * 100 : undefined"
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
    progress: Number,
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
        return `Creating video: ${Math.round(this.progress * 100)}%`;
      } else if (this.phase == CreationPhase.SeparatingVocals) {
        return "Creating instrumental track...";
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

