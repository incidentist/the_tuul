<template>
  <div class="video-container">
    <img
      v-if="backgroundKind === 'image'"
      class="background"
      :style="backgroundStyle"
      :src="backgroundUrl"
      alt=""
    />
    <video
      v-else-if="backgroundKind === 'video'"
      class="background"
      :style="backgroundStyle"
      ref="video"
      :src="backgroundUrl"
      muted
      loop
      playsinline
    />
    <!-- The renderer's canvas goes in here, created and removed outside Vue. -->
    <div
      ref="canvasHost"
      class="subtitle-layer"
      :style="{
        backgroundColor: background ? 'transparent' : backgroundColor,
      }"
    />
  </div>
</template>

<script lang="ts">
/* A component that displays an .ass file */

import { throttle, isEqual } from "lodash-es";
import { defineComponent, markRaw, PropType } from "vue";
import JASSUB from "jassub";
import { SUBTITLE_CANVAS } from "@/constants";
import { syncBackgroundVideo } from "@/lib/backgroundVideo";
import { BackgroundKind, backgroundKind } from "@/lib/background";
import { BUNDLED_FONTS, fontFamiliesIn } from "@/lib/fonts";
import type { BackgroundFit } from "@/lib/timing";
import { useFallbackFontsStore } from "@/stores/fallbackFonts";

// Minimal valid ASS file, used when there are no subtitles yet (e.g. the
// preview is shown before timings exist).
const EMPTY_ASS = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

// libass draws in this font when a style or `\fn` names a font it wasn't given.
const DEFAULT_FONT = "Liberation Sans";

// libass matches family names case-insensitively, so fonts are tracked by lowercase family.
const BUNDLED_FAMILIES = new Map(
  (Object.keys(BUNDLED_FONTS) as (keyof typeof BUNDLED_FONTS)[]).map((family) => [
    family.toLowerCase(),
    family,
  ]),
);

// A font file the renderer has been given.
interface LoadedFont {
  url: string;
  // Settles once the renderer holds the font.
  loaded: Promise<unknown>;
}

export default defineComponent({
  props: {
    subtitles: {
      type: String,
      required: true,
    },
    // Font URLs by family name. Only the families the subtitles name are loaded.
    fonts: {
      type: Object as PropType<Record<string, string>>,
      default: () => ({}),
    },
    backgroundColor: {
      type: String,
      default: "#000000",
    },
    backgroundFit: {
      type: String as PropType<BackgroundFit>,
      default: "fill",
    },
    // An image or a video.
    background: {
      type: Blob,
      required: false,
    },
    // Needed to display video properly
    audioDelay: {
      type: Number,
      default: 0.0,
    },
    videoOffset: {
      type: Number,
      default: 0.0,
    },
  },
  data() {
    return {
      currentTime: 0,
      isPlaying: false,
      // The display stays mounted when its tab is hidden, but the subtitles keep changing (every
      // timing tap regenerates them). While hidden we only remember the latest version and hand it to
      // the renderer when the display becomes visible again. Nothing here is rendered, hence markRaw.
      view: markRaw({
        isDisplayed: true,
        pendingSubtitles: null as string | null,
        visibilityObserver: null as IntersectionObserver | null,
        renderer: null as JASSUB | null,
        loadedFonts: new Map<string, LoadedFont>(),
        // The latest track asked for. An older one still waiting on its fonts is then dropped.
        track: "",
        // The track the renderer holds.
        rendererTrack: "",
      }),
    };
  },
  computed: {
    // The background color fills the bars and shows through a transparent image, as in the render.
    backgroundStyle(): Record<string, string> {
      return {
        backgroundColor: this.backgroundColor,
        ...(this.backgroundFit === "fit" ? { objectFit: "contain" } : {}),
      };
    },
    backgroundKind(): BackgroundKind | null {
      return this.background ? backgroundKind(this.background) : null;
    },
    backgroundUrl() {
      if (this.background) {
        return URL.createObjectURL(this.background);
      }
      return undefined;
    },
    effectiveSubtitles(): string {
      return this.subtitles || EMPTY_ASS;
    },
  },
  created() {
    // Scrubbing seeks the video, and Chrome stutters when it seeks more often than this.
    this.syncVideo = throttle(this.syncVideo, 1000 / 15);
  },
  mounted() {
    this.createRenderer(this.effectiveSubtitles);
    this.view.visibilityObserver = new IntersectionObserver((entries) => {
      this.view.isDisplayed = entries[entries.length - 1].isIntersecting;
      if (this.view.isDisplayed && this.view.pendingSubtitles !== null) {
        this.setTrack(this.view.pendingSubtitles);
        this.view.pendingSubtitles = null;
      }
    });
    this.view.visibilityObserver.observe(this.$el);
  },
  beforeUnmount() {
    this.view.visibilityObserver?.disconnect();
    this.destroyRenderer();
  },
  watch: {
    effectiveSubtitles(newSubs: string) {
      if (!this.view.isDisplayed) {
        this.view.pendingSubtitles = newSubs;
        return;
      }
      this.setTrack(newSubs);
    },
    currentTime() {
      this.render();
    },
    // A paused video would otherwise keep showing the frame from before the change.
    videoOffset() {
      this.syncVideo(this.currentTime);
    },
    fonts(newFonts, oldFonts) {
      if (isEqual(newFonts, oldFonts)) {
        return;
      }
      this.setTrack(this.view.track);
    },
  },
  methods: {
    /**
     * The font URLs a track needs, by lowercase family name.
     */
    fontsFor(subtitles: string): Map<string, string> {
      const urls = new Map(
        Object.entries({ [DEFAULT_FONT]: BUNDLED_FONTS[DEFAULT_FONT], ...this.fonts }).map(
          ([family, url]) => [family.toLowerCase(), url],
        ),
      );
      const needed = new Map<string, string>();
      for (const family of [DEFAULT_FONT, ...fontFamiliesIn(subtitles)]) {
        const url = urls.get(family.toLowerCase());
        if (url) {
          needed.set(family.toLowerCase(), url);
        }
      }
      return needed;
    },
    /**
     * True when a family the renderer holds now comes from another file.
     * The renderer can't drop a font, so it has to be replaced.
     */
    hasReplacedFont(fonts: Map<string, string>): boolean {
      const inMemory = useFallbackFontsStore().fontUrls;
      return [...fonts].some(([family, url]) => {
        const loaded = this.view.loadedFonts.get(family);
        const bundled = BUNDLED_FAMILIES.get(family);
        // A bundled font moves to an in-memory copy of the same file once it has been downloaded.
        const sameFile =
          bundled !== undefined &&
          loaded?.url === BUNDLED_FONTS[bundled] &&
          url === inMemory[bundled];
        return loaded !== undefined && loaded.url !== url && !sameFile;
      });
    },
    /**
     * Where to read a font file from, or a promise of it while it is being downloaded.
     * A bundled font that fallbackFontsStore is downloading is read from its in-memory copy,
     * so that the file is downloaded once.
     */
    fontSource(family: string, url: string): string | Promise<string> {
      const bundled = BUNDLED_FAMILIES.get(family);
      const inMemory =
        bundled && url === BUNDLED_FONTS[bundled]
          ? useFallbackFontsStore().inMemoryUrl(bundled)
          : undefined;
      return inMemory ? inMemory.then((inMemoryUrl) => inMemoryUrl ?? url) : url;
    },
    /**
     * Give the renderer a font, recording it so that it is given once.
     */
    addFont(renderer: JASSUB, family: string, url: string): Promise<unknown> {
      const loaded = Promise.all([renderer.ready, this.fontSource(family, url)]).then(
        ([, source]) => renderer.renderer.addFonts([source]),
      );
      this.view.loadedFonts.set(family, { url, loaded });
      return loaded;
    },
    createRenderer(subtitles: string) {
      const canvas = document.createElement("canvas");
      canvas.className = "subtitle-canvas";
      (this.$refs.canvasHost as HTMLElement).appendChild(canvas);
      const fonts = [...this.fontsFor(subtitles)];
      const ready = fonts.filter(
        ([family, url]) => typeof this.fontSource(family, url) === "string",
      );
      const renderer = new JASSUB({
        canvas,
        subContent: subtitles,
        fonts: ready.map(([, url]) => url),
        defaultFont: DEFAULT_FONT,
        // Lazy lookups strip weight words from family names and don't redraw once a font arrives,
        // so every font is given explicitly.
        availableFonts: {},
        queryFonts: false,
      });
      this.view.renderer = renderer;
      this.view.loadedFonts = new Map(
        ready.map(([family, url]) => [family, { url, loaded: renderer.ready }]),
      );
      this.view.track = subtitles;
      this.view.rendererTrack = subtitles;
      this.render(true);
      // A font still downloading is added once it is in memory, and the frame drawn again.
      const pending = fonts.filter(([family]) => !this.view.loadedFonts.has(family));
      if (pending.length) {
        this.setTrack(subtitles);
      }
    },
    destroyRenderer() {
      // This also removes the canvas.
      this.view.renderer?.destroy();
      this.view.renderer = null;
      this.view.loadedFonts = new Map();
    },
    /**
     * Draw the frame at the current time.
     * `repaint` is true when the frame can differ at an unchanged time: a new renderer, track or
     * font. It is false for a new time, where libass redraws only a frame that has changed.
     */
    async render(repaint = false) {
      const renderer = this.view.renderer;
      if (!renderer) {
        return;
      }
      await renderer.ready;
      if (renderer !== this.view.renderer) {
        return;
      }
      await renderer.manualRender(
        {
          mediaTime: this.currentTime,
          // Only the aspect ratio counts. The renderer fits it to the canvas.
          width: SUBTITLE_CANVAS.width,
          height: SUBTITLE_CANVAS.height,
          expectedDisplayTime: performance.now(),
        },
        repaint,
      );
    },
    /**
     * Replace the subtitles the renderer draws, once it holds every font they name.
     */
    async setTrack(subtitles: string) {
      const renderer = this.view.renderer;
      if (!renderer) {
        return;
      }
      this.view.track = subtitles;
      const fonts = this.fontsFor(subtitles);
      if (this.hasReplacedFont(fonts)) {
        this.destroyRenderer();
        this.createRenderer(subtitles);
        return;
      }
      await Promise.all(
        [...fonts].map(
          ([family, url]) =>
            this.view.loadedFonts.get(family)?.loaded ?? this.addFont(renderer, family, url),
        ),
      );
      if (renderer !== this.view.renderer || subtitles !== this.view.track) {
        return;
      }
      if (subtitles !== this.view.rendererTrack) {
        this.view.rendererTrack = subtitles;
        await renderer.renderer.setTrack(subtitles);
      }
      // The renderer doesn't redraw for a font that has arrived.
      this.render(true);
    },
    setPlayhead(playhead: number) {
      this.currentTime = playhead;
      this.syncVideo(playhead);
    },
    syncVideo(playhead: number) {
      const video = this.$refs.video as HTMLVideoElement | undefined;
      if (video) {
        syncBackgroundVideo(video, playhead, {
          audioDelay: this.audioDelay,
          videoOffset: this.videoOffset,
          isPlaying: this.isPlaying,
        });
      }
    },
    pause() {
      this.isPlaying = false;
      this.syncVideo(this.currentTime);
    },
    play() {
      this.isPlaying = true;
      this.syncVideo(this.currentTime);
    },
  },
});
</script>

<style scoped>
/* The shape of the output video, 16:9 at every resolution. */
.video-container {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
}

.background,
.subtitle-layer,
.subtitle-layer :deep(.subtitle-canvas) {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.background {
  object-fit: cover;
}
</style>
