<template>
  <b-tab-item label="Song File" icon="file-audio" class="help-tab">
    <div class="container">
      <h2 class="title">Get Your Song Ready</h2>
      <b-field label="Upload a file from your computer:">
        <b-field class="file is-primary" :class="{ 'has-name': !!songFile }">
          <!-- <b-input type="text" :value="songFile && songFile.name" disabled /> -->

          <b-upload v-model="songFile" @input="onFileChange" class="file-label">
            <span class="file-cta">
              <b-icon class="file-icon" icon="file-audio"></b-icon>
              <span class="file-label">Choose File</span>
            </span>
            <span class="file-name">
              {{ songFile?.name || "No file chosen" }}
            </span>
          </b-upload>
        </b-field>
      </b-field>
      <b-field label="Or paste a YouTube video URL:">
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
        <b-field label="Timings File">
          <b-upload
            v-model="timingsFile"
            class="file-label"
            @input="onTimingFileChange"
          >
            <span class="file-cta">
              <b-icon class="file-icon" icon="upload"></b-icon>
              <span class="file-label">Choose File</span>
            </span>
            <span class="file-name">
              {{ timingsFile?.name || "No file chosen" }}
            </span>
          </b-upload>
        </b-field>
      </div>
    </b-collapse>
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
// jsmediatags can't be installed via npm when used in-browser: https://github.com/aadsm/jsmediatags#browser
const jsmediatags = require("@/jsmediatags.min.js");
import { fetchYouTubeVideo, parseYouTubeTitle } from "@/lib/video";

export default defineComponent({
  props: {
    value: Object,
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
    onFileChange(e) {
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
      }
      this.isLoadingYouTube = false;
      this.$emit("input", this.songInfo);
    },
    onTimingFileChange(file: File) {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.onChange("timings", JSON.parse(e.target.result.toString()));
      };
      reader.readAsText(file);
    },
    onChange(optionName: string, newValue: any) {
      this.$emit("options-change", { [optionName]: newValue });
    },
  },
});
</script>
