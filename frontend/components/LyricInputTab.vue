<template>
  <b-tab-item label="Lyrics" icon="align-left" class="lyric-input-tab">
    <h2 class="title">Song Lyrics</h2>
    <p>
      Paste 'em from the Internet! A blank line indicates a new screen. By
      default, you'll enter the timing of each line. Use <kbd>_</kbd> to enter a
      timing of a word or <kbd>/</kbd> to enter a timing of a syllable. Example:
    </p>
    <p>
      <code
        >Hell/o_from_the_oth/er_side<br />I_must_have_called_a_thou/sand_times</code
      >
    </p>
    <div class="level is-mobile">
      <div class="level-item">
        <b-checkbox
          type="is-primary"
          v-model="magicSlashes"
          @click="magicSlashes = !magicSlashes"
        >
          <b-tooltip
            multilined
            label="Adding a slash to a word will add the same slash to all instances of that word"
            position="is-right"
            dashed
            >Magic Slashes</b-tooltip
          ></b-checkbox
        >
      </div>
    </div>
    <lyric-editor
      :value="value"
      :magic-slashes="magicSlashes"
      @input="onLyricInput"
    ></lyric-editor>
  </b-tab-item>
</template>

<script>
import LyricEditor from "@/components/LyricEditor.vue";

export default {
  components: {
    LyricEditor,
  },
  props: {
    value: String,
  },
  data() {
    return {
      magicSlashes: true,
    };
  },
  methods: {
    onLyricInput(newValue) {
      this.$emit("input", newValue);
    },
  },
};
</script>

<style scoped>
.lyric-input-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
}
</style>