<template>
  <div class="voice-style-settings">
    <p class="voice-style-intro">
      Each voice uses the styles above by default. Turn on a custom style to override the font,
      weight, or colors for that voice.
    </p>
    <style-override-row
      v-for="voice in voices"
      :key="voice"
      :label="voice"
      :subject="voice"
      :override="settingsStore.getVoiceStyle(voice) ?? {}"
      :base="settingsStore.videoOptions"
      :fonts="fonts"
      :custom-font="settingsStore.getVoiceFont(voice)"
      :set-custom-font="(file: File | null) => settingsStore.setVoiceFont(voice, file)"
      @set="(field, value) => settingsStore.setVoiceStyleField(voice, field, value)"
      @clear="settingsStore.clearVoiceStyle(voice)"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { storeToRefs } from "pinia";
import StyleOverrideRow from "@/components/StyleOverrideRow.vue";
import { useLyricsStore } from "@/stores/lyrics";
import { useSettingsStore } from "@/stores/settings";

export default defineComponent({
  components: { StyleOverrideRow },
  props: {
    fonts: {
      type: Object as PropType<Record<string, string>>,
      required: true,
    },
  },
  setup() {
    const lyricsStore = useLyricsStore();
    const { voices } = storeToRefs(lyricsStore);
    return { voices, settingsStore: useSettingsStore() };
  },
});
</script>

<style scoped>
.voice-style-intro {
  font-size: 0.9rem;
  margin-bottom: 0.75rem;
}
</style>
