<template>
  <div class="style-override-fields">
    <b-field horizontal label="Font">
      <b-select expanded v-model="fontName">
        <option v-for="(path, name) in fonts" :key="path" :value="name">{{ name }}</option>
      </b-select>
    </b-field>
    <slot name="font" />
    <b-field horizontal label="Font Size">
      <b-numberinput
        expanded
        :model-value="fontSize"
        @update:model-value="(v: number | null | undefined) => (fontSize = Number(v ?? fontSize))"
        controls-position="compact"
      />
    </b-field>
    <b-field horizontal label="Bold">
      <b-switch v-model="bold" />
    </b-field>
    <b-field horizontal label="Italic">
      <b-switch v-model="italic" />
    </b-field>
    <b-field horizontal label="Primary Color">
      <color-field v-model="primary" :label="`${name} primary color`" />
    </b-field>
    <b-field v-if="withSecondary" horizontal label="Secondary Color">
      <color-field v-model="secondary" :label="`${name} secondary color`" />
    </b-field>
    <b-field horizontal label="Outline Width">
      <b-numberinput
        expanded
        :model-value="outlineWidth"
        :min="0"
        :step="0.5"
        :min-step="0.1"
        @update:model-value="
          (v: number | null | undefined) => (outlineWidth = Number(v ?? outlineWidth))
        "
        controls-position="compact"
      />
    </b-field>
    <b-field v-if="outlineWidth > 0" horizontal label="Outline Color">
      <color-field v-model="outline" :label="`${name} outline color`" />
    </b-field>
    <b-field horizontal label="Shadow Offset X">
      <b-numberinput
        expanded
        :model-value="shadowX"
        :step="0.5"
        :min-step="0.1"
        @update:model-value="(v: number | null | undefined) => (shadowX = Number(v ?? shadowX))"
        controls-position="compact"
      />
    </b-field>
    <b-field horizontal label="Shadow Offset Y">
      <b-numberinput
        expanded
        :model-value="shadowY"
        :step="0.5"
        :min-step="0.1"
        @update:model-value="(v: number | null | undefined) => (shadowY = Number(v ?? shadowY))"
        controls-position="compact"
      />
    </b-field>
    <b-field v-if="shadowX !== 0 || shadowY !== 0" horizontal label="Shadow Color">
      <color-field v-model="shadow" :label="`${name} shadow color`" />
    </b-field>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { BField, BSelect, BNumberinput, BSwitch } from "buefy";
import { default as BuefyColor } from "buefy/src/utils/color";
import ColorField from "@/components/ColorField.vue";
import { KaraokeOptions } from "@/lib/timing";
import { defaultEffectColor, VoiceStyleOverride } from "@/lib/voiceStyle";

/**
 * The fields of a style override, each showing the base style's value until it is set.
 */
export default defineComponent({
  components: { BField, BSelect, BNumberinput, BSwitch, ColorField },
  props: {
    override: { type: Object as PropType<VoiceStyleOverride>, required: true },
    base: { type: Object as PropType<KaraokeOptions>, required: true },
    fonts: { type: Object as PropType<Record<string, string>>, required: true },
    // What the override styles, which names its color fields for screen readers.
    name: { type: String, required: true },
    withSecondary: { type: Boolean, default: true },
  },
  emits: {
    set: <K extends keyof VoiceStyleOverride>(_field: K, _value: VoiceStyleOverride[K]) => true,
  },
  computed: {
    fontName: {
      get(): string {
        return this.override.fontName ?? this.base.font.name;
      },
      set(value: string) {
        this.$emit("set", "fontName", value);
      },
    },
    fontSize: {
      get(): number {
        return this.override.fontSize ?? this.base.font.size;
      },
      set(value: number) {
        this.$emit("set", "fontSize", value);
      },
    },
    bold: {
      get(): boolean {
        return this.override.bold ?? this.base.font.bold ?? true;
      },
      set(value: boolean) {
        this.$emit("set", "bold", value);
      },
    },
    italic: {
      get(): boolean {
        return this.override.italic ?? this.base.font.italic ?? false;
      },
      set(value: boolean) {
        this.$emit("set", "italic", value);
      },
    },
    primary: {
      get(): BuefyColor {
        return this.override.primary ?? this.base.color.primary;
      },
      set(value: BuefyColor) {
        this.$emit("set", "primary", value);
      },
    },
    secondary: {
      get(): BuefyColor {
        return this.override.secondary ?? this.base.color.secondary;
      },
      set(value: BuefyColor) {
        this.$emit("set", "secondary", value);
      },
    },
    outline: {
      get(): BuefyColor {
        return this.override.outline ?? this.base.color.outline ?? defaultEffectColor();
      },
      set(value: BuefyColor) {
        this.$emit("set", "outline", value);
      },
    },
    outlineWidth: {
      get(): number {
        return this.override.outlineWidth ?? this.base.outlineWidth;
      },
      set(value: number) {
        this.$emit("set", "outlineWidth", value);
      },
    },
    shadow: {
      get(): BuefyColor {
        return this.override.shadow ?? this.base.color.shadow ?? defaultEffectColor();
      },
      set(value: BuefyColor) {
        this.$emit("set", "shadow", value);
      },
    },
    shadowX: {
      get(): number {
        return this.override.shadowX ?? this.base.shadowX;
      },
      set(value: number) {
        this.$emit("set", "shadowX", value);
      },
    },
    shadowY: {
      get(): number {
        return this.override.shadowY ?? this.base.shadowY;
      },
      set(value: number) {
        this.$emit("set", "shadowY", value);
      },
    },
  },
});
</script>
