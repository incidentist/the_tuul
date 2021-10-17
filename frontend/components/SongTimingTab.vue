<template>
  <b-tab-item
    label="Song Timing"
    icon="stopwatch"
    class="wrapper"
    :disabled="!songFile || lyricSegments.length == 0"
  >
    <h2 class="title">Song Timing</h2>
    <div class="content">
      <p>
        Press <kbd>spacebar</kbd> when the singer starts the highlighted
        segment.
      </p>
      <p>
        Press <kbd>Enter</kbd> when the singer finishes the
        <em>previous</em> highlighted segment.
      </p>
      <p>
        Adjust the playback speed to slow down fast parts or skip through long
        instrumentals.
      </p>
    </div>
    <b-message
      :active="hasCompletedTimings"
      type="is-success"
      has-icon
      icon="check"
      >Done! You've got everything you need to create your video. Go to the
      Submit tab.</b-message
    >
    <audio
      ref="audio"
      :src="audioSource"
      @timeupdate="onAudioTimeUpdate"
    ></audio>
    <div class="level">
      <div class="level-item">
        <b-button type="is-primary" @click="playPause" expanded>
          {{ isPlaying ? "Pause" : "Play" }}
        </b-button>
      </div>
      <div class="level-item">
        <b-field label="Speed:" horizontal>
          <b-radio v-model="playbackRate" :native-value="1.5"> 1.5 </b-radio>
          <b-radio v-model="playbackRate" :native-value="1.0"> 1.0 </b-radio>
          <b-radio v-model="playbackRate" :native-value="0.9"> 0.9 </b-radio>
          <b-radio v-model="playbackRate" :native-value="0.7"> 0.7 </b-radio>
        </b-field>
      </div>
    </div>

    <lyric-display
      :lyric-segments="lyricSegments"
      :current-segment="currentSegment"
      @keydown="onKeyDown"
    >
    </lyric-display>
  </b-tab-item>
</template>
<script>
import { KEY_CODES, LYRIC_MARKERS } from "@/constants.js";
import LyricDisplay from "@/components/LyricDisplay.vue";

export default {
  components: { LyricDisplay },
  props: {
    songFile: File,
    lyricSegments: Array,
    currentSegment: Number,
  },
  data() {
    return {
      isPlaying: false,
      playbackRate: 1.0,
    };
  },
  computed: {
    audioSource() {
      return this.songFile ? URL.createObjectURL(this.songFile) : null;
    },
    hasCompletedTimings() {
      return (
        this.lyricSegments &&
        this.lyricSegments.length > 0 &&
        this.currentSegment == this.lyricSegments.length
      );
    },
  },
  watch: {
    isPlaying(newVal) {
      if (newVal) {
        window.addEventListener("keydown", this.onKeyDown);
        this.$refs.audio.play();
      } else {
        window.removeEventListener("keydown", this.onKeyDown);
        this.$refs.audio.pause();
      }
    },
    playbackRate(newRate) {
      this.$refs.audio.playbackRate = parseFloat(newRate);
    },
  },
  methods: {
    onKeyDown(e) {
      const keyCode = e.keyCode;
      if (Object.values(KEY_CODES).includes(keyCode) && this.isPlaying) {
        const currentSongTime = this.$refs.audio.currentTime;
        if (!this.hasCompletedTimings || keyCode == KEY_CODES.ENTER) {
          this.$emit("timing", { keyCode, currentSongTime });
        }
        e.preventDefault();
        return false;
      }
    },
    onAudioTimeUpdate(e) {
      this.currentPlaybackTime = this.$refs.audio.currentTime;
    },
    playPause() {
      this.isPlaying = !this.isPlaying;
    },
  },
};
</script>