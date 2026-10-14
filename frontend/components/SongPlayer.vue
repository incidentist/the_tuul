<template>
  <div class="song-player">
    <playback-transport :player="player">
      <template v-if="overviewBuffer" #slider>
        <overview-strip :player="player" :buffer="overviewBuffer" @grab="claimMediaKeys(player)" />
      </template>
    </playback-transport>
  </div>
</template>

<script lang="ts">
import { defineComponent, markRaw, PropType } from "vue";
import PlaybackTransport from "@/components/PlaybackTransport.vue";
import OverviewStrip from "@/components/OverviewStrip.vue";
import { claimMediaKeys, registerPlayer } from "@/lib/exclusivePlayback";
import { anchorMediaKeys } from "@/lib/mediaKeyAnchor";
import { WebAudioPlayer } from "@/lib/webAudioPlayer";

export default defineComponent({
  components: { PlaybackTransport, OverviewStrip },
  props: {
    file: { type: Object as PropType<Blob | null>, default: null },
    playbackRate: { type: Number, default: 1 },
    preservePitch: { type: Boolean, default: true },
  },
  data() {
    return {
      // The song plays on while the page is hidden, as lyrics are often copied from another tab.
      player: markRaw(new WebAudioPlayer({ pauseWhenHidden: false })),
      overviewBuffer: null as AudioBuffer | null,
      cleanups: [] as Array<() => void>,
    };
  },
  watch: {
    file(file: Blob | null) {
      if (file) this.load(file);
    },
    playbackRate() {
      this.applyPlaybackSettings();
    },
    preservePitch() {
      this.applyPlaybackSettings();
    },
  },
  mounted() {
    const { player } = this;
    player.addEventListener("loadeddata", this.onLoaded);
    this.cleanups = [
      registerPlayer(player, {
        isShown: () => (this.$el as HTMLElement).getClientRects().length > 0,
      }),
      anchorMediaKeys(player),
    ];
    this.applyPlaybackSettings();
    if (this.file) this.load(this.file);
  },
  beforeUnmount() {
    this.player.removeEventListener("loadeddata", this.onLoaded);
    this.cleanups.forEach((cleanup) => cleanup());
    this.player.dispose();
  },
  methods: {
    claimMediaKeys,
    load(file: Blob) {
      this.player.load(file).catch((error) => {
        console.error("Could not decode the track:", error);
      });
    },
    onLoaded() {
      const decoded = this.player.decoded;
      this.overviewBuffer = decoded && markRaw(decoded);
    },
    applyPlaybackSettings() {
      this.player.preservesPitch = this.preservePitch;
      this.player.playbackRate = this.playbackRate;
    },
  },
});
</script>
