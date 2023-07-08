<template>
  <b-tab-item
    label="Submit"
    icon="blender"
    class="submit-tab"
    :disabled="!enabled"
  >
    <div class="columns is-variable is-5">
      <div class="column settings-column">
        <h3 class="title">More Settings:</h3>
        <b-field expanded horizontal custom-class="fit-content">
          <template #label>
            Add Count-Ins
            <b-tooltip
              label="Add count-in dots so you know when to start singing"
            >
              <b-icon size="is-small" icon="question-circle"></b-icon>
            </b-tooltip>
          </template>
          <b-switch v-model="videoOptions.addCountIns"></b-switch
        ></b-field>
        <b-field expanded horizontal custom-class="fit-content">
          <template #label>
            Add Instrumental Breaks
            <b-tooltip label="Add screens that count down long instrumentals">
              <b-icon size="is-small" icon="question-circle"></b-icon>
            </b-tooltip> </template
          ><b-switch v-model="videoOptions.addInstrumentalScreens"></b-switch
        ></b-field>
      </div>
      <div class="column is-narrow">
        <h3 class="title">Video Preview:</h3>
        <video-preview
          v-if="enabled"
          :song-file="songFile"
          :subtitles="subtitles"
          :audio-delay="audioDelay"
        />
      </div>
    </div>

    <div class="submit-button-container">
      <div class="buttons">
        <b-button
          expanded
          size="is-large"
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
    </div>
  </b-tab-item>
</template>

<script lang="ts">
import * as _ from "lodash";
import { defineComponent } from "vue";
import { createAssFile, createScreens, KaraokeOptions } from "@/lib/timing";
import { API_HOSTNAME } from "@/constants";
import VideoPreview from "@/components/VideoPreview.vue";

export default defineComponent({
  components: { VideoPreview },
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
    subtitles(): string {
      if (!this.enabled) {
        return "";
      }
      return createAssFile(
        this.lyricText,
        this.timings,
        this.songFile.duration,
        this.songInfo.title,
        this.songInfo.artist,
        this.videoOptions
      );
    },
    audioDelay(): number {
      if (!this.enabled) {
        return 0;
      }
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
    zipFileName(): string {
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

      const url = `${API_HOSTNAME}/generate_video`;

      const response = await fetch(url, {
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
});
</script>
<style>
.fit-content {
  width: max-content;
}
</style>
<style scoped>
.submit-tab {
  overflow-x: hidden;
  overflow-y: auto;
}

.settings-column {
  margin: 0 10%;
}

.submit-tab column {
  text-align: center;
}
</style>