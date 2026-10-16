<template>
  <div v-if="files.length" class="is-size-7 has-text-centered has-text-gray source-file-links">
    <span>{{ label }}</span>
    <span v-for="(file, index) in files" :key="index" class="file-item">
      <button type="button" class="link-button" @click="download(file.data, file.name)">
        {{ file.name }}
      </button>
    </span>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { projectBackgroundEntryName, trackEntries } from "@/lib/projectFolder";
import type { TrackPair } from "@/stores/media";

export default defineComponent({
  props: {
    // The trailing space is load-bearing: template whitespace before the first file is stripped at compile time.
    label: { type: String, default: "Source files: " },
    song: File,
    lyrics: String,
    timings: String,
    subtitles: String,
    settings: String,
    fonts: { type: Array as PropType<File[]>, default: () => [] },
    tracks: { type: Array as PropType<TrackPair[]>, default: () => [] },
    background: Blob,
  },
  computed: {
    files(): { name: string; data: Blob | string }[] {
      return [
        ...(this.song ? [{ name: this.song.name, data: this.song }] : []),
        ...(this.lyrics ? [{ name: "lyrics.txt", data: this.lyrics }] : []),
        ...(this.timings ? [{ name: "timings.txt", data: this.timings }] : []),
        ...(this.subtitles ? [{ name: "subtitles.ass", data: this.subtitles }] : []),
        ...(this.settings ? [{ name: "settings.yaml", data: this.settings }] : []),
        ...this.fonts.map((font) => ({ name: font.name, data: font })),
        ...trackEntries(this.tracks).map((track) => ({ name: track.name, data: track.blob })),
        ...(this.background
          ? [{ name: projectBackgroundEntryName(this.background), data: this.background }]
          : []),
      ];
    },
  },
  methods: {
    download(data: Blob | string, filename: string) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  },
});
</script>

<style scoped>
.source-file-links .file-item + .file-item::before {
  content: ", ";
}
</style>
