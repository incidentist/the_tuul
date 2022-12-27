<template>
  <textarea
    class="textarea is-flex-grow-1"
    :value="value"
    @input="onLyricInput"
    ref="lyricInput"
  ></textarea>
</template>

<script>
import {
  getCurrentWord,
  slashifyAllOccurences,
  convertSpacesToUnderscores,
} from "@/lib/lyrics.ts";

export default {
  props: {
    value: String,
    magicSlashes: {
      type: Boolean,
      default: true,
    },
  },
  methods: {
    onLyricInput(e) {
      // TODO: Also update on slash removal
      // TODO: update on pasted text and bulk-removed text
      this.$emit("input", e.target.value);
      if (this.magicSlashes && this.isSlashEntry(e)) {
        const input = e.target;
        const currentPosition = input.selectionStart;
        const selectionEnd = input.selectionEnd;
        const currentText = input.value;
        const currentWord = getCurrentWord(currentText, currentPosition);
        const newValue = slashifyAllOccurences(
          this.value,
          currentWord.replaceAll("/", ""),
          currentWord
        );
        this.$emit("input", newValue);
        // Normally the cursor goes to the end of the text when we update the value,
        // so we set it back to where it was
        this.$nextTick(() => {
          input.setSelectionRange(currentPosition, selectionEnd);
        });
      }
    },
    isSlashEntry(e) {
      // Return true if event is a user typing a slash
      return (
        e instanceof InputEvent && e.inputType == "insertText" && e.data == "/"
      );
    },
    convertSpaces() {
      // Convert spaces to underscores
      const input = this.$refs.lyricInput;
      const currentPosition = input.selectionStart;
      const selectionEnd = input.selectionEnd;
      const newValue = convertSpacesToUnderscores(this.value);
      this.$emit("input", newValue);
      this.$nextTick(() => {
        input.setSelectionRange(currentPosition, selectionEnd);
      });
    },
  },
};
</script>

