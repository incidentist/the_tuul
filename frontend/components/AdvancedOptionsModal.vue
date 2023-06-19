<template>
  <div class="modal-card">
    <div class="modal-card-head">
      <p class="modal-card-title">Advanced Options</p>
    </div>
    <div class="modal-card-body">
      <b-field label="Timings File" horizontal>
        <b-upload
          v-model="timingsFile"
          class="file-label"
          @input="onTimingFileChange"
        >
          <span class="file-cta">
            <b-icon class="file-icon" icon="upload"></b-icon>
            <span class="file-label">Click to upload</span>
          </span>
          <span class="file-name" v-if="timingsFile">
            {{ timingsFile.name }}
          </span>
        </b-upload>
      </b-field>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
export default defineComponent({
  data() {
    return {
      timingsFile: null,
    };
  },
  methods: {
    onTimingFileChange(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.onChange("timings", JSON.parse(e.target.result.toString()));
      };
      reader.readAsText(file);
    },
    onChange(optionName, newValue) {
      this.$emit("options-change", { [optionName]: newValue });
    },
  },
});
</script>


