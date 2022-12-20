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
      <help-tab @options-change="onOptionsChange"></help-tab>
      <song-info-tab v-model="songInfo"></song-info-tab>
      <lyric-input-tab v-model="lyricText"></lyric-input-tab>
      <song-timing-tab
        @timings-complete="onTimingsComplete"
        :song-info="songInfo"
        :lyric-segments="lyricSegments"
        :timings="timings"
      ></song-timing-tab>
      <submit-tab
        :song-info="songInfo"
        :lyric-text="lyricText"
        :timings="timings"
        :enabled="isReadyToSubmit"
      ></submit-tab>
    </b-tabs>
  </div>
</template>

<script>
import HelpTab from "@/components/HelpTab.vue";
import SongInfoTab from "@/components/SongInfoTab.vue";
import LyricInputTab from "@/components/LyricInputTab.vue";
import SongTimingTab from "@/components/SongTimingTab.vue";
import SubmitTab from "@/components/SubmitTab.vue";
import { KEY_CODES, LYRIC_MARKERS } from "@/constants.js";

import LyricDisplay from "@/components/LyricDisplay.vue";

export default {
  components: {
    LyricDisplay,
    HelpTab,
    SongInfoTab,
    LyricInputTab,
    SongTimingTab,
    SubmitTab,
  },
  data() {
    return {
      lyricText: "",
      // Object containing song info: file, artist, title
      songInfo: { file: null, artist: null, title: null, duration: null },
      isSubmitting: false,
      // Array of lyric timings
      timings: null,
    };
  },

  computed: {
    lyricSegments() {
      return this.parseLyricSegments(this.lyricText);
    },
    isReadyToSubmit() {
      return (
        this.songInfo &&
        this.songInfo.file &&
        this.lyricText.length > 0 &&
        this.timings != null
      );
    },
  },
  methods: {
    onTimingsComplete(timings) {
      this.timings = timings;
    },
    onOptionsChange(newOptions) {
      for (const key in newOptions) {
        if (Object.hasOwnProperty.call(newOptions, key)) {
          const newValue = newOptions[key];
          this[key] = newValue;
        }
      }
    },
    // Parse marked up lyrics into segments.
    // Line breaks separate segments.
    // Double line breaks separate screens.
    // Underscores separate segments on word boundaries between a line.
    // Sla/shes separate segments within a word.
    parseLyricSegments(lyricsText) {
      const segments = [];
      let currentSegment = "";
      for (let i = 0; i < lyricsText.length; i++) {
        let finishSegment = false;
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