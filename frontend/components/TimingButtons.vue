<template>
  <div class="buttons">
    <b-button @mousedown="fireSpacebar">Spacebar</b-button>
    <b-button v-if="showEnter" @mousedown="fireEnter">Enter</b-button>
  </div>
</template>

<script lang="ts">
// Shows buttons for submitting timing info, in case of a mobile device without a hardware keyboard

import { KEY_CODES } from "@/constants";
import { defineComponent } from "vue";

export default defineComponent({
  props: {
    showEnter: {
      type: Boolean,
      default: true,
    },
  },
  methods: {
    fireSpacebar() {
      this.$emit(
        "keydown",
        new KeyboardEvent("keydown", {
          keyCode: KEY_CODES.SPACEBAR,
          code: "Space",
        })
      );
    },
    fireEnter() {
      this.$emit(
        "keydown",
        new KeyboardEvent("keydown", {
          keyCode: KEY_CODES.ENTER,
          code: "Enter",
        })
      );
    },
  },
});
</script>