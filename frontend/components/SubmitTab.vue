<template>
  <b-tab-item label="Submit" icon="blender" class="submit-tab">
    <div class="buttons">
      <b-button
        expanded
        type="is-primary"
        :loading="isSubmitting"
        @click="createMpeg"
        :disabled="!enabled && !isSubmitting"
      >
        Create Video
      </b-button>
    </div>
    <b-message :active="isSubmitting" type="is-success" has-icon icon="magic">
      Creating your karaoke video. This might take a few minutes.
    </b-message>
  </b-tab-item>
</template>

<script>
import { createAssFile, createScreens } from "@/lib/timing.ts";
import { TITLE_SCREEN_DURATION } from "@/constants.js";
import { createFFmpeg, fetchFile } from "@ffmpeg/ffmpeg";
import { readFileAsync } from "@/lib/util";

export default {
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
    };
  },
  computed: {
    songFile() {
      return this.songInfo.file;
    },
    subtitles() {
      return createAssFile(
        this.lyricText,
        this.timings,
        this.songFile.duration,
        this.songInfo.title,
        this.songInfo.artist
      );
    },
    audioDelay() {
      const screens = createScreens(
        this.lyricText,
        this.timings,
        this.songFile.duration,
        this.songInfo.title,
        this.songInfo.artist
      );
      return _.sum(_.map(screens, "audioDelay"));
    },
    zipFileName() {
      if (this.songInfo.artist && this.songInfo.title) {
        return `${this.songInfo.artist} - ${this.songInfo.title} [karaoke].mp4.zip`;
      }
      return "karaoke.mp4.zip";
    },
  },
  methods: {
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

      const response = await fetch("/generate_video", {
        method: "POST",
        body: formData,
      });
      this.isSubmitting = false;
      await this.saveZipFile(response);
    },
    async createMpeg() {
      const songFileName = "stuff.mp3";
      this.isSubmitting = true;
      const ffmpeg = createFFmpeg({ log: true });
      await ffmpeg.load();
      // Write audio to ffmpeg-wasm's filesystem
      await ffmpeg.FS(
        "writeFile",
        songFileName,
        new Uint8Array(await readFileAsync(this.songFile))
      );
      // Write the subtitle font to the filesystem
      await ffmpeg.FS(
        "writeFile",
        "Arial Narrow.ttf",
        await fetchFile("http://localhost:8000/static/ArialNarrow.ttf")
      );
      await ffmpeg.FS("writeFile", "subtitles.ass", this.subtitles);
      await ffmpeg.run(
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=1280x720:r=20",
        "-i",
        songFileName,
        // Add subtitles
        "-vf",
        "ass=subtitles.ass:fontsdir=./",
        "-shortest",
        "-y",
        "karaoke.mp4"
      );

      // video is a Uint8Array
      const video = await ffmpeg.FS("readFile", "karaoke.mp4");
      const anchor = document.createElement("a");
      const filename = this.zipFileName;

      anchor.style.display = "none";
      anchor.href = URL.createObjectURL(new Blob([video]));
      anchor.download = filename;
      anchor.click();
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
};
</script>

<style scoped>
.submit-tab {
  margin: auto;
}
</style>