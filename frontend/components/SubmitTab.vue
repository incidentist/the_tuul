<template>
  <b-tab-item
    label="Submit"
    icon="blender"
    class="submit-tab"
    :disabled="!enabled"
  >
    <b-field expanded horizontal
      ><b-switch left-label v-model="videoOptions.addCountIns"
        >Add Count-Ins</b-switch
      ></b-field
    >
    <b-field expanded horizontal
      ><b-switch left-label v-model="videoOptions.addInstrumentalScreens"
        >Add Instrumental Breaks</b-switch
      ></b-field
    >
    <div class="buttons">
      <b-button
        expanded
        type="is-primary"
        :loading="isSubmitting"
        @click="submitTimings"
        :disabled="!enabled && !isSubmitting"
      >
        Create Video
      </b-button>
    </div>
    <b-message :active="isSubmitting" type="is-success" has-icon icon="magic">
      Creating your karaoke video. This might take a few minutes.
    </b-message>
  </b-tab-item>
</template>

<script>
import { createAssFile, createScreens } from "@/lib/timing.ts";
import { TITLE_SCREEN_DURATION } from "@/constants.js";

export default {
  props: {
    songInfo: Object,
    lyricText: String,
    timings: Array,
    enabled: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      isSubmitting: false,
      videoOptions: {
        addCountIns: true,
        addInstrumentalScreens: true,
      },
    };
  },
  computed: {
    songFile() {
      return this.songInfo.file;
    },
    subtitles() {
      return createAssFile(
        this.lyricText,
        this.timings,
        this.songFile.duration,
        this.songInfo.title,
        this.songInfo.artist,
        this.videoOptions
      );
    },
    audioDelay() {
      const screens = createScreens(
        this.lyricText,
        this.timings,
        this.songFile.duration,
        this.songInfo.title,
        this.songInfo.artist,
        this.videoOptions
      );
      return _.sum(_.map(screens, "audioDelay"));
    },
    zipFileName() {
      if (this.songInfo.artist && this.songInfo.title) {
        return `${this.songInfo.artist} - ${this.songInfo.title} [karaoke].mp4.zip`;
      }
      return "karaoke.mp4.zip";
    },
  },
  methods: {
    async submitTimings() {
      this.isSubmitting = true;
      const formData = new FormData();
      formData.append("lyrics", this.lyricText);
      formData.append("timings", JSON.stringify(this.timings));
      formData.append("songFile", this.songFile);
      formData.append("songArtist", this.songInfo.artist);
      formData.append("songTitle", this.songInfo.title);
      formData.append("subtitles", this.subtitles);
      formData.append("audioDelay", this.audioDelay);

      const response = await fetch("/generate_video", {
        method: "POST",
        body: formData,
      });
      this.isSubmitting = false;
      await this.saveZipFile(response);
    },
    async saveZipFile(response) {
      console.log(response);
      const filename = this.zipFileName;
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

<style scoped>
.submit-tab {
  margin: auto 30%;
}
</style>