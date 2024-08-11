<template>
  <b-tab-item :class="['help-tab', 'scroll-wrapper']">
    <template #header>
      <b-icon v-if="!isSeparatingTrack" icon="file-audio"></b-icon>
      <b-tooltip v-else label="Separating track" position="is-right"
        ><b-icon icon="loader" custom-class="loader"></b-icon
      ></b-tooltip>
      <span> Song File</span>
    </template>
    <div class="container">
      <h2 class="title">Get Your Song Ready</h2>
      <file-upload
        label="Upload a file from your computer:"
        v-model="songFile"
        @input="onSongFileChange"
      ></file-upload>
      <b-field
        label="Or paste a YouTube video URL:"
        :type="youtubeError ? 'is-danger' : ''"
      >
        <template #message>
          <span v-html="youtubeError"></span>
        </template>
        <b-input type="text" v-model="youtubeUrl" />
        <b-button
          label="Load"
          :type="youtubeUrl ? 'is-primary' : 'is-light'"
          :disabled="!youtubeUrl"
          @click="loadYouTubeUrl"
          :loading="isLoadingYouTube"
        />
      </b-field>
      <b-field label="Song Artist">
        <b-input v-model="artist" @input="onTextChange" />
      </b-field>
      <b-field label="Song Title">
        <b-input v-model="title" @input="onTextChange" />
      </b-field>
      <b-field
        horizontal
        label="Include Backing Vocals"
        class="backing-vocals-toggle"
      >
        <b-switch v-model="includeBackingVocals"></b-switch
      ></b-field>
    </div>

    <b-collapse :open="false">
      <template #trigger="props">
        <b-button
          type="is-text"
          aria-controls="contentIdForA11y4"
          :aria-expanded="props.open"
        >
          <span>Advanced</span>
          <b-icon :icon="props.open ? 'angle-down' : 'angle-right'"></b-icon>
        </b-button>
      </template>
      <div class="box">
        <file-upload
          label="Timings File"
          v-model="timingsFile"
          @input="onTimingsFileChange"
        />
        <file-upload
          label="Backing Track"
          v-model="backingTrackFile"
          @input="onBackingTrackFileChange"
        />
      </div>
    </b-collapse>
    <div class="buttons" v-if="!backingTrackFile">
      <b-tooltip
        position="is-right"
        :label="separatingTrackMessage"
        :always="isSeparatingTrack"
      >
        <b-button
          label="Separate Track"
          type="is-primary"
          :disabled="!songFile"
          :loading="isSeparatingTrack"
          @click="separateTrack"
        />
      </b-tooltip>
    </div>
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { mapStores } from "pinia";

// jsmediatags can't be installed via npm when used in-browser: https://github.com/aadsm/jsmediatags#browser
const jsmediatags = require("@/jsmediatags.min.js");
import { fetchYouTubeVideo, parseYouTubeTitle } from "@/lib/video";

import {
  useMusicSeparationStore,
  BACKING_VOCALS_SEPARATOR_MODEL,
  NO_VOCALS_SEPARATOR_MODEL,
} from "@/stores/musicSeparation";
import FileUpload from "@/components/FileUpload.vue";

export default defineComponent({
  components: {
    FileUpload,
  },
  props: {
    value: Object,
    musicSeparationModel: {
      type: String,
      default: BACKING_VOCALS_SEPARATOR_MODEL,
    },
  },
  data() {
    return {
      songFile: this.value.file,
      youtubeUrl: this.value.youtubeUrl,
      artist: this.value.artist,
      title: this.value.title,
      duration: this.value.duration,
      isLoadingYouTube: false,
      videoBlob: null,
      timingsFile: null,
      backingTrackFile: null,
      youtubeError: null,
    };
  },
  computed: {
    songInfo() {
      return {
        file: this.songFile,
        artist: this.artist,
        title: this.title,
        duration: this.duration,
        youtubeUrl: this.youtubeUrl,
        videoBlob: this.videoBlob,
      };
    },
    isSeparatingTrack() {
      return this.musicSeparationStore.isProcessing;
    },
    separatingTrackMessage() {
      if (this.isSeparatingTrack) {
        return "Separating track...head to the Lyrics tab to keep working on the song!";
      }
      return "Start separating the track while you work on the song timings. It's faster!";
    },
    includeBackingVocals: {
      get() {
        return this.musicSeparationModel == BACKING_VOCALS_SEPARATOR_MODEL;
      },
      set(value) {
        this.onChange(
          "musicSeparationModel",
          value ? BACKING_VOCALS_SEPARATOR_MODEL : NO_VOCALS_SEPARATOR_MODEL
        );
      },
    },
    ...mapStores(useMusicSeparationStore),
  },
  methods: {
    async songDuration(songFile: File): Promise<number> {
      const p = new Promise<number>(async (resolve, reject) => {
        const audio = document.createElement("audio");
        audio.addEventListener(
          "loadedmetadata",
          () => {
            const duration = audio.duration;
            resolve(duration);
          },
          false
        );
        audio.addEventListener("error", reject);
        const reader = new FileReader();
        reader.addEventListener("load", (e) => {
          audio.src = e.target.result.toString();
        });
        reader.addEventListener("error", reject);
        reader.readAsDataURL(songFile);
      });
      return p;
    },
    onSongFileChange(file: File | null) {
      if (!file) {
        this.songFile = null;
        this.$emit("input", this.songInfo);
        return;
      }
      const self = this;
      jsmediatags.read(this.songFile, {
        async onSuccess(tag) {
          self.artist = tag.tags.artist;
          self.title = tag.tags.title;
          self.duration = await self.songDuration(self.songFile);
          self.$emit("input", self.songInfo);
        },
        onFailure(error) {
          console.error(error);
          self.$emit("input", self.songInfo);
        },
      });
    },
    onTextChange(e) {
      this.$emit("input", this.songInfo);
    },
    async loadYouTubeUrl() {
      this.isLoadingYouTube = true;
      this.youtubeError = null;
      try {
        const [audioBlob, videoBlob, metadata] = await fetchYouTubeVideo(
          this.youtubeUrl
        );
        this.songFile = new File([audioBlob], "audio.mp4", {
          type: "audio/mp4",
        });
        const parsedMetadata = parseYouTubeTitle(metadata);
        this.artist = parsedMetadata[0];
        this.title = parsedMetadata[1];
        this.duration = await this.songDuration(this.songFile);
        this.videoBlob = videoBlob;
      } catch (e) {
        console.error(e);
        this.youtubeError = `There was a problem downloading that video: ${e.message}. Please try again or use a service such as <a href="https://v2.youconvert.net/en/">YouConvert</a> to get the audio and add it above.`;
      }
      this.isLoadingYouTube = false;
      this.$emit("input", this.songInfo);
    },
    onTimingsFileChange(file: File | null) {
      if (!file) {
        this.onChange("timings", []);
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        this.onChange("timings", JSON.parse(e.target.result.toString()));
      };
      reader.readAsText(file);
    },
    onSeparationModelChange(model) {
      this.onChange("separationModel", model);
    },
    onBackingTrackFileChange(file: File | null) {
      if (!file) {
        this.onChange("backingTrack", null);
        return;
      }
      this.onChange("backingTrack", file);
    },
    onChange(optionName: string, newValue: any) {
      this.$emit("options-change", { [optionName]: newValue });
    },
    async separateTrack() {
      const model = this.musicSeparationModel;
      this.musicSeparationStore.startSeparation(this.songFile, model);
    },
  },
});
</script>
<style scoped>
.song-info-tab {
  overflow-x: hidden;
  overflow-y: auto;
}

.backing-vocals-toggle :deep(.field-label) {
  text-align: left !important;
  flex-grow: 0 !important;
  flex-basis: fit-content;
}
</style>