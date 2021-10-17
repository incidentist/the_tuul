<template>
  <div class="wrapper">
    <b-navbar shadow :mobile-burger="false">
      <template #brand>
        <b-navbar-item tag="span">
          <span class="title">The Tüül</span>
        </b-navbar-item>
        <b-navbar-item>
          <span class="subtitle mb-0">
            &nbsp;(For Making Decent Karaoke Videos From Any Song in About 10
            Minutes)</span
          ></b-navbar-item
        >
      </template>
    </b-navbar>
    <b-tabs vertical expanded type="is-boxed">
      <help-tab></help-tab>
      <song-file-tab v-model="songFile"></song-file-tab>
      <lyric-input-tab v-model="lyricText"></lyric-input-tab>
      <song-timing-tab
        @timing="onTimingEvent"
        :song-file="songFile"
        :current-segment="currentSegment"
        :lyric-segments="lyricSegments"
      ></song-timing-tab>
      <submit-tab
        :song-file="songFile"
        :lyric-text="lyricText"
        :timings="timings"
        :enabled="isReadyToSubmit"
      ></submit-tab>
    </b-tabs>
  </div>
</template>

<script>
import HelpTab from "@/components/HelpTab.vue";
import SongFileTab from "@/components/SongFileTab.vue";
import LyricInputTab from "@/components/LyricInputTab.vue";
import SongTimingTab from "@/components/SongTimingTab.vue";
import SubmitTab from "@/components/SubmitTab.vue";
import { KEY_CODES, LYRIC_MARKERS } from "@/constants.js";

import LyricDisplay from "@/components/LyricDisplay.vue";

class TimingsList {
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

  get length() {
    return this._timings.length;
  }
}

export default {
  components: {
    LyricDisplay,
    HelpTab,
    SongFileTab,
    LyricInputTab,
    SongTimingTab,
    SubmitTab,
  },
  data() {
    return {
      lyricText: "",
      songFile: null,
      currentSegment: 0,
      isSubmitting: false,
      timings: new TimingsList(),
    };
  },

  computed: {
    lyricSegments() {
      return this.parseLyricSegments(this.lyricText);
    },
    isReadyToSubmit() {
      return (
        this.songFile &&
        this.lyricText.length > 0 &&
        this.currentSegment == this.lyricSegments.length
      );
    },
  },
  methods: {
    onTimingEvent({ keyCode, currentSongTime }) {
      if (keyCode == KEY_CODES.ENTER) {
        this.timings.add(this.currentSegment - 1, keyCode, currentSongTime);
      } else if (keyCode == KEY_CODES.SPACEBAR) {
        this.advanceToNextSegment(keyCode, currentSongTime);
      }
    },
    // Parse marked up lyrics into segments.
    // Line breaks separate segments.
    // Double line breaks separate screens.
    // Underscores separate segments on word boundaries between a line.
    // Sla/shes separate segments within a word.
    parseLyricSegments(lyricsText) {
      const segments = [];
      var currentSegment = "";
      for (var i = 0; i < lyricsText.length; i++) {
        var finishSegment = false;
        const char = lyricsText[i];
        if (["\n", "/", "_"].includes(char) || i == lyricsText.length - 1) {
          finishSegment = true;
        }
        if (char == "\n" && currentSegment == "") {
          segments[segments.length - 1].text += char;
          continue;
        }
        currentSegment += char;
        if (finishSegment) {
          segments.push({
            text: currentSegment,
          });
          currentSegment = "";
        }
      }
      return segments;
    },
    advanceToNextSegment(keyCode, currentSongTime) {
      if (this.currentSegment >= this.lyricSegments.length) {
        // we're done
        return;
      }
      this.timings.add(this.currentSegment, keyCode, currentSongTime);
      this.currentSegment += 1;
    },
  },
};
</script>

<style scoped>
.b-tabs {
  flex: 1 1 auto;
  overflow: hidden;
}

.b-tabs.is-vertical {
  flex-wrap: nowrap;
}
</style>