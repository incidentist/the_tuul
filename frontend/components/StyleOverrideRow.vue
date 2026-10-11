<template>
  <div class="style-override-row">
    <b-field horizontal>
      <template #label>
        {{ label }}
        <viewport-tooltip v-if="tooltip" wide :label="tooltip">
          <b-icon size="is-small" icon="circle-question"></b-icon>
        </viewport-tooltip>
      </template>
      <b-switch v-model="customizing">Custom style</b-switch>
    </b-field>
    <style-override-fields
      v-if="customizing"
      class="style-override-row-fields"
      :override="override"
      :base="base"
      :fonts="fonts"
      :name="label"
      :with-secondary="withSecondary"
      @set="(field, value) => $emit('set', field, value)"
    >
      <template #font>
        <b-field horizontal label="Custom Font">
          <file-upload
            expanded
            class="style-font-upload"
            :accept="['.ttf', '.otf', '.ttc']"
            :model-value="customFont?.file ?? null"
            @update:model-value="onCustomFontChange"
          />
        </b-field>
        <b-field horizontal v-if="customFont">
          <p class="help style-font-help">
            Rendering {{ subject }} in &ldquo;{{ customFont.family }}&rdquo;, overriding the font
            above.
          </p>
        </b-field>
      </template>
    </style-override-fields>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { BField, BIcon, BSwitch } from "buefy";
import FileUpload from "@/components/FileUpload.vue";
import StyleOverrideFields from "@/components/StyleOverrideFields.vue";
import ViewportTooltip from "@/components/ViewportTooltip.vue";
import { KaraokeOptions } from "@/lib/timing";
import { VoiceStyleOverride, isEmptyOverride } from "@/lib/voiceStyle";

/**
 * A switch that turns on a style override of the base style, with the override's fields and a
 * font upload of its own.
 */
export default defineComponent({
  components: { BField, BIcon, BSwitch, FileUpload, StyleOverrideFields, ViewportTooltip },
  props: {
    label: { type: String, required: true },
    // What the style draws, as the help and toast sentences name it.
    subject: { type: String, required: true },
    tooltip: { type: String, default: "" },
    override: { type: Object as PropType<VoiceStyleOverride>, required: true },
    base: { type: Object as PropType<KaraokeOptions>, required: true },
    fonts: { type: Object as PropType<Record<string, string>>, required: true },
    customFont: Object as PropType<{ file: File; family: string }>,
    // Throws when the file is no readable font.
    setCustomFont: {
      type: Function as PropType<(file: File | null) => Promise<void>>,
      required: true,
    },
    withSecondary: { type: Boolean, default: true },
  },
  emits: {
    set: (_field: keyof VoiceStyleOverride, _value: VoiceStyleOverride[keyof VoiceStyleOverride]) =>
      true,
    clear: () => true,
  },
  data() {
    return {
      // Expanded when there already is an override, toggled by the switch otherwise.
      expanded: !isEmptyOverride(this.override),
    };
  },
  computed: {
    customizing: {
      // A saved font loads after the row mounts, so it can't only count towards the initial state.
      get(): boolean {
        return this.expanded || this.customFont !== undefined;
      },
      set(on: boolean) {
        this.expanded = on;
        if (!on) {
          this.$emit("clear");
        }
      },
    },
  },
  methods: {
    async onCustomFontChange(file: File | null) {
      try {
        await this.setCustomFont(file);
        // The font comes back down as a prop, which waits for the parent's next render.
        await this.$nextTick();
        if (file) {
          this.$buefy.toast.open({
            message: `Using "${this.customFont?.family}" for ${this.subject}.`,
            type: "is-success",
            duration: 2000,
          });
        }
      } catch (e) {
        console.error(e);
        this.$buefy.toast.open({
          message: (e as Error).message,
          type: "is-danger",
          duration: 5000,
        });
      }
    },
  },
});
</script>

<style scoped>
.style-override-row {
  border-top: 1px solid #ededed;
  padding-top: 0.5rem;
  margin-top: 0.5rem;
}

.style-override-row-fields {
  margin-left: 1rem;
}
</style>
