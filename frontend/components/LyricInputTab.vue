<template>
  <b-tab-item label="Lyrics" icon="align-left" class="lyric-input-tab" headerClass="lyric-input-tab-header">
    <h2 class="title">Song Lyrics</h2>
    <div class="content">
      <p>
        Paste 'em from the Internet! A blank line indicates a new screen. By
        default, you'll enter the timing of each line. Use <kbd>_</kbd> to enter
        a timing of a word or <kbd>/</kbd> to enter a timing of a syllable.
        To time every word without adding underscores yourself, check
        <em>Sync Each Word</em> on the Song Timing tab. Example:
      </p>
      <p>
        <code>Hell/o_from_the_oth/er_side<br />I_must_have_called_a_thou/sand_times</code>
      </p>
    </div>
    <div class="level is-mobile">
      <div class="level-item">
        <b-tooltip position="is-right" label="Convert all spaces to underscores">
          <b-button @click="convertSpaces">Add Underscores</b-button></b-tooltip>
      </div>
      <div class="level-item">
        <b-checkbox type="is-primary" v-model="magicSlashes">
          <b-tooltip multilined label="Adding a slash to a word will add the same slash to all instances of that word"
            position="is-right" dashed>Magic Slashes</b-tooltip></b-checkbox>
      </div>
    </div>
    <lyric-editor ref="lyricEditor" :modelValue="lyricText" :magic-slashes="magicSlashes"
      @update:modelValue="onLyricInput"></lyric-editor>
  </b-tab-item>
</template>

<script>
import { defineComponent } from "vue";
import { storeToRefs } from "pinia";
import { useLyricsStore } from "@/stores/lyrics";
import LyricEditor from "@/components/LyricEditor.vue";

export default defineComponent({
  components: {
    LyricEditor,
  },
  setup() {
    const lyricStore = useLyricsStore();
    const { lyricText } = storeToRefs(lyricStore);
    return {
      lyricText,
    };
  },
  data() {
    return {
      magicSlashes: true,
    };
  },
  methods: {
    onLyricInput(newValue) {
      this.lyricText = newValue;
    },
    convertSpaces(e) {
      this.$refs.lyricEditor.convertSpaces();
    },
  },
});
</script>

<style scoped>
.lyric-input-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
}
</style>