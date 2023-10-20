<template>
  <div class="buttons">
    <b-button @mousedown="fireSpacebar">Spacebar</b-button>
    <b-button @mousedown="fireEnter">Enter</b-button>
  </div>
</template>

<script lang="ts">
// Shows buttons for submitting timing info, in case of a mobile device without a hardware keyboard

import { KEY_CODES } from "@/constants";
import Vue from "vue";
export default Vue.extend({
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