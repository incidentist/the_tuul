<template>
  <b-tab-item label="Song Timing" icon="stopwatch" class="wrapper song-timing-tab" headerClass="song-timing-tab-header"
    :disabled="!songFile || lyricSegments.length == 0">
    <h2 class="title">
      Song Timing
      <b-button v-if="isMobile" icon="help" icon-right="circle-question" :type="isShowingHelp ? 'is-primary' : ''"
        @click="isShowingHelp = !isShowingHelp" />
    </h2>
    <b-collapse v-model="isShowingHelp" class="content">
      <template v-if="isWordToggleMode">
        <p>
          Press <kbd>spacebar</kbd> when the singer starts the highlighted
          word, then press <kbd>spacebar</kbd> again when they finish it.
        </p>
      </template>
      <template v-else>
        <p>
          Press <kbd>spacebar</kbd> when the singer starts the highlighted
          segment.
        </p>
        <p>
          Press <kbd>Enter</kbd> when the singer finishes the
          <em>previous</em> highlighted segment.
        </p>
      </template>
      <p>
        Adjust the playback speed to slow down fast parts or skip through long
        instrumentals.
      </p>
      <p>
        Check <em>Sync Each Word</em> to time every word separately instead of
        every line.
      </p>
    </b-collapse>
    <b-message v-model="warningMessageVisible" type="is-warning" has-icon icon="warning">Almost done! Press
      <template v-if="isWordToggleMode"><kbd>spacebar</kbd> when the last word ends.</template>
      <template v-else><kbd>Enter</kbd> when the last line ends.</template></b-message>
    <b-message v-model="successMessageVisible" type="is-success" has-icon icon="check">Done! You've got everything you
      need to create your video. Go to the
      Submit tab.</b-message>
    <audio ref="audio" :src="audioSource" @ended="onAudioEvent" @pause="onAudioEvent" @play="onAudioEvent"></audio>
    <div class="level">
      <div class="level-item">
        <div class="buttons">
          <b-button type="is-primary" @click="playPause" name="song-timing-play-pause">
            {{ isPlaying ? "Pause" : "Play" }}
          </b-button>
          <b-button type="is-primary" @click="redoScreen" :active="isPlaying">
            &laquo; Redo This Screen
          </b-button>
          <div class="field">
            <b-button @click="showButtonKeyboard = !showButtonKeyboard" icon-right="keyboard"
              :type="showButtonKeyboard ? 'is-primary' : ''"
              title="Show or hide buttons for entering timings, if you don't have a keyboard"></b-button>
          </div>
          <div class="field">
            <b-checkbox type="is-primary" v-model="syncByWord" name="sync-by-word" :disabled="isPlaying">
              <b-tooltip multilined
                label="Time and highlight every word separately instead of every line: press spacebar when each word starts and again when it ends. Changing this after timing means you'll need to redo the timings."
                position="is-bottom" dashed>Sync Each Word</b-tooltip></b-checkbox>
          </div>
        </div>
      </div>
      <div class="level-item">
        <b-field class="playback-speed" label="Speed: " horizontal>
          <b-field class="has-addons">
            <template v-for="val in [0.3, 0.5, 0.7, 0.9, 1.0, 1.5]" :key="val">
              <b-radio-button :size="isMobile ? 'is-small' : ''" v-model="playbackRate" :native-value="val"
                class="is-flex-shrink-0">
                {{ val }}
              </b-radio-button>
            </template>
          </b-field>
        </b-field>
      </div>
    </div>

    <lyric-display :lyric-segments="lyricSegments" :current-segment="displayedSegment"
      :segment-in-progress="awaitingWordEnd" @keydown="onKeyDown">
    </lyric-display>
    <timing-buttons v-if="showButtonKeyboard" :show-enter="!isWordToggleMode" @keydown="onKeyDown" />
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { storeToRefs } from "pinia";
import { KEY_CODES, LYRIC_MARKERS } from "@/constants";
import { isMobile } from "@/lib/device";
import LyricDisplay from "@/components/LyricDisplay.vue";
import TimingButtons from "@/components/TimingButtons.vue";
import { useTimingsStore } from "@/stores/timings";
import { useLyricsStore } from "@/stores/lyrics";
import { useMediaStore } from "@/stores/media";

interface LyricTimingEvent { }

export default defineComponent({
  components: { LyricDisplay, TimingButtons },
  setup() {
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    const mediaStore = useMediaStore();
    const { lyricSegments, syncByWord } = storeToRefs(lyricsStore);
    return { timingsStore, lyricSegments, syncByWord, mediaStore };
  },
  data() {
    return {
      currentSegment: 0,
      // In word mode, true after a word's start was marked and its end is still pending
      awaitingWordEnd: false,
      isPlaying: false,
      isShowingHelp: !isMobile(),
      playbackRate: 1.0,
      showButtonKeyboard: isMobile(),
    };
  },
  computed: {
    isMobile,
    isWordToggleMode(): boolean {
      // In word mode, spacebar alternates between marking a word's start and its end
      return this.syncByWord;
    },
    displayedSegment(): number {
      // While waiting for a word to end, keep highlighting the word being sung
      return this.awaitingWordEnd ? this.currentSegment - 1 : this.currentSegment;
    },
    songFile() {
      return this.mediaStore.songFile;
    },
    audioSource() {
      return this.songFile ? URL.createObjectURL(this.songFile) : null;
    },
    warningMessageVisible: {
      get() {
        return this.timingsStore.areTimingsUsable && !this.timingsStore.areTimingsFinished;
      },
      set(value) {
      }
    },
    successMessageVisible: {
      get() {
        return this.timingsStore.areTimingsFinished;
      },
      set(value) {
      }
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
    syncByWord() {
      this.awaitingWordEnd = false;
    },
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
    onKeyDown(e: KeyboardEvent) {
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
      if (this.isWordToggleMode) {
        if (keyCode == KEY_CODES.SPACEBAR) {
          this.toggleWordTiming(currentSongTime);
        }
        return;
      }
      if (keyCode == KEY_CODES.ENTER) {
        this.timingsStore.add(this.currentSegment - 1, keyCode, currentSongTime);
      } else if (keyCode == KEY_CODES.SPACEBAR) {
        this.advanceToNextSegment(keyCode, currentSongTime);
      }
    },
    advanceToNextSegment(keyCode, currentSongTime) {
      if (this.currentSegment >= this.lyricSegments.length) {
        return;
      }
      this.timingsStore.add(this.currentSegment, keyCode, currentSongTime);
      this.currentSegment += 1;
    },
    toggleWordTiming(currentSongTime) {
      if (this.awaitingWordEnd) {
        this.timingsStore.add(this.currentSegment - 1, KEY_CODES.ENTER, currentSongTime);
        this.awaitingWordEnd = false;
      } else if (this.currentSegment < this.lyricSegments.length) {
        this.advanceToNextSegment(KEY_CODES.SPACEBAR, currentSongTime);
        this.awaitingWordEnd = true;
      }
    },
    playPause() {
      this.isPlaying = !this.isPlaying;
    },
    onAudioEvent(e: Event) {
      const audioEl = this.$refs.audio;
      this.isPlaying = !(audioEl.paused || audioEl.ended);
      if (e.type == "ended" && !this.hasMarkedEndOfLastLine) {
        if (this.isWordToggleMode) {
          if (this.awaitingWordEnd) {
            this.toggleWordTiming(this.$refs.audio.currentTime);
          }
        } else {
          this.addTimingEvent(KEY_CODES.ENTER, this.$refs.audio.currentTime);
        }
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
      this.timingsStore.setCurrentSegment(firstSegmentInScreen);
      this.currentSegment = firstSegmentInScreen;
      this.awaitingWordEnd = false;
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
      const segmentStart = this.timingsStore.timingForSegmentNum(segmentNum);
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
  flex-grow: 1;
  padding-right: 2em;
}

.playback-speed :deep(.field-body) {
  display: flex;
  flex-direction: row;
}

.playback-speed :deep(.control) {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
}

.is-flex-shrink-0 {
  flex-shrink: 0;
  margin-right: 0.25rem;
}
</style>
