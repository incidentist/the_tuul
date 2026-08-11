<template>
  <b-tab-item :class="['song-info-tab', 'scroll-wrapper']" headerClass="song-info-tab-header">
    <template #header>
      <b-icon v-if="!isSeparatingTrack" icon="file-audio"></b-icon>
      <b-tooltip v-else label="Separating track" position="is-bottom"><span class="icon is-small loader"></span>
      </b-tooltip>
      <span> Backing Track</span>
    </template>
    <div class="container">
      <h2 class="title">Get Your Song Ready</h2>
      <file-upload name="song-file-upload" label="Upload a file from your computer:"
        v-model="mediaStore.songFile"></file-upload>
      <b-field label="Or paste a YouTube video URL:" :type="youtubeError ? 'is-danger' : ''">
        <template #message>
          <span v-html="youtubeError"></span>
        </template>
        <b-input type="text" v-model="mediaStore.youtubeUrl" />
        <b-button label="Load" :type="mediaStore.youtubeUrl ? 'is-primary' : 'is-light'"
          :disabled="!mediaStore.youtubeUrl" @click="loadYouTubeUrl" :loading="isLoadingYouTube" />
      </b-field>
      <b-field label="Song Artist">
        <b-input name="artist" v-model="mediaStore.songArtist" />
      </b-field>
      <b-field label="Song Title">
        <b-input name="title" v-model="mediaStore.songTitle" />
      </b-field>
      <b-field horizontal label="Include Backing Vocals" class="backing-vocals-toggle">
        <b-switch v-model="includeBackingVocals"></b-switch></b-field>
    </div>

    <b-collapse :open="false">
      <template #trigger="props">
        <b-button type="is-text" aria-controls="contentIdForA11y4" :aria-expanded="props.open">
          <span>Advanced</span>
          <b-icon :icon="props.open ? 'angle-down' : 'angle-right'"></b-icon>
        </b-button>
      </template>
      <div class="box">
        <file-upload name="timings-file-upload" :accept="['.json']" label="Timings File" v-model="timingsFile"
          @update:modelValue="onTimingsFileChange" />
        <file-upload label="Backing Track" :modelValue="backingTrackFile"
          @update:modelValue="onBackingTrackFileChange" />
      </div>
    </b-collapse>
    <div class="buttons" v-if="!isBackingTrackUserUploaded">
      <b-tooltip position="is-right" :label="separatingTrackMessage" :always="isSeparatingTrack">
        <b-button label="Separate Track" type="is-primary" :disabled="!mediaStore.songFile" :loading="isSeparatingTrack"
          @click="separateTrack" />
      </b-tooltip>
    </div>
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { fetchYouTubeVideo, parseYouTubeTitle } from "@/lib/video";

import {
  useMediaStore,
  BACKING_VOCALS_SEPARATOR_MODEL,
  NO_VOCALS_SEPARATOR_MODEL,
} from "@/stores/media";
import { useTimingsStore } from "@/stores/timings";
import FileUpload from "@/components/FileUpload.vue";

export default defineComponent({
  components: {
    FileUpload,
  },
  setup() {
    const mediaStore = useMediaStore();
    const timingsStore = useTimingsStore();
    return {
      mediaStore,
      timingsStore,
    };
  },
  data() {
    return {
      isLoadingYouTube: false,
      timingsFile: null,
      youtubeError: null,
    };
  },
  computed: {
    backingTrackFile() {
      return this.mediaStore.separatedTrack?.backing || null;
    },
    isBackingTrackUserUploaded() {
      return this.mediaStore.isBackingTrackUserUploaded;
    },
    isSeparatingTrack() {
      return this.mediaStore.isProcessing;
    },
    separatingTrackMessage() {
      if (this.isSeparatingTrack) {
        return "Separating track...head to the Lyrics tab to keep working on the song!";
      }
      return "Start separating the track while you work on the song timings. It's faster!";
    },
    includeBackingVocals: {
      get() {
        return this.mediaStore.separationModel == BACKING_VOCALS_SEPARATOR_MODEL;
      },
      set(value) {
        this.mediaStore.separationModel = value
          ? BACKING_VOCALS_SEPARATOR_MODEL
          : NO_VOCALS_SEPARATOR_MODEL;
      },
    },
  },
  methods: {
    async loadYouTubeUrl() {
      this.isLoadingYouTube = true;
      this.youtubeError = null;
      try {
        const [audioBlob, videoBlob, metadata] = await fetchYouTubeVideo(
          this.mediaStore.youtubeUrl
        );
        this.mediaStore.songFile = new File([audioBlob], "audio.mp4", {
          type: "audio/mp4",
        });
        const parsedMetadata = parseYouTubeTitle(metadata);
        this.mediaStore.songArtist = parsedMetadata[0];
        this.mediaStore.songTitle = parsedMetadata[1];

        // Update the media store
        this.mediaStore.backgroundVideo = videoBlob;
      } catch (e) {
        console.error(e);
        let errorMessage = e.message;

        // Try to extract the detail from JSON error responses
        try {
          const errorObj = JSON.parse(errorMessage);
          if (errorObj.detail) {
            errorMessage = errorObj.detail;
          }
        } catch (parseError) {
          // If it's not JSON, use the original message
        }

        this.youtubeError = `There was a problem downloading that video: ${errorMessage}. Please try again or use a service such as <a href="https://v2.youconvert.net/en/">YouConvert</a> to get the audio and add it above.`;
      }
      this.isLoadingYouTube = false;
    },
    onTimingsFileChange(file: File | null) {
      if (!file) {
        this.timingsStore.resetTimings([]);
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const timings = JSON.parse(e.target.result.toString());
        this.timingsStore.resetTimings(timings);
      };
      reader.readAsText(file);
    },
    onSeparationModelChange(model) {
      this.mediaStore.separationModel = model;
    },
    onBackingTrackFileChange(file: File | null) {
      this.mediaStore.setBackingTrack(file);
    },
    async separateTrack() {
      const model = this.mediaStore.separationModel;
      this.mediaStore.startSeparation(this.mediaStore.songFile, model);
    },
  },
});
</script>
<style scoped>
.song-info-tab {
  overflow-x: hidden;
  overflow-y: auto;
}

.backing-vocals-toggle :deep(.field-label) {
  text-align: left !important;
  flex-grow: 0 !important;
  flex-basis: fit-content;
}
</style>
