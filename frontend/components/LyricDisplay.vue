<template>
  <div class="lyric-display box">
    <span class="completed-lyrics">{{ completedLyrics }}</span
    ><span ref="currentLyrics" class="current-lyrics">{{ currentLyrics }}</span
    ><span class="upcoming-lyrics">{{ upcomingLyrics }}</span>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  props: {
    lyricSegments: Array,
    currentSegment: Number,
  },
  watch: {
    currentSegment: "onCurrentLyricsChange",
  },
  computed: {
    completedLyrics() {
      return this.lyricSegments
        .slice(0, this.currentSegment)
        .map(this.wrapLyricSegment)
        .join("");
    },
    currentLyrics() {
      if (this.currentSegment in this.lyricSegments) {
        return this.wrapLyricSegment(this.lyricSegments[this.currentSegment]);
      }
      return "";
    },
    upcomingLyrics() {
      return this.lyricSegments
        .slice(this.currentSegment + 1)
        .map(this.wrapLyricSegment)
        .join("");
    },
  },
  methods: {
    wrapLyricSegment(segment) {
      return segment.text;
    },
    onCurrentLyricsChange() {
      this.$refs.currentLyrics.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    },
  },
});
</script>

<style scoped>
.lyric-display {
  white-space: pre;
  flex-shrink: 1;
  overflow-y: scroll;
}

.completed-lyrics {
  color: gray;
}

.current-lyrics {
  color: magenta;
}

span.upcoming-lyrics {
  color: blue;
}
</style>