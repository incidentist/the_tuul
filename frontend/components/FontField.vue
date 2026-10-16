<template>
  <b-field
    horizontal
    :label="label"
    :type="isMissing ? 'is-warning' : undefined"
    :message="isMissing ? missingMessage : undefined"
  >
    <b-select expanded :model-value="isMissing ? modelValue : resolved" @update:model-value="pick">
      <option v-if="isMissing" :value="modelValue">{{ modelValue }} (not uploaded)</option>
      <optgroup label="Bundled">
        <option v-for="name in bundled" :key="name" :value="name">{{ name }}</option>
      </optgroup>
      <optgroup v-if="settingsStore.fontFaces.length > 0" label="Uploaded">
        <option v-for="face in settingsStore.fontFaces" :key="face.name" :value="face.name">
          {{ face.name }}
        </option>
      </optgroup>
    </b-select>
  </b-field>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { BField, BSelect } from "buefy";
import { BUNDLED_FONTS, faceSwitches } from "@/lib/fonts";
import { useSettingsStore } from "@/stores/settings";

/**
 * A menu of the bundled fonts and the uploaded faces. A name that is neither stays selected, marked
 * as missing, so that uploading the font brings it back.
 */
export default defineComponent({
  components: { BField, BSelect },
  props: {
    modelValue: { type: String, required: true },
    label: { type: String, default: "Font" },
  },
  emits: {
    "update:modelValue": (_name: string) => true,
    // The Bold and Italic switches that draw a picked uploaded face as it is.
    "face-switches": (_switches: { bold: boolean; italic: boolean }) => true,
  },
  setup() {
    return { settingsStore: useSettingsStore(), bundled: Object.keys(BUNDLED_FONTS) };
  },
  computed: {
    resolved(): string {
      return this.settingsStore.resolveFontName(this.modelValue);
    },
    isMissing(): boolean {
      return this.resolved.toLowerCase() !== this.modelValue.toLowerCase();
    },
    missingMessage(): string {
      return `“${this.modelValue}” isn't uploaded, so “${this.resolved}” is drawn instead. Upload it in the Files tab.`;
    },
  },
  methods: {
    pick(name: string) {
      this.$emit("update:modelValue", name);
      const face = this.settingsStore.fontFace(name);
      if (face) {
        this.$emit("face-switches", faceSwitches(face));
      }
    },
  },
});
</script>
