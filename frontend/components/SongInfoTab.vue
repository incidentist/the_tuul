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
      <b-field label="Song Artist">
        <b-input v-model="artist" @input="onTextChange" />
      </b-field>
      <b-field label="Song Title">
        <b-input v-model="title" @input="onTextChange" />
      </b-field>
    </div>
  </b-tab-item>
</template>

<script>
// jsmediatags can't be installed via npm when used in-browser: https://github.com/aadsm/jsmediatags#browser
const jsmediatags = require("@/jsmediatags.min.js");

export default {
  props: {
    value: Object,
  },
  data() {
    return {
      songFile: this.value.file,
      artist: this.value.artist,
      title: this.value.title,
      duration: this.value.duration,
    };
  },
  computed: {
    songInfo() {
      return {
        file: this.songFile,
        artist: this.artist,
        title: this.title,
        duration: this.duration,
      };
    },
  },
  methods: {
    async songDuration(songFile) {
      const p = new Promise(async (resolve, reject) => {
        const audio = document.createElement("audio");
        audio.addEventListener(
          "loadedmetadata",
          () => {
            const duration = audio.duration;
            resolve(duration);
          },
          false
        );
        const reader = new FileReader();
        reader.addEventListener("load", (e) => (audio.src = e.target.result));
        reader.readAsDataURL(await this.songInfo.file);
      });
      return p;
    },
    onFileChange(e) {
      const self = this;
      jsmediatags.read(this.songFile, {
        async onSuccess(tag) {
          self.artist = tag.tags.artist;
          self.title = tag.tags.title;
          self.duration = await self.songDuration(this.songFile);
          self.$emit("input", self.songInfo);
        },
        onFailure(error) {
          console.error(error);
          self.$emit("input", self.songInfo);
        },
      });
    },
    onTextChange(e) {
      console.log("Text change");
      this.$emit("input", this.songInfo);
    },
  },
};
</script>

<style scoped>
.help-tab {
  margin: auto;
}
</style>