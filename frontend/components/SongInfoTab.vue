<template>
  <b-tab-item label="Song File" icon="file-audio" class="help-tab">
    <div class="container">
      <h2 class="title">Choose a Song File</h2>
      <b-field class="file is-primary" :class="{ 'has-name': !!songFile }">
        <b-upload v-model="songFile" @input="onFileChange" class="file-label">
          <span class="file-cta">
            <b-icon class="file-icon" icon="file-audio"></b-icon>
            <span class="file-label">Click to upload</span>
          </span>
          <span class="file-name" v-if="songFile">
            {{ songFile.name }}
          </span>
        </b-upload>
      </b-field>
      <b-field label="YouTube Video URL">
        <b-input type="text" v-model="youtubeUrl" />
        <b-button
          label="Load"
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
  },
});
</script>

<style scoped>
.help-tab {
  margin: auto;
}
</style>