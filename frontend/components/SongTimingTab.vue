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
      :active="hasCompletedTimings && !hasMarkedEndOfLastLine"
      type="is-warning"
      has-icon
      icon="warning"
      >Almost done! Press <kbd>Enter</kbd> when the last line ends.</b-message
    >
    <b-message
      :active="hasCompletedTimings && hasMarkedEndOfLastLine"
      type="is-success"
      has-icon
      icon="check"
      >Done! You've got everything you need to create your video. Go to the
      Submit tab.</b-message
    >
    <audio
      ref="audio"
      :src="audioSource"
      @ended="onAudioEvent"
      @pause="onAudioEvent"
      @play="onAudioEvent"
    ></audio>
    <div class="level is-mobile">
      <div class="level-item">
        <div class="buttons">
          <b-button type="is-primary" @click="playPause">
            {{ isPlaying ? "Pause" : "Play" }}
          </b-button>
          <b-button type="is-primary" @click="redoScreen" :active="isPlaying">
            &laquo; Redo This Screen
          </b-button>
        </div>
      </div>
      <div class="level-item">
        <b-field class="playback-speed" label="Speed:" horizontal>
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

<script lang="ts">
import { defineComponent } from "vue";
import { KEY_CODES, LYRIC_MARKERS } from "@/constants";
import LyricDisplay from "@/components/LyricDisplay.vue";

interface LyricTimingEvent {}
type LyricMarker = number;

class TimingsList {
  _timings: Array<[number, LyricMarker]>;
  constructor() {
    this._timings = [];
  }
  add(currentSegmentNum, keyCode, timestamp) {
    if (currentSegmentNum < 0) {
      return;
    }
    const marker =
      keyCode == KEY_CODES.SPACEBAR
        ? LYRIC_MARKERS.SEGMENT_START
        : LYRIC_MARKERS.SEGMENT_END;
    this._timings.push([timestamp, marker]);
  }
  toJson() {
    return JSON.stringify(this._timings);
  }

  toArray() {
    return this._timings;
  }

  timingForSegmentNum(segmentNum) {
    const starts = this._timings.filter(
      (t) => t[1] == LYRIC_MARKERS.SEGMENT_START
    );
    if (segmentNum >= starts.length) {
      return 0;
    }
    return starts[segmentNum][0];
  }

  setCurrentSegment(segmentNum) {
    // Set the segment we're currently listening for to segmentNum
    let i = 0,
      currentSegment = 0;
    while (i < this._timings.length) {
      if (this._timings[i][1] == LYRIC_MARKERS.SEGMENT_START) {
        currentSegment += 1;
      }
      if (currentSegment > segmentNum) {
        break;
      }
      i++;
    }
    this._timings = this._timings.slice(0, i);
  }

  last() {
    return this._timings[this._timings.length - 1];
  }

  get length() {
    return this._timings.length;
  }
}

export default defineComponent({
  components: { LyricDisplay },
  props: {
    songInfo: Object,
    lyricSegments: Array,
  },
  data() {
    return {
      currentSegment: 0,
      isPlaying: false,
      playbackRate: 1.0,
      timings: new TimingsList(),
    };
  },
  computed: {
    songFile() {
      if (this.songInfo) {
        return this.songInfo.file;
      }
      return null;
    },
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
    hasMarkedEndOfLastLine() {
      return (
        this.hasCompletedTimings &&
        this.timings.last()[1] == LYRIC_MARKERS.SEGMENT_END
      );
    },
    currentScreen() {
      let currentScreen = 0;
      for (let i = 0; i < this.lyricSegments.length; i++) {
        const segment = this.lyricSegments[i];
        if (i == this.currentSegment) {
          break;
        }
        if (this.isSegmentEndOfScreen(segment, i)) {
          currentScreen += 1;
        }
      }
      return currentScreen;
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
          this.addTimingEvent(keyCode, currentSongTime);
        }
        e.preventDefault();
        return false;
      }
    },
    addTimingEvent(keyCode, currentSongTime) {
      if (keyCode == KEY_CODES.ENTER) {
        this.timings.add(this.currentSegment - 1, keyCode, currentSongTime);
      } else if (keyCode == KEY_CODES.SPACEBAR) {
        this.advanceToNextSegment(keyCode, currentSongTime);
      }
      if (this.hasMarkedEndOfLastLine) {
        this.$emit("timings-complete", this.timings.toArray());
      }
    },
    advanceToNextSegment(keyCode, currentSongTime) {
      if (this.currentSegment >= this.lyricSegments.length) {
        return;
      }
      this.timings.add(this.currentSegment, keyCode, currentSongTime);
      this.currentSegment += 1;
    },
    playPause() {
      this.isPlaying = !this.isPlaying;
    },
    onAudioEvent(e: Event) {
      const audioEl = this.$refs.audio;
      this.isPlaying = !(audioEl.paused || audioEl.ended);
      if (e.type == "ended" && !this.hasMarkedEndOfLastLine) {
        this.addTimingEvent(KEY_CODES.ENTER, this.$refs.audio.currentTime);
      }
    },
    redoScreen() {
      var firstSegmentInScreen = this.firstSegmentOfScreen(this.currentScreen);
      if (firstSegmentInScreen == this.currentSegment) {
        // User meant to go back a screen
        firstSegmentInScreen = this.firstSegmentOfScreen(
          Math.max(this.currentScreen - 1, 0)
        );
      }
      this.$refs.audio.currentTime = this.secondsBeforeSegment(
        firstSegmentInScreen,
        5
      );
      this.timings.setCurrentSegment(firstSegmentInScreen);
      this.currentSegment = firstSegmentInScreen;
    },
    firstSegmentOfScreen(screenNum) {
      let currentScreen = 0,
        segmentNum = 0;

      for (segmentNum = 0; currentScreen < screenNum; segmentNum++) {
        if (segmentNum >= this.lyricSegments.length) {
          throw Error(`firstSegmentOfScreen: no such screen ${screenNum}`);
        }
        const segment = this.lyricSegments[segmentNum];
        if (this.isSegmentEndOfScreen(segment, segmentNum)) {
          currentScreen += 1;
        }
      }
      return segmentNum;
    },
    secondsBeforeSegment(segmentNum, seconds) {
      const segmentStart = this.timings.timingForSegmentNum(segmentNum);
      return Math.max(segmentStart - seconds, 0);
    },
    isSegmentEndOfScreen(segment, segmentIndex) {
      return (
        segment.text.endsWith("\n\n") ||
        segmentIndex == this.lyricSegments.length - 1
      );
    },
  },
});
</script>

<style scoped>
.playback-speed {
  display: flex;
}
</style>