<template>
  <div class="is-size-7 has-text-centered has-text-gray">
    <span>Source files: </span>
    lyrics.txt
    <a @click="download(lyrics, 'lyrics.txt')" title="download"
      ><b-icon icon="download" /></a
    ><a @click="copyToClipboard(lyrics)" title="copy to clipboard"
      ><b-icon icon="copy"
    /></a>
    &bullet; timings.json
    <a @click="download(timings, 'timings.json')" title="download"
      ><b-icon icon="download" /></a
    ><a @click="copyToClipboard(timings)" title="copy to clipboard"
      ><b-icon icon="copy"
    /></a>
    &bullet; subtitles.ass
    <a @click="download(subtitles, 'subtitles.ass')" title="download"
      ><b-icon icon="download" /></a
    ><a @click="copyToClipboard(subtitles)" title="copy to clipboard"
      ><b-icon icon="copy"
    /></a>
  </div>
</template>

<script lang="ts">
import { isString } from "lodash";
import Vue, { defineComponent } from "vue";
export default defineComponent({
  props: {
    lyrics: String,
    timings: Array,
    subtitles: String,
  },
  methods: {
    download(data, filename) {
      const text = isString(data) ? data : JSON.stringify(data);
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    async copyToClipboard(data) {
      const text = isString(data) ? data : JSON.stringify(data);
      // Copy data to clipboard
      try {
        await navigator.clipboard.writeText(text);
        this.$buefy.toast.open({
          message: "Copied!",
          type: "is-success",
        });
      } catch (e) {
        console.error(e);
        this.$buefy.toast.open({
          message: "Something went wrong while copying to clipboard!",
          type: "is-danger",
        });
      }
    },
  },
});
</script>