<template>
  <b-field :label="label">
    <b-upload v-model="file" class="file" :accept="acceptAttribute">
      <span class="file-cta">
        <b-icon class="file-icon" icon="upload"></b-icon>
        <span class="file-label">Choose File</span>
      </span>
      <span class="file-name">
        {{ file?.name || "No file chosen" }}
      </span>
    </b-upload>
    <p class="control">
      <b-button
        type="is-danger is-light"
        @click="file = null"
        v-if="file"
        icon-left="trash-can"
      >
      </b-button></p
  ></b-field>
</template>

<script lang="ts">
import { defineComponent } from "vue";
export default defineComponent({
  props: {
    label: String,
    modelValue: File,
  },
  computed: {
    file: {
      get() {
        return this.modelValue;
      },
      set(newValue) {
        this.$emit("update:modelValue", newValue);
      },
    },
  },
});
</script>