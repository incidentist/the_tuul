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
    <textarea class="textarea is-flex-grow-1" @input="onLyricInput"></textarea>
  </b-tab-item>
</template>

<script>
export default {
  props: {
    value: String,
  },
  methods: {
    onLyricInput(e) {
      this.$emit("input", e.target.value);
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