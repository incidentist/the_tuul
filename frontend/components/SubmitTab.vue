<template>
  <b-tab-item
    label="Submit"
    icon="blender"
    class="submit-tab"
    :disabled="!enabled"
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
export default {
  props: {
    songFile: File,
    lyricText: String,
    timings: Object,
    enabled: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      isSubmitting: false,
    };
  },
  methods: {
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

<style scoped>
.submit-tab {
  margin: auto;
}
</style>