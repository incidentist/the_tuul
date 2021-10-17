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
    </div>
  </b-tab-item>
</template>

<script>
export default {
  props: {
    value: File,
  },
  data() {
    return {
      songFile: this.value,
    };
  },
  methods: {
    onFileChange(e) {
      this.$emit("input", e);
    },
  },
};
</script>

<style scoped>
.help-tab {
  margin: auto;
}
</style>