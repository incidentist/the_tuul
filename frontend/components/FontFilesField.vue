<template>
  <div class="font-files-field">
    <b-field>
      <template #label>
        Font Files
        <viewport-tooltip
          wide
          label="Your own .ttf or .otf files, several at once if you like. Each face then appears in the font menus of the Submit tab."
        >
          <b-icon size="is-small" icon="circle-question"></b-icon>
        </viewport-tooltip>
      </template>
      <b-upload
        ref="upload"
        name="font-files-upload"
        aria-label="Font files"
        multiple
        drag-drop
        expanded
        :accept="ACCEPTED_FONT_FILES"
        :model-value="picked"
        @update:model-value="onSelect"
      >
        <div class="font-files-drop">
          <b-icon icon="upload"></b-icon>
          <span>Drop font files here, or click to choose them</span>
        </div>
      </b-upload>
    </b-field>
    <ul
      v-if="settingsStore.fontFaces.length > 0"
      class="font-files-list"
      aria-label="Uploaded fonts"
    >
      <li v-for="face in settingsStore.fontFaces" :key="face.name">
        <span class="font-files-face">{{ face.name }}</span>
        <span class="font-files-file">{{ face.file.name }}</span>
        <b-button
          type="is-danger is-light"
          size="is-small"
          icon-left="trash-can"
          :aria-label="`Remove ${face.name}`"
          @click="settingsStore.removeFont(face.name)"
        />
      </li>
    </ul>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { BButton, BField, BIcon, BUpload } from "buefy";
import ViewportTooltip from "@/components/ViewportTooltip.vue";
import { useSettingsStore } from "@/stores/settings";

const ACCEPTED_FONT_FILES = ".ttf,.otf,.ttc";

/**
 * The uploaded fonts every font menu offers, with an upload that takes several files at once.
 */
export default defineComponent({
  components: { BButton, BField, BIcon, BUpload, ViewportTooltip },
  setup() {
    return { settingsStore: useSettingsStore(), ACCEPTED_FONT_FILES };
  },
  data() {
    return {
      // b-upload appends picked files to its model, so it gets a fresh empty one after each pick.
      picked: [] as File[],
    };
  },
  methods: {
    async onSelect(files: File[] | File | null) {
      this.picked = [];
      (this.$refs.upload as { clearInput?: () => void } | undefined)?.clearInput?.();
      const list = Array.isArray(files) ? files : files ? [files] : [];
      if (list.length === 0) {
        return;
      }
      const { added, failed } = await this.settingsStore.addFonts(list);
      if (added.length > 0) {
        this.$buefy.toast.open({
          message:
            added.length === 1 ? `Added “${added[0].name}”.` : `Added ${added.length} fonts.`,
          type: "is-success",
          duration: 2000,
        });
      }
      if (failed.length > 0) {
        this.$buefy.toast.open({
          message: failed.map(({ file, error }) => `${file.name}: ${error.message}`).join(" "),
          type: "is-danger",
          duration: 5000,
        });
      }
    },
  },
});
</script>

<style scoped>
.font-files-drop {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
}

.font-files-list {
  width: 100%;
  text-align: left;
}

.font-files-list li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.125rem 0;
}

.font-files-face {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.font-files-file {
  color: #7a7a7a;
  font-size: 0.85rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
