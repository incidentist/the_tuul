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
      :name="label"
      :with-secondary="withSecondary"
      @set="(field, value) => $emit('set', field, value)"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { BField, BIcon, BSwitch } from "buefy";
import StyleOverrideFields from "@/components/StyleOverrideFields.vue";
import ViewportTooltip from "@/components/ViewportTooltip.vue";
import { KaraokeOptions } from "@/lib/timing";
import { VoiceStyleOverride, isEmptyOverride } from "@/lib/voiceStyle";

/**
 * A switch that turns on a style override of the base style, with the override's fields.
 */
export default defineComponent({
  components: { BField, BIcon, BSwitch, StyleOverrideFields, ViewportTooltip },
  props: {
    label: { type: String, required: true },
    tooltip: { type: String, default: "" },
    override: { type: Object as PropType<VoiceStyleOverride>, required: true },
    base: { type: Object as PropType<KaraokeOptions>, required: true },
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
      get(): boolean {
        return this.expanded;
      },
      set(on: boolean) {
        this.expanded = on;
        if (!on) {
          this.$emit("clear");
        }
      },
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
