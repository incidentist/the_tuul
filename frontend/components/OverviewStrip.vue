<template>
  <div
    ref="strip"
    class="overview-strip"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @pointerleave="hideHover"
    @wheel="$emit('scroll-wheel', $event, timeAt($event.clientX))"
  >
    <!-- Keyboards and screen readers seek with this, and the pointer with the strip around it. -->
    <input
      ref="slider"
      class="transport-slider"
      type="range"
      aria-label="Playback position"
      min="0"
      :max="duration"
      step="any"
      :disabled="loading"
      @input="onSliderInput"
    />
    <canvas ref="canvas" class="overview-wave" />
    <div v-memo="[spans]" class="overview-regions">
      <div
        v-for="(span, index) in spans"
        :key="index"
        :class="['overview-region', span.kind]"
        :style="span.style"
      />
    </div>
    <div
      v-if="viewBox"
      class="overview-view"
      :class="{ 'is-centered': centered }"
      :style="viewBox"
    />
    <div ref="playhead" class="overview-playhead" />
    <div ref="hover" class="overview-hover" hidden />
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { WebAudioPlayer } from "@/lib/webAudioPlayer";
import type { RegionReview } from "@/lib/wavesurferPlugins/OpenEndedRegionPlugin";
import { drawPeaks, peakLevelsFor } from "@/lib/waveformPeaks";
import { onSchemeChange } from "@/lib/colorScheme";

export interface OverviewRegion {
  start: number;
  // An open-ended region runs to the next region's start.
  end?: number;
  review?: RegionReview;
  selected: boolean;
  hole: boolean;
}

export interface TimeRange {
  start: number;
  end: number;
}

interface Span {
  kind: string;
  style: Record<string, string>;
}

const PLAYER_EVENTS = ["timeupdate", "seeking", "loadstart", "loadeddata"];

export default defineComponent({
  props: {
    player: { type: Object as PropType<WebAudioPlayer>, required: true },
    buffer: { type: Object as PropType<AudioBuffer>, required: true },
    regions: { type: Array as PropType<OverviewRegion[]>, default: () => [] },
    view: { type: Object as PropType<TimeRange | null>, default: null },
    // The main waveform follows the playhead, so dragging the view box seeks.
    centered: { type: Boolean, default: false },
  },
  emits: ["scroll-to", "scroll-wheel"],
  data() {
    return {
      duration: 0,
      loading: true,
      _drag: null as { pointerId: number; mode: "seek" | "view"; offset: number } | null,
      _seekTime: 0,
      _seekFrame: 0,
      _resizeObserver: null as ResizeObserver | null,
      _unsubscribeScheme: null as (() => void) | null,
    };
  },
  computed: {
    spans(): Span[] {
      const { duration } = this;
      if (!duration) return [];
      const percent = (seconds: number) => `${(seconds / duration) * 100}%`;
      const sorted = [...this.regions].sort((a, b) => a.start - b.start);
      const plain: Span[] = [];
      const flagged: Span[] = [];
      sorted.forEach((region, index) => {
        const end = region.end ?? sorted[index + 1]?.start ?? duration;
        const style = {
          left: percent(region.start),
          width: percent(Math.max(0, end - region.start)),
        };
        if (region.review) {
          flagged.push({ kind: `is-flagged is-${region.review}`, style });
        } else {
          const kind = region.selected ? "is-selected" : region.hole ? "is-hole" : "";
          plain.push({ kind, style });
        }
      });
      // A flag is drawn over its neighbours, as it can be narrower than a pixel at song scale.
      return [...plain, ...flagged];
    },
    viewBox(): Record<string, string> | null {
      const { duration, view } = this;
      if (!duration || !view) return null;
      if (view.start <= 0 && view.end >= duration) return null;
      return {
        left: `${(view.start / duration) * 100}%`,
        width: `${((view.end - view.start) / duration) * 100}%`,
      };
    },
  },
  watch: {
    buffer() {
      this.sync();
      this.draw();
    },
  },
  mounted() {
    for (const type of PLAYER_EVENTS) this.player.addEventListener(type, this.sync);
    this._resizeObserver = new ResizeObserver(() => this.draw());
    this._resizeObserver.observe(this.$refs.strip as HTMLElement);
    this._unsubscribeScheme = onSchemeChange(() => this.$nextTick(this.draw));
    this.sync();
    this.draw();
  },
  beforeUnmount() {
    for (const type of PLAYER_EVENTS) this.player.removeEventListener(type, this.sync);
    this._resizeObserver?.disconnect();
    this._unsubscribeScheme?.();
    cancelAnimationFrame(this._seekFrame);
  },
  methods: {
    /**
     * Moves the playhead and the slider without re-rendering, as the time changes on every frame of
     * playback.
     */
    sync() {
      const { player } = this;
      const duration =
        Number.isFinite(player.duration) && player.duration > 0
          ? player.duration
          : this.buffer.duration;
      if (duration !== this.duration) this.duration = duration;
      if (player.loading !== this.loading) this.loading = player.loading;
      const time = player.currentTime;
      const playhead = this.$refs.playhead as HTMLElement;
      playhead.style.left = `${duration ? (time / duration) * 100 : 0}%`;
      const slider = this.$refs.slider as HTMLInputElement | undefined;
      if (slider) {
        // The value is clamped to the max, which may not be rendered yet.
        slider.max = String(duration);
        slider.value = String(time);
      }
    },
    onSliderInput(event: Event) {
      this.player.currentTime = parseFloat((event.target as HTMLInputElement).value);
    },
    draw() {
      const canvas = this.$refs.canvas as HTMLCanvasElement | undefined;
      if (!canvas) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * ratio);
      canvas.height = Math.round(canvas.clientHeight * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx || !canvas.width || !canvas.height) return;
      // The color comes from the stylesheet, so that it follows the color scheme.
      ctx.fillStyle = getComputedStyle(canvas).color;
      drawPeaks(ctx, peakLevelsFor(this.buffer), this.buffer.length);
    },
    timeAt(clientX: number): number {
      const rect = (this.$refs.strip as HTMLElement).getBoundingClientRect();
      if (!rect.width) return 0;
      const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return fraction * this.duration;
    },
    /**
     * Seeks on the next frame, as a drag sends more moves than the player can usefully seek to.
     */
    seek(time: number) {
      this._seekTime = Math.min(this.duration, Math.max(0, time));
      if (this._seekFrame) return;
      this._seekFrame = requestAnimationFrame(() => {
        this._seekFrame = 0;
        this.player.currentTime = this._seekTime;
      });
    },
    onPointerDown(event: PointerEvent) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (!this.duration) return;
      (this.$refs.strip as HTMLElement).setPointerCapture(event.pointerId);
      this.hideHover();
      const time = this.timeAt(event.clientX);
      const onBox = (event.target as HTMLElement).classList.contains("overview-view");
      if (onBox && !this.centered && this.view) {
        this._drag = { pointerId: event.pointerId, mode: "view", offset: time - this.view.start };
      } else {
        this._drag = { pointerId: event.pointerId, mode: "seek", offset: 0 };
        this.seek(time);
      }
    },
    onPointerMove(event: PointerEvent) {
      const drag = this._drag;
      if (!drag) {
        if (event.pointerType === "mouse") this.showHover(event.clientX);
        return;
      }
      if (drag.pointerId !== event.pointerId) return;
      const time = this.timeAt(event.clientX);
      if (drag.mode === "view") {
        this.$emit("scroll-to", Math.max(0, time - drag.offset));
      } else {
        this.seek(time);
      }
    },
    onPointerUp(event: PointerEvent) {
      if (this._drag?.pointerId !== event.pointerId) return;
      this._drag = null;
    },
    showHover(clientX: number) {
      const hover = this.$refs.hover as HTMLElement;
      const strip = this.$refs.strip as HTMLElement;
      const rect = strip.getBoundingClientRect();
      hover.textContent = formatTime(this.timeAt(clientX));
      hover.style.left = `${Math.min(rect.width, Math.max(0, clientX - rect.left))}px`;
      hover.hidden = false;
    },
    hideHover() {
      (this.$refs.hover as HTMLElement).hidden = true;
    },
  },
});

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}
</script>

<style scoped>
.overview-strip {
  position: relative;
  flex-grow: 1;
  min-width: 0;
  height: 28px;
  border-radius: 3px;
  background: var(--bulma-scheme-main);
  box-shadow: inset 0 0 0 1px var(--bulma-border-weak);
  cursor: pointer;
  touch-action: none;
  user-select: none;
}

.overview-strip:has(.transport-slider:focus-visible) {
  outline: 2px solid var(--bulma-primary);
  outline-offset: 1px;
}

.transport-slider {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.overview-wave {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  color: var(--bulma-text-weak);
}

.overview-regions {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.overview-region {
  position: absolute;
  top: 0;
  bottom: 0;
  min-width: 1px;
  background: var(--region-fill);
  opacity: 0.45;
}

.overview-region.is-hole {
  background: var(--region-fill-hole);
}

.overview-region.is-selected {
  background: var(--bulma-primary);
  opacity: 0.6;
}

.overview-region.is-flagged {
  min-width: 2px;
  opacity: 1;
}

.overview-region.is-lost {
  background: var(--region-review-lost);
}

.overview-region.is-moved {
  background: var(--region-review-moved);
}

.overview-region.is-doubtful {
  background: var(--region-review-doubtful);
}

.overview-view {
  position: absolute;
  top: 0;
  bottom: 0;
  min-width: 4px;
  border: 2px solid var(--bulma-text-strong);
  border-radius: 3px;
  cursor: grab;
}

.overview-view.is-centered {
  cursor: pointer;
}

.overview-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--bulma-link-on-scheme, #7957d5);
  pointer-events: none;
}

.overview-hover {
  position: absolute;
  bottom: calc(100% + 4px);
  transform: translateX(-50%);
  padding: 0 0.3em;
  border-radius: 3px;
  background: var(--bulma-text-strong);
  color: var(--bulma-scheme-main);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
  z-index: 1;
}
</style>
