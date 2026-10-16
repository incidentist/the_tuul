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
      :override="settingsStore.getVoiceStyle(voice) ?? {}"
      :base="settingsStore.videoOptions"
      @set="(field, value) => settingsStore.setVoiceStyleField(voice, field, value)"
      @clear="settingsStore.clearVoiceStyle(voice)"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { storeToRefs } from "pinia";
import StyleOverrideRow from "@/components/StyleOverrideRow.vue";
import { useLyricsStore } from "@/stores/lyrics";
import { useSettingsStore } from "@/stores/settings";

export default defineComponent({
  components: { StyleOverrideRow },
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
