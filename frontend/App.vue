<template>
  <div class="wrapper">
    <audio ref="audio" @timeupdate="onAudioTimeUpdate"></audio>
    <fieldset class="fieldset">
      <b-field class="file is-primary" :class="{ 'has-name': !!songFile }">
        <b-upload v-model="songFile" class="file-label">
          <span class="file-cta">
            <b-icon class="file-icon" icon="file-audio"></b-icon>
            <span class="file-label">Click to upload</span>
          </span>
          <span class="file-name" v-if="songFile">
            {{ songFile.name }}
          </span>
        </b-upload>
      </b-field>
      <b-field label="Lyrics:">
        <b-input type="textarea" v-model="lyricText"></b-input>
      </b-field>
    </fieldset>
    <lyric-display
      :lyric-segments="lyricSegments"
      :current-segment="currentSegment"
      @keydown="onKeyDown"
    >
    </lyric-display>
    <div class="buttons">
      <b-button type="is-primary" @click="playPause">
        {{ isPlaying ? "Pause" : "Play" }}
      </b-button>
      <div class="block">
        <label>Playback speed:</label>
        <b-radio v-model="playbackRate" :native-value="1.5"> 1.5 </b-radio>
        <b-radio v-model="playbackRate" :native-value="1.0"> 1.0 </b-radio>
        <b-radio v-model="playbackRate" :native-value="0.9"> 0.9 </b-radio>
        <b-radio v-model="playbackRate" :native-value="0.7"> 0.7 </b-radio>
      </div>

      <b-button
        :loading="isSubmitting"
        @click="submitTimings"
        :disabled="!hasCompleteTimings && !isSubmitting"
        >Create Video </b-button
      ><span v-if="isSubmitting"
        >Creating video. This might take a few minutes.</span
      >
    </div>
  </div>
</template>

<script>
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

const KEY_CODES = {
  SPACEBAR: 32,
  ENTER: 13,
};

const LYRIC_MARKERS = {
  SEGMENT_START: 1,
  SEGMENT_END: 2,
};

export default {
  components: {
    LyricDisplay,
  },
  data() {
    return {
      lyricText: "",
      songFile: null,
      currentSegment: 0,
      isPlaying: false,
      isSubmitting: false,
      currentPlaybackTime: 0.0,
      playbackRate: 1.0,
      timings: new TimingsList(),
    };
  },
  mounted() {
    window.addEventListener("keydown", this.onKeyDown);
  },
  computed: {
    songUrl() {
      return "/song_file";
    },
    hasCompleteTimings() {
      return this.currentSegment >= this.lyricSegments.length;
    },
    lyricSegments() {
      return this.parseLyricSegments(this.lyricText);
    },
  },
  watch: {
    isPlaying(newVal) {
      if (newVal) {
        this.$refs.audio.play();
      } else {
        this.$refs.audio.pause();
      }
    },
    async songFile(newVal) {
      if (newVal) {
        this.$refs.audio.src = URL.createObjectURL(newVal);
      }
    },
    playbackRate(newRate) {
      this.$refs.audio.playbackRate = parseFloat(newRate);
    },
  },
  methods: {
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
        if (["\n", "/", "_"].includes(char)) {
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
    advanceToNextSegment(keyCode) {
      if (this.currentSegment >= this.lyricSegments.length) {
        // we're done
        return;
      }
      this.timings.add(
        this.currentSegment,
        keyCode,
        this.$refs.audio.currentTime
      );
      this.currentSegment += 1;
    },
    onKeyDown(e) {
      const keyCode = e.keyCode;
      if (Object.values(KEY_CODES).includes(keyCode) && this.isPlaying) {
        if (keyCode == KEY_CODES.ENTER) {
          this.timings.add(
            this.currentSegment - 1,
            keyCode,
            this.$refs.audio.currentTime
          );
        } else if (keyCode == KEY_CODES.SPACEBAR) {
          this.advanceToNextSegment(e.keyCode);
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
    changeRate(e) {
      const newRate = parseFloat(e.target.value);
      this.$refs.audio.playbackRate = newRate;
    },
    async submitTimings() {
      this.isSubmitting = true;
      const formData = new FormData();
      formData.append("lyrics", this.lyricText);
      formData.append("timings", this.timings.toJson());
      formData.append("songFile", this.songFile);

      const response = await fetch("/generate_video", {
        method: "POST",
        body: formData,
      });
      this.isSubmitting = false;
      await this.saveZipFile(response);
    },
    async saveZipFile(response) {
      const filename = `${this.songFile.name}.zip`;
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onload = (e) => {
        const anchor = document.createElement("a");
        anchor.style.display = "none";
        anchor.href = URL.createObjectURL(blob);
        anchor.download = filename;
        anchor.click();
      };
      reader.readAsDataURL(blob);
    },
  },
};
</script>