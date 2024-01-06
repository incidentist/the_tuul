<template>
  <b-tab-item
    label="Submit"
    icon="blender"
    class="submit-tab scroll-wrapper"
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
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip>
          </template>
          <b-switch expanded v-model="videoOptions.addCountIns"></b-switch
        ></b-field>
        <b-field horizontal>
          <template #label>
            Add Instrumental Breaks
            <b-tooltip label="Add screens that count down long instrumentals">
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip> </template
          ><b-switch
            expanded
            v-model="videoOptions.addInstrumentalScreens"
          ></b-switch
        ></b-field>
        <b-field horizontal>
          <template #label>
            Show Fast Lines Early
            <b-tooltip
              label="Show the first few lines of a screen early if it starts right after the previous screen ends"
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip> </template
          ><b-switch
            expanded
            v-model="videoOptions.addStaggeredLines"
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
          <b-field horizontal label="Font">
            <b-select v-model="videoOptions.font.name">
              <option
                v-for="(path, name) in fonts"
                :key="path"
                :value="name"
                :selected="name == videoOptions.font.name"
              >
                {{ name }}
              </option>
            </b-select>
          </b-field>
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
          :fonts="fonts"
          :background-color="videoOptions.color.background.toString()"
          :video-blob="videoBlob"
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
          @click="createVideo"
          :disabled="!enabled && !isSubmitting"
        >
          Create Video
        </b-button>
      </div>
      <b-message
        :active="isSubmitting"
        type="is-success"
        has-icon
        icon="wand-magic-sparkles"
      >
        Creating your karaoke video. This might take a few minutes.
      </b-message>
      <b-message
        :active="Boolean(submitError)"
        type="is-danger"
        has-icon
        icon="circle-exclamation"
      >
        There was a problem making your video: {{ submitError }}. Try again? Or
        email me?
      </b-message>
    </div>
  </b-tab-item>
</template>

<script lang="ts">
import * as _ from "lodash";
import { defineComponent } from "vue";
import { createAssFile, createScreens } from "@/lib/timing";
import VideoPreview from "@/components/VideoPreview.vue";
import Color from "buefy/src/utils/color";
import jszip from "jszip";
import audio from "@/lib/audio";
import video from "@/lib/video";

const fonts = {
  "Andale Mono": "/static/fonts/AndaleMono.ttf",
  Arial: "/static/fonts/Arial.ttf",
  "Arial Narrow": "/static/fonts/ArialNarrow.ttf",
  "Comic Sans": "/static/fonts/ComicSans.ttf",
  "Courier New": "/static/fonts/CourierNew.ttf",
  Georgia: "/static/fonts/Georgia.ttf",
  Impact: "/static/fonts/Impact.ttf",
  "Metal Mania": "/static/fonts/MetalMania.ttf",
  "Times New Roman": "/static/fonts/TimesNewRoman.ttf",
  Trebuchet: "/static/fonts/Trebuchet.ttf",
  Verdana: "/static/fonts/Verdana.ttf",
  "Liberation Sans": "/static/default.woff2",
};

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
      fonts,
      isSubmitting: false,
      videoOptions: {
        addCountIns: true,
        addInstrumentalScreens: true,
        addStaggeredLines: true,
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
      submitError: null,
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
    videoBlob() {
      return this.songInfo.videoBlob;
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
      return `${this.videoFileName}.zip`;
    },
    videoFileName(): string {
      if (this.songInfo.artist && this.songInfo.title) {
        return `${this.songInfo.artist} - ${this.songInfo.title} [karaoke].mp4`;
      }
      return "karaoke.mp4";
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
    async createVideo() {
      this.isSubmitting = true;
      const accompanimentDataUrl = await audio.separateTrack(this.songFile);
      const videoFile: Uint8Array = await video.createVideo(
        accompanimentDataUrl,
        this.videoBlob,
        this.subtitles,
        this.audioDelay,
        this.videoOptions,
        fonts
      );
      this.zipAndSendFiles(videoFile);
      this.isSubmitting = false;
    },

    async sendZipFile(zipFile: Blob) {
      const anchor = document.createElement("a");
      const filename = this.zipFileName;

      anchor.style.display = "none";
      anchor.href = URL.createObjectURL(zipFile);
      anchor.download = filename;
      anchor.click();
    },
    async zipAndSendFiles(videoBlob: Uint8Array) {
      var zip = new jszip();
      zip.file(this.videoFileName, videoBlob);
      zip.file("subtitles.ass", this.subtitles);
      zip.file("lyrics.txt", this.lyricText);
      zip.file("timings.json", JSON.stringify(this.timings));

      const zipBlob = await zip.generateAsync({ type: "blob" });
      this.sendZipFile(zipBlob);
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