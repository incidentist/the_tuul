<template>
  <div class="playback-transport" role="group" aria-label="Playback">
    <button
      type="button"
      class="button is-small transport-play"
      :aria-label="paused ? 'Play' : 'Pause'"
      :disabled="!duration"
      @click="playPause"
    >
      <b-icon :icon="paused ? 'play' : 'pause'" />
    </button>
    <span class="transport-time">{{ loading ? "Loading…" : formatTime(time) }}</span>
    <slot name="slider">
      <input
        class="transport-slider"
        type="range"
        aria-label="Playback position"
        min="0"
        :max="duration || 0"
        step="any"
        :value="time"
        :disabled="!duration"
        @input="onSeek"
      />
    </slot>
    <span class="transport-time">{{ formatTime(duration) }}</span>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { BIcon } from "buefy";
import { WebAudioPlayer } from "@/lib/webAudioPlayer";

const EVENTS = ["play", "pause", "seeking", "timeupdate", "loadstart", "loadeddata"];

// The transport follows the player itself, so that the time ticking on every frame re-renders
// only the transport.
export default defineComponent({
  components: { BIcon },
  props: {
    player: { type: Object as PropType<WebAudioPlayer>, required: true },
  },
  data() {
    return { paused: true, loading: true, time: 0, duration: 0 };
  },
  mounted() {
    for (const type of EVENTS) this.player.addEventListener(type, this.sync);
    this.sync();
  },
  beforeUnmount() {
    for (const type of EVENTS) this.player.removeEventListener(type, this.sync);
  },
  methods: {
    sync() {
      const { player } = this;
      this.paused = player.paused;
      this.loading = player.loading;
      this.time = player.currentTime;
      this.duration = Number.isFinite(player.duration) ? player.duration : 0;
    },
    playPause() {
      if (this.player.paused) {
        this.player.play().catch((error) => {
          console.error("Could not start playback:", error);
        });
      } else {
        this.player.pause();
      }
    },
    onSeek(event: Event) {
      this.player.currentTime = parseFloat((event.target as HTMLInputElement).value);
    },
    formatTime(seconds: number): string {
      if (!seconds || !isFinite(seconds)) return "0:00";
      const totalSeconds = Math.floor(seconds);
      const minutes = Math.floor(totalSeconds / 60);
      return `${minutes}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
    },
  },
});
</script>

<style scoped>
.playback-transport {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1em;
}

.transport-slider {
  flex-grow: 1;
  min-width: 0;
  cursor: pointer;
  accent-color: var(--bulma-primary, #7957d5);
}

.transport-slider:disabled {
  cursor: default;
}

.transport-time {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  font-size: 0.9rem;
  min-width: 4ch;
  text-align: center;
}
</style>
