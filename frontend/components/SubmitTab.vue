<template>
  <b-tab-item
    label="Submit"
    icon="blender"
    class="submit-tab"
    :disabled="!enabled"
  >
    <div class="columns is-variable is-5">
      <div class="column settings-column">
        <h3 class="title">More Settings:</h3>
        <b-field horizontal>
          <template #label>
            Add Count-Ins
            <b-tooltip
              label="Add count-in dots so you know when to start singing"
            >
              <b-icon size="is-small" icon="question-circle"></b-icon>
            </b-tooltip>
          </template>
          <b-switch expanded v-model="videoOptions.addCountIns"></b-switch
        ></b-field>
        <b-field horizontal>
          <template #label>
            Add Instrumental Breaks
            <b-tooltip label="Add screens that count down long instrumentals">
              <b-icon size="is-small" icon="question-circle"></b-icon>
            </b-tooltip> </template
          ><b-switch
            expanded
            v-model="videoOptions.addInstrumentalScreens"
          ></b-switch
        ></b-field>
        <b-collapse :open="false">
          <template #trigger="props">
            <a aria-controls="contentIdForA11y4" :aria-expanded="props.open">
              Fonts and Colors
              <b-icon
                :icon="props.open ? 'angle-down' : 'angle-right'"
              ></b-icon>
            </a>
          </template>
          <b-field horizontal label="Font Size"
            ><b-numberinput
              v-model="videoOptions.font.size"
              controls-position="compact"
            ></b-numberinput
          ></b-field>
          <b-field horizontal label="Background Color"
            ><b-colorpicker v-model="videoOptions.color.background"
          /></b-field>
          <b-field horizontal label="Primary Color"
            ><b-colorpicker v-model="videoOptions.color.primary"
          /></b-field>
          <b-field horizontal label="Secondary Color"
            ><b-colorpicker v-model="videoOptions.color.secondary"
          /></b-field>
        </b-collapse>
      </div>
      <div class="column is-narrow">
        <h3 class="title">Video Preview:</h3>
        <video-preview
          v-if="enabled"
          :song-file="songFile"
          :subtitles="subtitles"
          :audio-delay="audioDelay"
          :background-color="videoOptions.color.background.toString()"
        />
      </div>
    </div>

    <div class="submit-button-container">
      <div class="buttons">
        <b-button
          expanded
          size="is-large"
          type="is-primary"
          :loading="isSubmitting"
          @click="submitTimings"
          :disabled="!enabled && !isSubmitting"
        >
          Create Video
        </b-button>
      </div>
      <b-message :active="isSubmitting" type="is-success" has-icon icon="magic">
        Creating your karaoke video. This might take a few minutes.
      </b-message>
    </div>
  </b-tab-item>
</template>

<script lang="ts">
import * as _ from "lodash";
import { defineComponent } from "vue";
import { createAssFile, createScreens, KaraokeOptions } from "@/lib/timing";
import { API_HOSTNAME } from "@/constants";
import VideoPreview from "@/components/VideoPreview.vue";
import Color from "buefy/src/utils/color";

export default defineComponent({
  components: { VideoPreview },
  props: {
    songInfo: Object,
    lyricText: String,
    timings: Array,
    enabled: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      isSubmitting: false,
      videoOptions: {
        addCountIns: true,
        addInstrumentalScreens: true,
        font: {
          size: 20,
          name: "Arial Narrow",
        },
        color: {
          background: Color.parse("black"),
          primary: Color.parse("#FF00FF"),
          secondary: Color.parse("#00FFFF"),
        },
      },
    };
  },
  mounted() {
    Object.assign(this.videoOptions, this.loadSettings());
  },
  watch: {
    videoOptions: {
      handler: function (newOptions) {
        this.saveSettings(newOptions);
      },
      deep: true,
    },
  },
  computed: {
    songFile() {
      return this.songInfo.file;
    },
    subtitles(): string {
      if (!this.enabled) {
        return "";
      }
      return createAssFile(
        this.lyricText,
        this.timings,
        this.songFile.duration,
        this.songInfo.title,
        this.songInfo.artist,
        this.videoOptions
      );
    },
    audioDelay(): number {
      if (!this.enabled) {
        return 0;
      }
      const screens = createScreens(
        this.lyricText,
        this.timings,
        this.songFile.duration,
        this.songInfo.title,
        this.songInfo.artist,
        this.videoOptions
      );
      return _.sum(_.map(screens, "audioDelay"));
    },
    zipFileName(): string {
      if (this.songInfo.artist && this.songInfo.title) {
        return `${this.songInfo.artist} - ${this.songInfo.title} [karaoke].mp4.zip`;
      }
      return "karaoke.mp4.zip";
    },
  },
  methods: {
    loadSettings(): Object {
      try {
        const options = JSON.parse(localStorage.videoOptions || "{}");
        options.color.background = Color.parseObject(options.color.background);
        options.color.primary = Color.parseObject(options.color.primary);
        options.color.secondary = Color.parseObject(options.color.secondary);

        return options;
      } catch (e) {
        console.error(e);
        return {};
      }
    },
    saveSettings(settings: Object) {
      localStorage.videoOptions = JSON.stringify(settings);
    },
    async submitTimings() {
      this.isSubmitting = true;
      const formData = new FormData();
      formData.append("lyrics", this.lyricText);
      formData.append("timings", JSON.stringify(this.timings));
      formData.append("songFile", this.songFile);
      formData.append("songArtist", this.songInfo.artist);
      formData.append("songTitle", this.songInfo.title);
      formData.append("subtitles", this.subtitles);
      formData.append("audioDelay", this.audioDelay);
      formData.append("backgroundColor", this.videoOptions.color.background);

      const url = `${API_HOSTNAME}/generate_video`;

      const response = await fetch(url, {
        method: "POST",
        body: formData,
      });
      this.isSubmitting = false;
      await this.saveZipFile(response);
    },
    async saveZipFile(response) {
      console.log(response);
      const filename = this.zipFileName;
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onload = (e) => {
        const anchor = document.createElement("a");
        anchor.style.display = "none";
        anchor.href = URL.createObjectURL(blob);
        anchor.download = filename;
        anchor.click();
      };
      reader.readAsDataURL(blob);
    },
  },
});
</script>
<style>
/* .fit-content {
  width: max-content;
} */
.field.is-horizontal .field-label {
  flex-grow: 3;
}
</style>
<style scoped>
.submit-tab {
  overflow-x: hidden;
  overflow-y: auto;
}

.settings-column {
  margin: 0 10%;
}

.submit-tab column {
  text-align: center;
}
</style>