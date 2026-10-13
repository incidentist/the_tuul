<template>
  <div
    ref="wavesurfer-container"
    :class="['wavesurfer-container', { 'hide-waveform': !showWaveform || spectrogram, centered }]"
    @wheel="onWheel"
    @touchstart="countFingers"
    @touchmove="blockPagePinch"
    @touchend="countFingers"
    @touchcancel="countFingers"
    @pointerdown.capture="onPointerDown"
    @pointermove.capture="onPointerMove"
    @pointerup.capture="onPointerUp"
    @pointercancel.capture="onPointerUp"
    @click.capture="onClickCapture"
  ></div>
</template>

<script lang="ts">
// A Vue wrapper for a WaveSurfer instance
import { defineComponent, markRaw, PropType, Raw } from "vue";
import WaveSurfer from "wavesurfer.js";
import type { GenericPlugin } from "wavesurfer.js/dist/base-plugin.js";
import RegionsPlugin, { Region, RegionParams } from "@/lib/wavesurferPlugins/OpenEndedRegionPlugin";
import DisplayBandsPlugin from "@/lib/wavesurferPlugins/DisplayBandsPlugin";
import MixPlugin, { MixFrame, MixGap } from "@/lib/wavesurferPlugins/MixPlugin";
import SpectrogramPlugin from "wavesurfer.js/dist/plugins/spectrogram.esm.js";
import createElement from "wavesurfer.js/dist/dom.js";
import { DisplayBand } from "@/lib/displayBands";
import { onSchemeChange } from "@/lib/colorScheme";
import { drawPeaks, peakLevelsFor } from "@/lib/waveformPeaks";

// The height while the container has none of its own, such as in a hidden tab.
const DEFAULT_HEIGHT = 300;

// How far a finger can slide and still count as a tap rather than a swipe.
const TAP_SLOP_PX = 10;

// What a scroll by one line is worth, for a mouse wheel that reports lines rather than pixels.
const LINE_HEIGHT_PX = 16;

// How long a swiped view goes on scrolling after the finger lifts.
const SWIPE_MOMENTUM_MS = 1500;

// How long the zoom and height have to stay put before the spectrogram is rebuilt for them.
const SPECTROGRAM_SETTLE_MS = 300;

type SpectrogramView = {
  key: string;
  rendering: "full" | "windowed";
  layer: HTMLElement;
  plugin: SpectrogramPlugin;
};

// A full render of the song, copied out of the plugin that drew it.
type SpectrogramOverview = {
  buffer: AudioBuffer;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
};

// WaveSurfer paints to a canvas, so custom properties have to be resolved to literal colors rather than inherited.
function schemeColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * A 256-step spectrogram color map from the page background through the primary color to the
 * strongest text color.
 */
function themeColorMap(): number[][] {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const rgb = (color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((v) => v / 255);
  };
  const stops = [
    rgb(schemeColor("--bulma-scheme-main", "#fff")),
    rgb(schemeColor("--bulma-primary", "#7957d5")),
    rgb(schemeColor("--bulma-text-strong", "#000")),
  ];
  return Array.from({ length: 256 }, (_, i) => {
    const t = (i / 255) * (stops.length - 1);
    const k = Math.min(Math.floor(t), stops.length - 2);
    const [from, to] = [stops[k], stops[k + 1]];
    // The entries stay opaque, as keepOverview() tells a drawn pixel from an empty one by its alpha.
    return [...from.map((v, c) => v + (to[c] - v) * (t - k)), 1];
  });
}

export default defineComponent({
  props: {
    audioData: {
      type: Blob,
      required: false,
    },
    cursorColor: {
      type: String,
      default: "pink",
    },
    cursorWidth: {
      type: Number,
      default: 1,
    },
    mediaControls: {
      type: Boolean,
      default: false,
    },
    // A percentage of the width that fits the whole track.
    zoom: {
      type: Number,
      default: 100,
    },
    regions: {
      type: Array as PropType<RegionParams[]>,
      default: () => [],
    },
    // Each line's display period, drawn in a lane under the waveform. Empty hides the lane.
    bands: {
      type: Array as PropType<DisplayBand[]>,
      default: () => [],
    },
    bandsEnabled: {
      type: Boolean,
      default: true,
    },
    // The gap restore plan. Empty hides it.
    mixFrames: {
      type: Array as PropType<MixFrame[]>,
      default: () => [],
    },
    mixGaps: {
      type: Array as PropType<MixGap[]>,
      default: () => [],
    },
    mixEnabled: {
      type: Boolean,
      default: true,
    },
    // This is where the view was scrolled to, in seconds. It is applied once, when the waveform
    // is laid out.
    initialScroll: {
      type: Number,
      default: 0,
    },
    waveColor: {
      type: String,
      required: false,
    },
    showWaveform: {
      type: Boolean,
      default: true,
    },
    // Draws a spectrogram in place of the waveform.
    spectrogram: {
      type: Boolean,
      default: false,
    },
    // Whether a click on a region selects it.
    selectable: {
      type: Boolean,
      default: true,
    },
    // The view follows the playhead in the middle, and can't be scrolled by hand.
    centered: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      wavesurfer: null as WaveSurfer | null,
      // Not reactive: Vue would hand back proxies of the regions the plugin holds,
      // and the raw instances its own events carry would no longer compare equal to them.
      regionsPlugin: markRaw(RegionsPlugin.create()),
      bandsPlugin: markRaw(DisplayBandsPlugin.create()),
      mixPlugin: markRaw(MixPlugin.create()),
      _shownSpectrogram: null as Raw<SpectrogramView> | null,
      // A rebuilt spectrogram that hasn't drawn anything yet, while the shown one stays up.
      _pendingSpectrogram: null as Raw<SpectrogramView> | null,
      // The 100% view, which also shows through wherever the windowed spectrogram hasn't drawn yet.
      _spectrogramOverview: null as Raw<SpectrogramOverview> | null,
      _spectrogramTimer: 0,
      _overviewFrame: 0,
      isVisible: false,
      _observer: null as IntersectionObserver | null,
      _resizeObserver: null as ResizeObserver | null,
      _heightObserver: null as ResizeObserver | null,
      _zoomAnchor: null as { time: number; cursorX: number } | null,
      _unsubscribeScheme: null as (() => void) | null,
      _savedScrollLeft: 0,
      _stopKeepingScroll: null as (() => void) | null,
      _scrubSeconds: 0,
      _scrubFrame: 0,
      // The fingers on a centered view, by pointer id, where each was last seen.
      _touches: new Map<number, { x: number; y: number }>(),
      // How far the finger has slid, to tell a swipe from a tap.
      _swipeDistance: 0,
      // The middle-button drag under way, and where the pointer was last seen.
      _pan: null as { pointerId: number; x: number } | null,
      _zoomRatio: 1,
      _zoomClientX: 0,
      _zoomFrame: 0,
      _initialScrollApplied: false,
      // Set when a drag/resize updates a region.
      // The drag has already moved the region's DOM to its final position, so when the resulting timings round-trip
      // back through the `regions` prop we skip the expensive teardown-and-rebuild of every region for that one update.
      _skipNextRegionsUpdate: false,
      // A time to scroll into view once the waveform is laid out, asked for while it was hidden.
      _pendingReveal: null as number | null,
      _fingers: 0,
      _fingersLiftedAt: -Infinity,
    };
  },
  mounted() {
    // Create an observer for the wavesurfer container
    this._observer = new IntersectionObserver(
      ([entry]) => {
        const wasVisible = this.isVisible;
        this.isVisible = entry.isIntersecting;

        // If becoming visible and we have regions, redraw them
        if (!wasVisible && this.isVisible) {
          // A hidden container has no scroll box, so a restore can only land once it is laid out.
          this.$nextTick(() => {
            this.applyInitialScroll();
            if (this._pendingReveal !== null) this.revealTime(this._pendingReveal);
            if (this.regions.length > 0) {
              this.updateRegions(this.regions);
            }
          });
        }
      },
      {
        threshold: 0,
      },
    );

    // Start observing the container
    this._observer.observe(this.$refs["wavesurfer-container"] as HTMLElement);

    // Hiding the container (display: none) drops its scroll box, so the browser resets the scroll offset.
    // Nothing re-asserts it while playback is paused, so do it whenever the container is laid out again.
    // The zoom is relative to the width, so it has to be converted again whenever that changes.
    this._resizeObserver = new ResizeObserver(() => {
      this.restoreScroll();
      this.applyZoom();
      if (this.centered) this.centerOn(this.wavesurfer?.getCurrentTime() ?? 0);
    });
    this._resizeObserver.observe(this.$refs["wavesurfer-container"] as HTMLElement);

    this.regionsPlugin.setSelectable(this.selectable);
    this.wavesurfer = WaveSurfer.create({
      container: this.$refs["wavesurfer-container"] as HTMLElement,
      cursorColor: this.cursorColor,
      cursorWidth: this.cursorWidth,
      mediaControls: this.mediaControls,
      ...this.schemeColors(),
      height: this.fittedHeight() || DEFAULT_HEIGHT,
      normalize: false,
      // The spectrogram goes up to half this rate, which takes in the consonants.
      sampleRate: 16000,
      // WaveSurfer's own renderer reads every sample a canvas covers, which on a phone takes
      // longer than a frame for each step of a pinch.
      renderFunction: (channels, ctx) => this.drawWaveform(channels, ctx),
      plugins: [
        this.regionsPlugin as unknown as GenericPlugin,
        this.bandsPlugin as unknown as GenericPlugin,
        this.mixPlugin as unknown as GenericPlugin,
      ],
    });
    if (this.audioData) this.wavesurfer.loadBlob(this.audioData);

    this.scrollElement()?.addEventListener("scroll", this.rememberScroll);

    // A horizontal scrollbar showing up or going away changes the room left for the waveform.
    this._heightObserver = new ResizeObserver(() => this.fitHeight());
    this._heightObserver.observe(this.$refs["wavesurfer-container"] as HTMLElement);
    this._heightObserver.observe(this.scrollElement()!, { box: "border-box" });

    this.wavesurfer.on("click", (x: number) => {
      const time = x * (this.wavesurfer?.getDuration() ?? 0);
      this.$emit("seeking", time);
    });

    this.wavesurfer.on("error", (err: Error) => {
      console.error("Wavesurfer error", err);
    });

    // Regions added before the audio is decoded have no duration to lay themselves out against,
    // and the plugin defers saving them until it has one, past the reach of clearRegions().
    // Landing straight on this tab (a #adjust deep link or reload) is the case that hits it.
    this.wavesurfer.on("ready", () => {
      this.$emit("decode", this.wavesurfer?.getDecodedData());
      this.updateRegions(this.regions);
      this.bandsPlugin.setBands(this.bands, this.bandsEnabled);
      this.updateMix();
      this.applyZoom();
      this.applyInitialScroll();
      this.updateSpectrogram();
    });

    this.bandsPlugin.on("bands-updated", (updates) => {
      this.$emit("bands-updated", updates);
    });
    this.bandsPlugin.on("band-reset", (segmentIndex, side) => {
      this.$emit("band-reset", segmentIndex, side);
    });
    this.mixPlugin.on("mute-updated", (frame, side, time) => {
      this.$emit("mute-updated", frame, side, time);
    });
    this.mixPlugin.on("mute-reset", (frame, side) => {
      this.$emit("mute-reset", frame, side);
    });

    this.regionsPlugin.on("region-updated", (region: Region) => {
      // The DOM is already at its final position.
      // Skip the rebuild triggered when these timings round-trip back through the `regions` prop.
      this._skipNextRegionsUpdate = true;
      this.$emit("region-updated", region);
    });

    this.regionsPlugin.on("region-clicked", (region: Region, event: MouseEvent) => {
      this.$emit("region-clicked", region, event);
    });

    this.regionsPlugin.on("selection-change", (ids: string[]) => {
      this.$emit("selection-change", ids);
    });

    this.regionsPlugin.on("regions-updated", (regions: Region[]) => {
      this._skipNextRegionsUpdate = true;
      this.$emit("regions-updated", regions);
    });

    this._unsubscribeScheme = onSchemeChange(this.applySchemeColors);
  },
  watch: {
    audioData(newAudioData: Blob) {
      if (this.wavesurfer) {
        console.log("loading new audio data", newAudioData);
        this.wavesurfer.loadBlob(newAudioData);
      }
    },
    zoom() {
      this.applyZoom();
    },
    spectrogram() {
      this.updateSpectrogram();
    },
    selectable(selectable: boolean) {
      this.regionsPlugin.setSelectable(selectable);
    },
    centered(centered: boolean) {
      if (centered) {
        this.centerOn(this.wavesurfer?.getCurrentTime() ?? 0);
      } else {
        const wrapper = this.wavesurfer?.getWrapper();
        if (wrapper) wrapper.style.transform = "";
      }
    },
    bands(bands: DisplayBand[]) {
      this.bandsPlugin.setBands(bands, this.bandsEnabled);
    },
    bandsEnabled(enabled: boolean) {
      this.bandsPlugin.setBands(this.bands, enabled);
    },
    mixFrames() {
      this.updateMix();
    },
    mixGaps() {
      this.updateMix();
    },
    mixEnabled() {
      this.updateMix();
    },
    regions: {
      handler: function (newRegions) {
        // A drag just moved this region in place, so the prop change is only the store value catching up.
        // The DOM is already correct, so skip the teardown-and-rebuild of every region for this one update.
        if (this._skipNextRegionsUpdate) {
          this._skipNextRegionsUpdate = false;
          // The drag already moved the region, so there is no new position left to apply.
          // It can also give an untimed segment a start, which changes the region color,
          // and nothing has repainted that yet.
          this.syncRegionAppearance(newRegions);
          return;
        }
        // Add regions after audio is decoded or they won't render right
        if (this.isReady()) {
          this.updateRegions(newRegions);
        }
      },
      deep: true,
    },
  },
  emits: [
    "seeking",
    "region-updated",
    "regions-updated",
    "region-clicked",
    "selection-change",
    "bands-updated",
    "band-reset",
    "mute-updated",
    "mute-reset",
    "zoom-change",
    "zoom-by",
    "scroll-change",
    // The stretch of the track in view, in seconds, whenever it scrolls or zooms.
    "view-change",
    // The view was scrolled, zoomed or scrubbed by hand, as opposed to following the playhead.
    "hand-move",
    "scrub",
    "decode",
  ],
  methods: {
    updateMix() {
      this.mixPlugin.setPlan(this.mixFrames, this.mixGaps, this.mixEnabled);
    },
    schemeColors() {
      return {
        waveColor: this.waveColor ?? schemeColor("--waveform-wave", "rgba(0, 0, 0, 0.1)"),
        progressColor: schemeColor("--bulma-link-on-scheme", "#7957d5"),
      };
    },
    applySchemeColors() {
      this.wavesurfer?.setOptions(this.schemeColors());
      this.resetSpectrogram();
    },
    onWheel(event: WheelEvent) {
      this.applyWheel(event, () => this.anchorZoomAt(event.clientX), this.centered);
    },
    /**
     * A wheel turned over the overview acts as one turned over the waveform, zooming around `time`.
     * The overview has no scroll of its own, so a sideways turn always pans.
     */
    wheelFromOverview(event: WheelEvent, time: number) {
      this.applyWheel(event, () => this.anchorZoomAtTime(time), true);
    },
    /**
     * Zoom for an upright turn, around the point `anchor` sets. Pan for a sideways one where
     * `pansSideways` or Shift says so, and leave it to the browser's own scroll otherwise.
     */
    applyWheel(event: WheelEvent, anchor: () => void, pansSideways: boolean) {
      this.$emit("hand-move");
      // Shift turns the wheel sideways. Some browsers report that as deltaX already, others don't.
      const sideways = event.shiftKey ? event.deltaX || event.deltaY : event.deltaX;
      if (sideways !== 0 && (pansSideways || event.shiftKey)) {
        event.preventDefault();
        const scrollEl = this.scrollElement();
        const pixels =
          event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? sideways * LINE_HEIGHT_PX
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? sideways * (scrollEl?.clientWidth ?? 0)
              : sideways;
        this.panBy(pixels);
      }
      if (event.shiftKey || event.deltaY === 0) return;
      event.preventDefault();
      anchor();
      // Scrolling up zooms in, matching maps and image viewers.
      this.$emit("zoom-change", -Math.sign(event.deltaY));
    },
    /**
     * Move the view `pixels` later in the track. A centered view can't be scrolled by hand, so the
     * playhead moves instead.
     */
    panBy(pixels: number) {
      if (this.centered) {
        this.queueScrub(pixels);
        return;
      }
      const scrollEl = this.scrollElement();
      if (scrollEl) scrollEl.scrollLeft += pixels;
    },
    /**
     * Fingers are counted before anything on the waveform sees them, as a region's handles stop
     * their pointerdown, which would hide a finger on one from a pinch.
     */
    onPointerDown(event: PointerEvent) {
      this.onPanStart(event);
      this.onTouchStart(event);
    },
    onPointerMove(event: PointerEvent) {
      this.onPanMove(event);
      this.onTouchMove(event);
    },
    onPointerUp(event: PointerEvent) {
      this.onPanEnd(event);
      this.onTouchEnd(event);
    },
    /**
     * A middle-button press starts dragging the waveform sideways.
     */
    onPanStart(event: PointerEvent) {
      if (event.pointerType !== "mouse" || event.button !== 1) return;
      // This also keeps the browser from starting its own autoscroll.
      event.preventDefault();
      (this.$refs["wavesurfer-container"] as HTMLElement).setPointerCapture(event.pointerId);
      this._pan = { pointerId: event.pointerId, x: event.clientX };
    },
    onPanMove(event: PointerEvent) {
      if (this._pan?.pointerId !== event.pointerId) return;
      this.$emit("hand-move");
      // The waveform follows the pointer, so dragging to the right goes back in time.
      this.panBy(this._pan.x - event.clientX);
      this._pan.x = event.clientX;
    },
    onPanEnd(event: PointerEvent) {
      if (this._pan?.pointerId === event.pointerId) this._pan = null;
    },
    /**
     * Add a sideways scroll of `pixels` to the distance the playhead moves on the next frame. A
     * trackpad or a finger sends dozens of these a second, and seeking the audio on each one would
     * make it stutter.
     */
    queueScrub(pixels: number) {
      const wrapper = this.wavesurfer?.getWrapper();
      const duration = this.wavesurfer?.getDuration() ?? 0;
      if (!wrapper || !duration) return;
      this._scrubSeconds += (pixels / wrapper.getBoundingClientRect().width) * duration;
      if (this._scrubFrame) return;
      this._scrubFrame = requestAnimationFrame(() => {
        this._scrubFrame = 0;
        const seconds = this._scrubSeconds;
        this._scrubSeconds = 0;
        if (!seconds) return;
        this.$emit("scrub", seconds);
        this.$emit("hand-move");
      });
    },
    /**
     * Keep the point under `clientX` where it is on screen through the next zoom.
     */
    anchorZoomAt(clientX: number) {
      const scrollEl = this.scrollElement();
      if (!scrollEl) return;
      const cursorX = clientX - scrollEl.getBoundingClientRect().left;
      const time = (scrollEl.scrollLeft + cursorX) / this.pixelsPerSecond(scrollEl);
      this._zoomAnchor = { time, cursorX };
    },
    /**
     * Keep `time` where it is on screen through the next zoom. A time out of view is held at the
     * nearest edge instead, so that the view doesn't jump to it.
     */
    anchorZoomAtTime(time: number) {
      const scrollEl = this.scrollElement();
      const range = this.visibleTimeRange();
      if (!scrollEl || !range) return;
      const anchor = Math.min(range.end, Math.max(range.start, time));
      this._zoomAnchor = {
        time: anchor,
        cursorX: anchor * this.pixelsPerSecond(scrollEl) - scrollEl.scrollLeft,
      };
    },
    /**
     * Two fingers pinch to zoom. On a centered view, which can't be scrolled by hand, one finger
     * swipes the playhead along. Elsewhere the browser scrolls under it.
     */
    onTouchStart(event: PointerEvent) {
      if (event.pointerType !== "touch") return;
      if (this._touches.size === 0) this._swipeDistance = 0;
      this._touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    },
    onTouchMove(event: PointerEvent) {
      const last = this._touches.get(event.pointerId);
      if (!last) return;
      if (this._touches.size === 1 && this.centered) {
        const dx = event.clientX - last.x;
        this._swipeDistance += Math.abs(dx);
        // The waveform follows the finger, so a swipe to the right goes back in time.
        if (this._swipeDistance > TAP_SLOP_PX) this.queueScrub(-dx);
      } else if (this._touches.size === 2) {
        const before = this.touchSpread();
        this._touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const after = this.touchSpread();
        this._swipeDistance = Infinity;
        if (before > 0) this.queueZoom(after / before, this.touchMidpointX());
        return;
      }
      this._touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    },
    onTouchEnd(event: PointerEvent) {
      this._touches.delete(event.pointerId);
    },
    /**
     * The browser's own scrolling takes over a swipe and cancels its pointer events, so the touch
     * events tell a swipe's scroll from the app's.
     */
    countFingers(event: TouchEvent) {
      this._fingers = event.touches.length;
      if (!this._fingers) this._fingersLiftedAt = performance.now();
    },
    /**
     * The scrolls that follow are the app's own, even if a swipe has only just ended.
     */
    endSwipeMomentum() {
      this._fingersLiftedAt = -Infinity;
    },
    /**
     * Keeps the browser from zooming the page under a pinch, which zooms the waveform instead.
     * Firefox for Android ignores the touch-action that says so.
     */
    blockPagePinch(event: TouchEvent) {
      if (event.touches.length > 1) event.preventDefault();
    },
    /**
     * A tap on the waveform seeks, and one on a region picks it, but not at the end of a swipe or a
     * pinch.
     */
    onClickCapture(event: MouseEvent) {
      if (this._swipeDistance > TAP_SLOP_PX) {
        event.stopPropagation();
        event.preventDefault();
        this._swipeDistance = 0;
      }
    },
    touchSpread(): number {
      const [a, b] = [...this._touches.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    },
    touchMidpointX(): number {
      const [a, b] = [...this._touches.values()];
      return (a.x + b.x) / 2;
    },
    /**
     * Gather a pinch's zoom until the next frame, as a scrub is. A view that isn't centered zooms
     * around `clientX`, the point between the fingers.
     */
    queueZoom(ratio: number, clientX: number) {
      this._zoomRatio *= ratio;
      this._zoomClientX = clientX;
      if (this._zoomFrame) return;
      this._zoomFrame = requestAnimationFrame(() => {
        this._zoomFrame = 0;
        const zoomRatio = this._zoomRatio;
        this._zoomRatio = 1;
        if (zoomRatio === 1) return;
        // Set at the last moment, as an anchor taken while a zoom is still being applied would mix
        // the old scroll position with the new scale.
        if (!this.centered) this.anchorZoomAt(this._zoomClientX);
        this.$emit("zoom-by", zoomRatio);
        this.$emit("hand-move");
      });
    },
    drawWaveform(channels: Array<Float32Array | number[]>, ctx: CanvasRenderingContext2D) {
      const decoded = this.wavesurfer?.getDecodedData();
      if (!decoded) return;
      // The wrapper's inline width, as reading its layout here would force a reflow per canvas.
      // It is "100%" while the waveform fits the view.
      const wrapperWidth = this.wavesurfer!.getWrapper().style.width;
      const totalWidth = wrapperWidth.endsWith("px") ? parseFloat(wrapperWidth) : undefined;
      drawPeaks(ctx, peakLevelsFor(decoded), channels[0]?.length ?? 0, totalWidth);
    },
    pixelsPerSecond(scrollEl: HTMLElement): number {
      return scrollEl.scrollWidth / (this.wavesurfer?.getDuration() || 1);
    },
    /**
     * Converts the zoom percentage into the pixels per second WaveSurfer takes, for the current
     * width.
     */
    applyZoom() {
      const scrollEl = this.scrollElement();
      const duration = this.wavesurfer?.getDuration() ?? 0;
      if (!this.wavesurfer || !this.isReady() || !scrollEl?.clientWidth || !duration) return;
      // The spectrogram plugin reads 0 as 50 px/s, so 100% needs a real rate. WaveSurfer rounds the
      // width up, so half a pixel short of the fit fills the view without overflowing it.
      const pxPerSec =
        this.zoom <= 100
          ? (scrollEl.clientWidth - 0.5) / duration
          : ((this.zoom / 100) * scrollEl.clientWidth) / duration;
      if (pxPerSec === this.wavesurfer.options.minPxPerSec) {
        this._zoomAnchor = null;
        return;
      }
      this.wavesurfer.zoom(pxPerSec);
      this.scheduleSpectrogramUpdate();
      this.$nextTick(() => {
        if (this.centered) {
          this._zoomAnchor = null;
          this.centerOn(this.wavesurfer?.getCurrentTime() ?? 0);
        } else if (this._zoomAnchor) {
          scrollEl.scrollLeft =
            this._zoomAnchor.time * this.pixelsPerSecond(scrollEl) - this._zoomAnchor.cursorX;
          this._zoomAnchor = null;
        }
        scrollEl.dispatchEvent(new Event("scroll"));
      });
    },
    play() {
      if (this.wavesurfer) {
        this.wavesurfer.play();
      }
    },
    pause() {
      if (this.wavesurfer) {
        this.wavesurfer.pause();
      }
    },
    /**
     * Keep the playhead where it is on screen through the next zoom, or the middle of the view
     * when the playhead is out of it.
     */
    anchorZoomOnPlayhead() {
      const scrollEl = this.scrollElement();
      const range = this.visibleTimeRange();
      if (!scrollEl || !range) return;
      const playhead = this.wavesurfer?.getCurrentTime() ?? 0;
      const time =
        playhead >= range.start && playhead <= range.end ? playhead : (range.start + range.end) / 2;
      this._zoomAnchor = {
        time,
        cursorX: time * this.pixelsPerSecond(scrollEl) - scrollEl.scrollLeft,
      };
    },
    // The stretch of the track currently scrolled into view, in seconds.
    visibleTimeRange(): { start: number; end: number } | null {
      const scrollEl = this.scrollElement();
      const duration = this.wavesurfer?.getDuration() ?? 0;
      if (!scrollEl?.scrollWidth || !duration) return null;
      const { scrollWidth, scrollLeft, clientWidth } = scrollEl;
      const pxPerSec = scrollWidth / duration;
      const endPx = Math.min(scrollWidth, scrollLeft + clientWidth);
      // A playhead landing outside the viewport makes wavesurfer re-center the waveform, and on an
      // exact edge float rounding decides that either way. Both ends are held a half pixel inside,
      // except where the viewport is against the track's own end and the arithmetic is exact.
      return {
        start: scrollLeft <= 0 ? 0 : (scrollLeft + 0.5) / pxPerSec,
        end: endPx >= scrollWidth ? duration : (endPx - 0.5) / pxPerSec,
      };
    },
    clearSelection() {
      this.regionsPlugin.clearSelection();
      this.bandsPlugin.clearSelection();
    },
    /**
     * Select a region alone, and scroll its start into view if it is outside.
     */
    selectRegion(id: string, start: number) {
      this.regionsPlugin.selectRegion(id);
      this.revealTime(start);
    },
    /**
     * Scroll so that `time` sits in the middle of the view, unless it is in view already.
     */
    revealTime(time: number) {
      const scrollEl = this.scrollElement();
      const duration = this.wavesurfer?.getDuration() ?? 0;
      if (!this.isVisible || !scrollEl?.clientWidth || !duration) {
        this._pendingReveal = time;
        return;
      }
      this._pendingReveal = null;
      const range = this.visibleTimeRange();
      if (range && time >= range.start && time <= range.end) return;
      scrollEl.scrollLeft = (time / duration) * scrollEl.scrollWidth - scrollEl.clientWidth / 2;
      // The resize that follows a tab switch restores the saved offset, which has to be this one.
      this._savedScrollLeft = scrollEl.scrollLeft;
    },
    /**
     * Scroll so that `time` sits in the middle of the view.
     *
     * Near either end of the track the scroll runs out, and the waveform itself is shifted instead,
     * leaving blank space beside it. The shift also makes up for the scroll position being rounded,
     * so the waveform moves by fractions of a pixel.
     */
    centerOn(time: number) {
      const scrollEl = this.scrollElement();
      const wrapper = this.wavesurfer?.getWrapper();
      const duration = this.wavesurfer?.getDuration() ?? 0;
      if (!scrollEl || !wrapper || !duration || !scrollEl.clientWidth) return;
      const width = wrapper.getBoundingClientRect().width;
      const target = (time / duration) * width - scrollEl.clientWidth / 2;
      scrollEl.scrollLeft = Math.max(0, Math.min(width - scrollEl.clientWidth, target));
      const shift = scrollEl.scrollLeft - target;
      wrapper.style.transform = shift ? `translateX(${shift}px)` : "";
    },
    growRegion(id: string, end: number) {
      this.regionsPlugin
        .getRegions()
        .find((region) => region.id === id)
        ?.growTo(end);
    },
    /**
     * Move the cursor to `time`. Wavesurfer scrolls a cursor that lands out of view back into it,
     * unless `keepScroll` is set.
     */
    setTime(time: number, keepScroll = false) {
      if (!this.wavesurfer) return;
      this.endSwipeMomentum();
      this._stopKeepingScroll?.();
      this._stopKeepingScroll = null;
      this.wavesurfer.setTime(time);
      if (!keepScroll) return;
      this.restoreScroll();
      // The seek's own timeupdate scrolls the cursor into view a second time.
      this._stopKeepingScroll = this.wavesurfer.once("timeupdate", () => this.restoreScroll());
    },
    isReady() {
      return this.wavesurfer && this.wavesurfer.getDecodedData();
    },
    /**
     * The waveform height that fills the container, less the horizontal scrollbar under it.
     * It is 0 while the container has no height of its own.
     */
    fittedHeight(): number {
      const container = this.$refs["wavesurfer-container"] as HTMLElement;
      const scrollEl = this.scrollElement();
      const scrollbar = scrollEl ? scrollEl.offsetHeight - scrollEl.clientHeight : 0;
      return Math.max(0, container.clientHeight - scrollbar);
    },
    fitHeight() {
      const height = this.fittedHeight();
      if (this.wavesurfer && height > 0 && height !== this.wavesurfer.options.height) {
        this.wavesurfer.setOptions({ height });
        this.scheduleSpectrogramUpdate();
      }
    },
    scheduleSpectrogramUpdate() {
      // A full render under way is sized for the old zoom or height, and would redo the whole song
      // at the new one.
      if (this._pendingSpectrogram?.rendering === "full") {
        this.dropSpectrogram(this._pendingSpectrogram);
        this._pendingSpectrogram = null;
      }
      clearTimeout(this._spectrogramTimer);
      this._spectrogramTimer = window.setTimeout(this.updateSpectrogram, SPECTROGRAM_SETTLE_MS);
    },
    /**
     * Shows, hides or rebuilds the spectrogram to follow the `spectrogram` prop, the zoom and the
     * height. The plugin has a fixed height, and computes each stretch of the song only once, at the
     * zoom it is first seen at, so it takes a new plugin to follow either.
     */
    updateSpectrogram() {
      clearTimeout(this._spectrogramTimer);
      const buffer = this.wavesurfer?.getDecodedData();
      const overview = this._spectrogramOverview;
      if (overview) overview.canvas.style.display = this.spectrogram ? "" : "none";
      if (!this.wavesurfer || !this.spectrogram) {
        this.dropSpectrogramViews();
        return;
      }
      const scrollEl = this.scrollElement();
      if (!buffer || !scrollEl) return;
      if (overview && overview.buffer !== buffer) {
        overview.canvas.remove();
        this._spectrogramOverview = null;
      }
      const height = this.wavesurfer.options.height as number;
      const overviewFits =
        this._spectrogramOverview?.width === scrollEl.clientWidth &&
        this._spectrogramOverview.height === height;
      // Windowed rendering takes the view to be at most 80% of the window wide while it doesn't
      // scroll, which leaves the end of the song blank. The whole song is cheap at that width.
      const rendering = this.zoom > 100 ? "windowed" : overviewFits ? null : "full";
      if (!rendering) {
        this.dropSpectrogramViews();
        return;
      }
      const key = `${rendering}:${height}:${this.wavesurfer.options.minPxPerSec}`;
      if ((this._pendingSpectrogram ?? this._shownSpectrogram)?.key === key) return;
      this.dropSpectrogram(this._pendingSpectrogram);
      this._pendingSpectrogram = null;
      if (this._shownSpectrogram?.key === key) return;
      // The layer has its own stacking context, so the plugin's z-indexes can't lift its canvases
      // above the regions.
      const layer = createElement(
        "div",
        {
          part: "spectrogram",
          style: {
            position: "absolute",
            top: "0",
            left: "0",
            width: "100%",
            height: `${height}px`,
            zIndex: "1",
            pointerEvents: "none",
          },
        },
        this.wavesurfer.getWrapper(),
      );
      const plugin = SpectrogramPlugin.create({
        container: layer,
        rendering,
        height,
        fftSamples: 1024,
        scale: "mel",
        colorMap: themeColorMap(),
        useWebWorker: true,
      });
      const view = markRaw<SpectrogramView>({ key, rendering, layer, plugin });
      this._pendingSpectrogram = view;
      if (rendering === "full") {
        plugin.once("ready", () => this.keepOverview(view, buffer));
        plugin.once("error", () => {
          if (this._pendingSpectrogram !== view) return;
          this.dropSpectrogram(view);
          this._pendingSpectrogram = null;
        });
      } else {
        // Windowed rendering is ready before it has drawn anything, and reports progress once it has.
        const swap = () => {
          if (this._pendingSpectrogram !== view) return;
          this.dropSpectrogram(this._shownSpectrogram);
          this._shownSpectrogram = view;
          this._pendingSpectrogram = null;
        };
        plugin.once("progress", swap);
        plugin.once("error", swap);
      }
      this.wavesurfer.registerPlugin(plugin);
    },
    /**
     * Copies a full render into the overview and drops the plugin that drew it. The plugin is ready
     * before its bitmaps are drawn, so this waits until every canvas has pixels.
     */
    keepOverview(view: SpectrogramView, buffer: AudioBuffer) {
      cancelAnimationFrame(this._overviewFrame);
      if (this._pendingSpectrogram !== view || !this.wavesurfer) return;
      const sources = [...view.layer.querySelectorAll("canvas")];
      // The color map is opaque, so a drawn pixel is never transparent.
      const isDrawn = (c: HTMLCanvasElement) =>
        c.getContext("2d")!.getImageData(0, c.height - 1, 1, 1).data[3] > 0;
      if (sources.length === 0 || !sources.every(isDrawn)) {
        this._overviewFrame = requestAnimationFrame(() => this.keepOverview(view, buffer));
        return;
      }
      const canvas =
        this._spectrogramOverview?.canvas ??
        (createElement(
          "canvas",
          {
            part: "spectrogram-overview",
            style: {
              position: "absolute",
              top: "0",
              left: "0",
              width: "100%",
              height: "100%",
              zIndex: "0",
              pointerEvents: "none",
              // WaveSurfer pixelates every canvas, which would turn the overview into blocks once
              // zoomed in.
              imageRendering: "auto",
            },
          },
          this.wavesurfer.getWrapper(),
        ) as HTMLCanvasElement);
      const pixelRatio = sources[0].width / sources[0].offsetWidth;
      canvas.width = Math.round(view.layer.offsetWidth * pixelRatio);
      canvas.height = sources[0].height;
      const ctx = canvas.getContext("2d")!;
      for (const source of sources) {
        ctx.drawImage(source, Math.round(source.offsetLeft * pixelRatio), 0);
      }
      this._spectrogramOverview = markRaw({
        buffer,
        width: view.layer.offsetWidth,
        height: sources[0].offsetHeight,
        canvas,
      });
      this.dropSpectrogramViews();
    },
    /**
     * Throws away every spectrogram render, as their colors are baked into the pixels, and draws
     * the spectrogram again.
     */
    resetSpectrogram() {
      this._spectrogramOverview?.canvas.remove();
      this._spectrogramOverview = null;
      this.dropSpectrogramViews();
      this.updateSpectrogram();
    },
    dropSpectrogramViews() {
      this.dropSpectrogram(this._pendingSpectrogram);
      this.dropSpectrogram(this._shownSpectrogram);
      this._pendingSpectrogram = null;
      this._shownSpectrogram = null;
    },
    dropSpectrogram(view: SpectrogramView | null) {
      if (!view) return;
      this.wavesurfer?.unregisterPlugin(view.plugin);
      view.layer.remove();
    },
    scrollElement(): HTMLElement | null {
      return (this.wavesurfer?.getWrapper()?.parentElement as HTMLElement) ?? null;
    },
    rememberScroll() {
      const scrollEl = this.scrollElement();
      // While the container is hidden it has no scroll box, and the offset the browser reports is a meaningless zero.
      if (!scrollEl || scrollEl.clientWidth === 0) return;
      this._savedScrollLeft = scrollEl.scrollLeft;
      const start = this.scrollSeconds(scrollEl);
      if (start !== null) this.$emit("scroll-change", start);
      const range = this.visibleTimeRange();
      if (range) this.$emit("view-change", range);
      if (this._fingers || performance.now() - this._fingersLiftedAt < SWIPE_MOMENTUM_MS) {
        this.$emit("hand-move");
      }
    },
    /**
     * Scroll so that the view starts at `time`. A centered view stays on the playhead.
     */
    scrollToTime(time: number) {
      const scrollEl = this.scrollElement();
      const duration = this.wavesurfer?.getDuration() ?? 0;
      if (this.centered || !scrollEl?.scrollWidth || !duration) return;
      this.endSwipeMomentum();
      scrollEl.scrollLeft = (time / duration) * scrollEl.scrollWidth;
    },
    /**
     * The left edge of the view in seconds, which survives a zoom change as a pixel offset would not.
     */
    scrollSeconds(scrollEl: HTMLElement): number | null {
      const duration = this.wavesurfer?.getDuration() ?? 0;
      if (!scrollEl.scrollWidth || !duration) return null;
      return (scrollEl.scrollLeft / scrollEl.scrollWidth) * duration;
    },
    applyInitialScroll() {
      if (this._initialScrollApplied || !this.initialScroll) return;
      const scrollEl = this.scrollElement();
      const duration = this.wavesurfer?.getDuration() ?? 0;
      if (!scrollEl || !scrollEl.scrollWidth || !scrollEl.clientWidth || !duration) return;
      this._initialScrollApplied = true;
      this._savedScrollLeft = (this.initialScroll / duration) * scrollEl.scrollWidth;
      scrollEl.scrollLeft = this._savedScrollLeft;
    },
    restoreScroll() {
      const scrollEl = this.scrollElement();
      if (!scrollEl || scrollEl.clientWidth === 0) return;
      scrollEl.scrollLeft = this._savedScrollLeft;
    },
    /**
     * Color and the review flag are the only things a drag can change besides position.
     * A drag can't alter the text, and no other region's fill depends on where this one landed.
     */
    syncRegionAppearance(regions: RegionParams[]) {
      const live = new Map(this.regionsPlugin.getRegions().map((region) => [region.id, region]));
      for (const params of regions) {
        const region = params.id ? live.get(params.id) : undefined;
        if (region && params.color && params.color !== region.color) {
          region.setOptions({ color: params.color });
        }
        if (region && params.review !== region.review) {
          region.setReview(params.review);
        }
      }
    },
    updateRegions(regions: RegionParams[]) {
      if (!this.wavesurfer || !this.isVisible || !this.isReady()) return;
      this.regionsPlugin.syncRegions(regions);
    },
  },
  beforeUnmount() {
    cancelAnimationFrame(this._scrubFrame);
    cancelAnimationFrame(this._zoomFrame);
    clearTimeout(this._spectrogramTimer);
    cancelAnimationFrame(this._overviewFrame);
    this._observer?.disconnect();
    this._resizeObserver?.disconnect();
    this._heightObserver?.disconnect();
    this._unsubscribeScheme?.();
    this.scrollElement()?.removeEventListener("scroll", this.rememberScroll);
    if (this.wavesurfer) {
      this.wavesurfer.destroy();
    }
  },
});
</script>

<style>
.wavesurfer-container.centered ::part(scroll) {
  overflow-x: hidden;
}

/* A pinch zooms the waveform, not the page. */
.wavesurfer-container {
  touch-action: pan-x pan-y;
}

/* A centered view can't be scrolled, so a swipe moves the playhead instead. */
.wavesurfer-container.centered {
  touch-action: none;
}

/* A region's label overlay covers anything drawn on the region itself,
so the hover border and tint are a layer above the labels. */
.wavesurfer-container ::part(region):hover::after {
  content: "";
  position: absolute;
  inset: 0;
  border: 1px solid var(--bulma-primary);
  border-radius: inherit;
  background: color-mix(in srgb, var(--bulma-primary) 25%, transparent);
  z-index: 2;
  pointer-events: none;
}

.wavesurfer-container.hide-waveform ::part(canvases),
.wavesurfer-container.hide-waveform ::part(progress) {
  visibility: hidden;
}
</style>
