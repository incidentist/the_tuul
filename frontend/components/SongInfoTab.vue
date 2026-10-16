<template>
  <b-tab-item
    value="song"
    :class="['song-info-tab', 'scroll-wrapper']"
    headerClass="song-info-tab-header"
  >
    <template #header>
      <b-icon v-if="!isSeparatingTrack" icon="file-audio"></b-icon>
      <viewport-tooltip v-else :label="separationHeaderLabel" position="is-bottom">
        <span v-if="separationProgress !== null" class="icon">
          <circular-progress :value="separationProgress" label="Track separation progress" />
        </span>
        <span v-else class="icon is-small loader"></span>
      </viewport-tooltip>
      <span> Files</span>
    </template>
    <h2 class="title">Files</h2>
    <div class="columns is-desktop is-variable is-5">
      <div class="column">
        <div class="box">
          <file-upload
            name="song-file-upload"
            label="Upload a file from your computer"
            tooltip="The full song, as audio or video. Its vocals are separated out to make the backing track."
            :model-value="mediaStore.songFile"
            @update:model-value="onSongFileSelect"
          ></file-upload>
          <b-field label="Or paste a YouTube video URL" :type="youtubeError ? 'is-danger' : ''">
            <template #message>
              <span v-html="youtubeError"></span>
            </template>
            <b-input
              type="text"
              :model-value="mediaStore.youtubeUrl ?? ''"
              @update:model-value="
                (v: string | number | undefined) => {
                  mediaStore.youtubeUrl = v == null ? null : String(v);
                }
              "
            />
            <b-button
              label="Load"
              :type="mediaStore.youtubeUrl ? 'is-primary' : 'is-light'"
              :disabled="!mediaStore.youtubeUrl"
              @click="loadYouTubeUrl"
              :loading="isLoadingYouTube"
            />
          </b-field>
          <b-field label="Song Artist">
            <b-input
              class="metadata-input"
              name="artist"
              @blur="lyricsLookupStore.lookUp()"
              :model-value="mediaStore.songArtist ?? ''"
              @update:model-value="
                (v: string | number | undefined) => {
                  mediaStore.songArtist = v == null ? null : String(v);
                }
              "
            />
          </b-field>
          <b-field label="Song Title">
            <b-input
              class="metadata-input"
              name="title"
              @blur="lyricsLookupStore.lookUp()"
              :model-value="mediaStore.songTitle ?? ''"
              @update:model-value="
                (v: string | number | undefined) => {
                  mediaStore.songTitle = v == null ? null : String(v);
                }
              "
            />
          </b-field>
          <b-field label="Separation Model" class="separation-model-field">
            <div class="separation-model-radios">
              <template v-for="group in SEPARATION_MODEL_GROUPS" :key="group.label">
                <div class="model-group-label">{{ group.label }}</div>
                <b-radio
                  v-for="entry in group.models"
                  :key="entry.model"
                  v-model="mediaStore.separationModel"
                  :native-value="entry.model"
                >
                  {{ entry.name }} <span class="hint">({{ entry.hint }})</span>
                  <span
                    v-if="mediaStore.trackPair(entry.model)"
                    class="separated-mark"
                    role="img"
                    aria-label="Already separated"
                    title="Already separated"
                  >
                    <b-icon icon="check" size="is-small" type="is-success" />
                  </span>
                </b-radio>
              </template>
            </div>
          </b-field>

          <div class="buttons">
            <viewport-tooltip
              position="is-right"
              :label="separatingTrackMessage"
              :always="isSeparatingTrack"
            >
              <b-button
                v-if="isSeparatingTrack"
                label="Cancel"
                type="is-danger is-light"
                :disabled="!canCancelSeparation"
                @click="cancelSeparation"
              />
              <b-button
                v-else
                label="Separate Track"
                type="is-primary"
                :disabled="!mediaStore.songFile || !!mediaStore.songTooLargeMessage"
                @click="separateTrack"
              />
            </viewport-tooltip>
            <span v-if="lastSeparation" :class="lastSeparation.class">
              {{ lastSeparation.message }}
            </span>
          </div>
          <div class="separation-progress" v-if="isSeparatingTrack">
            <b-progress
              type="is-primary"
              size="is-medium"
              :rounded="false"
              :value="separationPercent"
              show-value
            >
              {{ separationProgressMessage }}
            </b-progress>
          </div>
          <b-message
            v-if="mediaStore.songTooLargeMessage && !isSeparatingTrack"
            type="is-warning"
            has-icon
            icon="warning"
            icon-size="is-small"
            :closable="false"
          >
            {{ mediaStore.songTooLargeMessage }}
          </b-message>
          <b-message
            v-else-if="mediaStore.error && !isSeparatingTrack"
            type="is-danger"
            has-icon
            icon="warning"
            icon-size="is-small"
            :closable="false"
          >
            {{ mediaStore.error }}
          </b-message>
        </div>
      </div>

      <div class="column">
        <div class="box existing-files">
          <h3 class="title is-5">Restore existing files</h3>
          <folder-upload
            name="project-folder-upload"
            expanded
            label="Project Folder"
            tooltip="A folder of files downloaded from the Submit tab and extracted. Loads whichever of the song, lyrics, timings, settings, tracks and fonts are present."
            :folder-name="mediaStore.projectFolderName"
            @select="onProjectFolderSelect"
          />
          <file-upload
            expanded
            name="settings-file-upload"
            :accept="['.yaml', '.yml']"
            label="Settings File"
            tooltip="A settings.yaml exported from the Submit tab. Restores the video options, voice styles and song details."
            v-model="mediaStore.settingsFile"
            @update:modelValue="onSettingsFileChange"
          />
          <file-upload
            expanded
            name="lyrics-file-upload"
            :accept="['.txt', 'text/plain']"
            label="Lyrics File"
            tooltip="A plain text lyrics file. Its contents replaces what's in the Lyrics tab."
            :model-value="mediaStore.lyricsFile"
            @update:model-value="onLyricsFileSelect"
          />
          <file-upload
            expanded
            name="timings-file-upload"
            :accept="['.txt', '.json']"
            label="Timings File"
            tooltip="A timings.txt exported from the Submit tab, or an older timings.json. Restores the timings you tapped out, so you can pick up where you left off. A timings.txt also brings back the lyrics it was timed against."
            :model-value="mediaStore.timingsFile"
            @update:model-value="onTimingsFileSelect"
          />
          <b-message
            v-if="timingsWarnings.length"
            class="import-warnings"
            type="is-warning"
            size="is-small"
            title="Some parts were changed on load"
            closable
            @close="timingsWarnings = []"
          >
            <ul>
              <li v-for="warning in timingsWarnings" :key="warning">{{ warning }}</li>
            </ul>
          </b-message>
          <file-upload
            expanded
            name="backing-track-upload"
            label="Backing Track"
            tooltip="An instrumental track you already have. Skips the separation step."
            :model-value="mediaStore.backingTrackFile"
            @update:model-value="(file: File | null) => onUploadedTrackChange('backing', file)"
          />
          <file-upload
            expanded
            name="vocal-track-upload"
            label="Vocal Track"
            tooltip="A vocals-only track you already have. Used to check your timings against the singing."
            :model-value="mediaStore.vocalTrackFile"
            @update:model-value="(file: File | null) => onUploadedTrackChange('vocals', file)"
          />
        </div>
        <div class="box font-files">
          <h3 class="title is-5">Fonts</h3>
          <font-files-field />
        </div>
        <div v-if="advancedStore.isAdvanced" class="box kbp-files">
          <h3 class="title is-5">Karaoke Builder Studio</h3>
          <file-upload
            expanded
            name="kbp-file-upload"
            :accept="['.kbp']"
            label="KBP File"
            tooltip="A Karaoke Builder Studio project. Replaces the lyrics, timings, song details and styles. Project folders don't load .kbp files, so use this input for them."
            :model-value="mediaStore.kbpFile"
            @update:model-value="onKbpFileSelect"
          />
          <b-message
            v-if="kbpWarnings.length"
            class="import-warnings"
            type="is-warning"
            size="is-small"
            title="Some parts couldn't be carried over"
            closable
            @close="kbpWarnings = []"
          >
            <ul>
              <li v-for="warning in kbpWarnings" :key="warning">{{ warning }}</li>
            </ul>
          </b-message>
        </div>
        <div v-if="advancedStore.isAdvanced" class="box ass-files">
          <h3 class="title is-5">ASS Subtitles</h3>
          <file-upload
            expanded
            name="ass-file-upload"
            :accept="['.ass']"
            label="ASS File"
            tooltip="Karaoke subtitles, such as an Aegisub file or the subtitles.ass this app exports. Replaces the lyrics, timings, song details and styles. Project folders don't load .ass files, so use this input for them."
            :model-value="mediaStore.assFile"
            @update:model-value="onAssFileSelect"
          />
          <b-message
            v-if="assWarnings.length"
            class="import-warnings"
            type="is-warning"
            size="is-small"
            title="Some parts couldn't be carried over"
            closable
            @close="assWarnings = []"
          >
            <ul>
              <li v-for="warning in assWarnings" :key="warning">{{ warning }}</li>
            </ul>
          </b-message>
        </div>
      </div>
    </div>

    <confirm-modal
      v-model="isConfirmingSeparation"
      title="Separate again?"
      type="is-warning"
      icon="warning"
      confirm-label="Separate again"
      cancel-label="Keep what I have"
      @confirm="runSeparation"
    >
      <p>
        The backing and vocal tracks this model made before will be replaced once the new separation
        finishes. Save them first if you want to keep them.
      </p>
      <source-file-download-links
        class="mt-4"
        label="Current tracks: "
        :tracks="selectedModelTracks ? [selectedModelTracks] : []"
      />
    </confirm-modal>

    <confirm-modal
      v-model="isConfirmingFolder"
      title="Load this project folder?"
      type="is-warning"
      icon="warning"
      confirm-label="Load folder"
      cancel-label="Keep what I have"
      @confirm="confirmFolder"
    >
      <p>
        The files in <strong>{{ pendingFolder?.name ?? "this folder" }}</strong> will replace your
        {{ pendingFolderLosses.description }}. Save them first if you want to keep them.
      </p>
      <source-file-download-links
        class="mt-4"
        label="Current files: "
        v-bind="pendingFolderLosses.files"
      />
    </confirm-modal>

    <confirm-modal
      v-model="isConfirmingReplacement"
      :title="replacementPrompt.title"
      type="is-warning"
      icon="warning"
      :confirm-label="isClearing ? 'Clear' : 'Replace'"
      cancel-label="Keep what I have"
      @confirm="confirmReplacement"
    >
      <p v-if="isClearing">
        The {{ replacementPrompt.subject }} you have now will be deleted. Save them first if you
        want to keep them.
      </p>
      <p v-else>
        The {{ replacementPrompt.subject }} you have now will be replaced by the ones in
        <strong>{{ pendingReplacement?.file?.name }}</strong
        >. Save them first if you want to keep them.
      </p>
      <source-file-download-links
        class="mt-4"
        :label="replacementPrompt.label"
        v-bind="replacementPrompt.files"
      />
    </confirm-modal>
    <background-replacement-modal
      v-model="isConfirmingBackground"
      :current="mediaStore.background ?? undefined"
      :replacement="pendingBackground"
      @confirm="mediaStore.background = pendingBackground"
    />
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { mapStores } from "pinia";
import { fetchYouTubeVideo, parseYouTubeTitle } from "@/lib/video";
import { SeparationModel, TrackKind } from "@/types";

import { TrackPair, useMediaStore } from "@/stores/media";
import { SEPARATION_MODEL_GROUPS, separationModelShortName } from "@/lib/separationModels";
import { useTimingsStore } from "@/stores/timings";
import { useHistoryStore } from "@/stores/history";
import { useAdvancedStore } from "@/stores/advanced";
import { useLyricsStore } from "@/stores/lyrics";
import { useLyricsLookupStore } from "@/stores/lyricsLookup";
import { useSettingsStore } from "@/stores/settings";
import { useProjectFolderRequestStore } from "@/stores/projectFolderRequest";
import { parseSettingsYaml } from "@/lib/settingsFile";
import { classifyProjectFolder, ProjectFolder, trackEntries } from "@/lib/projectFolder";
import { MAX_UPLOADED_TRACKS, parseFileSource } from "@/lib/trackSources";
import { tracksOffLength } from "@/lib/trackLength";
import { kbpToProjectFiles, ProjectFiles } from "@/lib/kbpConvert";
import { assToProjectFiles } from "@/lib/assConvert";
import { BUNDLED_FONTS } from "@/lib/fonts";
import { isTimingsFile } from "@/lib/timedSegments";
import { isTimingsText, parseTimingsText, TIMINGS_TEXT_VERSION } from "@/lib/timingsText";
import { lyricsMatch, lyricsOf } from "@/lib/timingsLyrics";
import FileUpload from "@/components/FileUpload.vue";
import FolderUpload from "@/components/FolderUpload.vue";
import FontFilesField from "@/components/FontFilesField.vue";
import CircularProgress from "@/components/CircularProgress.vue";
import SourceFileDownloadLinks from "@/components/SourceFileDownloadLinks.vue";
import ConfirmModal from "@/components/ConfirmModal.vue";
import BackgroundReplacementModal from "@/components/BackgroundReplacementModal.vue";
import ViewportTooltip from "@/components/ViewportTooltip.vue";
import { CANCEL_ARMING_DELAY_MS } from "@/constants";

function formatList(items: string[]): string {
  if (items.length < 2) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Formats a duration as minutes and seconds, such as 2:05.
 */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

// What loading a project folder would overwrite, and the current files to offer for each.
interface FolderLosses {
  labels: string[];
  files: {
    lyrics?: string;
    timings?: string;
    settings?: string;
    tracks?: TrackPair[];
    background?: Blob;
  };
}

// A lyrics, timings, KBP or ASS file waiting for the user to agree to replace what is loaded.
// A null file clears the data instead.
interface PendingReplacement {
  kind: "lyrics" | "timings" | "kbp" | "ass";
  file: File | null;
  // A timings.txt whose lyrics differ from the ones loaded replaces those too.
  replacesLyrics?: boolean;
}

type ConvertedProject = ProjectFiles & { warnings: string[] };

const OUTCOME_LABELS = {
  succeeded: "Succeeded in",
  failed: "Failed after",
  cancelled: "Cancelled after",
};

const OUTCOME_CLASSES = {
  succeeded: "has-text-success",
  failed: "has-text-danger",
  cancelled: "has-text-grey",
};

export default defineComponent({
  components: {
    FileUpload,
    FolderUpload,
    FontFilesField,
    CircularProgress,
    SourceFileDownloadLinks,
    ConfirmModal,
    BackgroundReplacementModal,
    ViewportTooltip,
  },
  setup() {
    const mediaStore = useMediaStore();
    const timingsStore = useTimingsStore();
    const settingsStore = useSettingsStore();
    const lyricsStore = useLyricsStore();
    return {
      mediaStore,
      timingsStore,
      settingsStore,
      lyricsStore,
      lyricsLookupStore: useLyricsLookupStore(),
      advancedStore: useAdvancedStore(),
      historyStore: useHistoryStore(),
      projectFolderRequestStore: useProjectFolderRequestStore(),
    };
  },
  data() {
    return {
      canCancelSeparation: false,
      cancelArmingTimeout: undefined as ReturnType<typeof setTimeout> | undefined,
      isLoadingYouTube: false,
      youtubeError: null as string | null,
      SEPARATION_MODEL_GROUPS,
      isConfirmingSeparation: false,
      isConfirmingReplacement: false,
      isConfirmingBackground: false,
      pendingBackground: null as File | null,
      // Left in place once the prompt closes, so the prompt doesn't lose its text while it fades out.
      // Only confirming applies it.
      pendingReplacement: null as PendingReplacement | null,
      isConfirmingFolder: false,
      // Kept after the prompt closes, like `pendingReplacement`.
      pendingFolder: null as { project: ProjectFolder; name: string | null } | null,
      kbpWarnings: [] as string[],
      assWarnings: [] as string[],
      timingsWarnings: [] as string[],
    };
  },
  watch: {
    isSeparatingTrack: {
      handler(separating: boolean) {
        clearTimeout(this.cancelArmingTimeout);
        this.canCancelSeparation = false;
        if (separating) {
          this.cancelArmingTimeout = setTimeout(() => {
            this.canCancelSeparation = true;
          }, CANCEL_ARMING_DELAY_MS);
        }
      },
      immediate: true,
    },
    "projectFolderRequestStore.pending": {
      handler() {
        const request = this.projectFolderRequestStore.take();
        if (request) {
          this.onProjectFolderSelect(request.files, request.name);
        }
      },
      immediate: true,
    },
    "mediaStore.kbpFile"(file: File | null) {
      if (!file) {
        this.kbpWarnings = [];
      }
    },
    "mediaStore.assFile"(file: File | null) {
      if (!file) {
        this.assWarnings = [];
      }
    },
    "mediaStore.timingsFile"(file: File | null) {
      if (!file) {
        this.timingsWarnings = [];
      }
    },
  },
  computed: {
    // The font names an imported style may keep.
    knownFonts(): string[] {
      return [
        ...Object.keys(BUNDLED_FONTS),
        ...this.settingsStore.fontFaces.map((face) => face.name),
      ];
    },
    pendingFolderLosses(): FolderLosses & { description: string } {
      const losses = this.pendingFolder
        ? this.folderLosses(this.pendingFolder.project, true)
        : { labels: [], files: {} };
      return { ...losses, description: formatList(losses.labels) };
    },
    replacementPrompt(): {
      title: string;
      subject: string;
      label: string;
      files: { lyrics?: string; timings?: string; settings?: string };
    } {
      const kind = this.pendingReplacement?.kind;
      const replacesLyrics = kind === "timings" && this.pendingReplacement?.replacesLyrics;
      const lyrics = kind !== "timings" || replacesLyrics ? this.lyricsStore.lyricText : undefined;
      const timings =
        kind !== "lyrics" && this.timingsStore.hasAnyTimings
          ? this.timingsStore.timingsText
          : undefined;
      if (replacesLyrics) {
        return {
          title: "Replace your lyrics and timings?",
          subject: "lyrics and timings",
          label: "Current files: ",
          files: { lyrics, timings },
        };
      }
      if (kind === "kbp" || kind === "ass") {
        return {
          title: "Replace your lyrics and timings?",
          subject: "lyrics, timings, song details and styles",
          label: "Current files: ",
          files: { lyrics, timings, settings: this.settingsStore.settingsYaml },
        };
      }
      return {
        title: `${this.isClearing ? "Clear" : "Replace"} your ${kind}?`,
        subject: kind ?? "",
        label: `Current ${kind}: `,
        files: { lyrics, timings },
      };
    },
    isClearing(): boolean {
      return this.pendingReplacement?.file === null;
    },
    isSeparatingTrack() {
      return this.mediaStore.isProcessing;
    },
    separationProgress(): number | null {
      return this.mediaStore.separationProgress;
    },
    separationPercent(): number | undefined {
      // undefined leaves the bar indeterminate rather than parked at zero.
      return this.separationProgress === null ? undefined : this.separationProgress * 100;
    },
    separationStage(): string {
      return this.mediaStore.separationStage ?? "separating the track";
    },
    separationProgressMessage(): string {
      const stage = this.separationStage[0].toUpperCase() + this.separationStage.slice(1);
      if (this.separationProgress === null) {
        return `${stage}...`;
      }
      return `${stage}: ${Math.round(this.separationProgress * 100)}%`;
    },
    lastSeparation(): { message: string; class: string } | null {
      const outcome = this.mediaStore.lastSeparation;
      if (!outcome || this.isSeparatingTrack) {
        return null;
      }
      return {
        message: `${OUTCOME_LABELS[outcome.status]} ${formatDuration(outcome.durationSeconds)}`,
        class: OUTCOME_CLASSES[outcome.status],
      };
    },
    selectedModelTracks(): TrackPair | undefined {
      return this.mediaStore.trackPair(this.mediaStore.separationModel);
    },
    separationHeaderLabel(): string {
      return this.isSeparatingTrack ? this.separationProgressMessage : "Separating track";
    },
    separatingTrackMessage() {
      if (this.isSeparatingTrack) {
        return "Separating track...head to the Lyrics tab to keep working on the song!";
      }
      if (this.selectedModelTracks) {
        return "You already have tracks from this model. Separating again replaces them.";
      }
      if (this.mediaStore.hasSeparatedTrack) {
        return "The new tracks are added to the ones you have, so you can compare them.";
      }
      return "Start separating the track while you work on the song timings. It's faster!";
    },
    ...mapStores(useMediaStore),
  },
  methods: {
    async loadYouTubeUrl() {
      return this.lyricsLookupStore.whileLoading(async () => {
        this.isLoadingYouTube = true;
        this.youtubeError = null;
        try {
          const [audioBlob, videoBlob, metadata] = await fetchYouTubeVideo(
            this.mediaStore.youtubeUrl ?? "",
          );
          this.mediaStore.songFile = new File([audioBlob], "audio.mp4", {
            type: "audio/mp4",
          });
          const parsedMetadata = parseYouTubeTitle(metadata);
          this.mediaStore.songArtist = parsedMetadata[0];
          this.mediaStore.songTitle = parsedMetadata[1];

          const video = new File([videoBlob], "video.mp4", { type: "video/mp4" });
          if (this.mediaStore.background) {
            this.pendingBackground = video;
            this.isConfirmingBackground = true;
          } else {
            this.mediaStore.background = video;
          }
          await this.warnAboutKeptTracks();
        } catch (e) {
          console.error(e);
          let errorMessage = e instanceof Error ? e.message : String(e);

          // Try to extract the detail from JSON error responses
          try {
            const errorObj = JSON.parse(errorMessage);
            if (errorObj.detail) {
              errorMessage = errorObj.detail;
            }
          } catch (parseError) {
            // If it's not JSON, use the original message
          }

          this.youtubeError =
            `There was a problem downloading that video: ${errorMessage}.` +
            `Please try again, or use an external service or program to get the audio and add it above.`;
        }
        this.isLoadingYouTube = false;
      });
    },
    // Load a settings.yaml (as exported from the Submit tab) back into the app: video options, per-voice styles,
    // the separation model and the song metadata. Returns the entries the file had that couldn't be
    // applied.
    async applySettingsFile(file: File): Promise<string[]> {
      const settings = parseSettingsYaml(await file.text());

      this.settingsStore.applyVideoOptions(settings.videoOptions);
      if (settings.voiceStyles) {
        this.settingsStore.setVoiceStyles(settings.voiceStyles);
      }
      if (settings.separationModel) {
        this.mediaStore.separationModel = settings.separationModel;
      }
      if (settings.backingTrack) {
        this.mediaStore.renderTrackSource = settings.backingTrack;
      }
      if (settings.backgroundVideoOffset !== undefined) {
        this.mediaStore.backgroundVideoOffset = settings.backgroundVideoOffset;
      }
      if (settings.hintNote !== undefined) {
        this.mediaStore.hintNote = settings.hintNote;
      }
      if (settings.song.title) {
        this.mediaStore.songTitle = settings.song.title;
      }
      if (settings.song.artist) {
        this.mediaStore.songArtist = settings.song.artist;
      }
      if (settings.song.youtubeUrl) {
        this.mediaStore.youtubeUrl = settings.song.youtubeUrl;
      }
      // The real duration is derived from the audio,
      // so the file's value is only useful as a stand-in until a song is loaded.
      if (settings.song.duration && !this.mediaStore.songFile) {
        this.mediaStore.songDuration = settings.song.duration;
      }

      for (const warning of settings.warnings) {
        console.warn(`settings.yaml: ${warning}`);
      }
      return settings.warnings;
    },
    async onSettingsFileChange(file: File | null) {
      return this.lyricsLookupStore.whileLoading(async () => {
        if (!file) {
          return;
        }
        try {
          const warnings = await this.applySettingsFile(file);
          this.$buefy.toast.open({
            message: warnings.length
              ? `Settings loaded, but ${warnings.length} entr${warnings.length === 1 ? "y was" : "ies were"} skipped (see the console).`
              : "Settings loaded!",
            type: warnings.length ? "is-warning" : "is-success",
            duration: warnings.length ? 5000 : 2000,
          });
        } catch (e) {
          console.error(e);
          this.mediaStore.settingsFile = null;
          this.$buefy.toast.open({
            message: (e as Error).message,
            type: "is-danger",
            duration: 5000,
          });
        }
      });
    },
    /**
     * Loads a timings.txt, or a timings.json in any of its older shapes.
     * Returns what the timings.txt parser changed on the way.
     */
    async applyTimingsFile(file: File): Promise<string[]> {
      const text = await file.text();
      let warnings: string[] = [];
      this.historyStore.record({ label: "Timings file", tab: "song" }, () => {
        warnings = this.writeTimingsFile(text);
      });
      return warnings;
    },
    writeTimingsFile(text: string): string[] {
      if (isTimingsText(text)) {
        const { voices, warnings } = parseTimingsText(text);
        // Each syllable in a timings.txt carries its text, so the file brings its lyrics along.
        if (!lyricsMatch(this.lyricsStore.lyricText, voices)) {
          this.lyricsStore.setLyrics(lyricsOf(voices));
          // The lyrics input would otherwise go on naming a file that no longer holds these lyrics.
          this.mediaStore.lyricsFile = null;
        }
        this.timingsStore.setAllSegments(voices);
        return warnings;
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(
          `it doesn't start with "Toul timings ${TIMINGS_TEXT_VERSION}", so it may be a lyrics file`,
        );
      }
      if (Array.isArray(parsed)) {
        // Legacy / single-voice format: one voice, an array of [time, marker] tuples.
        this.timingsStore.resetTimings(parsed);
      } else if (isTimingsFile(parsed)) {
        // Current format: per-voice segments, which can carry untimed ones.
        this.timingsStore.setAllSegments(parsed.voices);
      } else {
        // Multi-voice format: a per-voice map of timing arrays.
        this.timingsStore.setAllTimings(parsed);
      }
      return [];
    },
    async readLyricsFile(file: File): Promise<string> {
      const text = await file.text();
      if (isTimingsText(text)) {
        throw new Error("this is a timings file, so load it with the Timings File input");
      }
      return text;
    },
    onLyricsFileSelect(file: File | null) {
      if (file && this.lyricsStore.lyricText.trim() !== "") {
        this.askToReplace({ kind: "lyrics", file });
        return;
      }
      this.mediaStore.lyricsFile = file;
      this.onLyricsFileChange(file);
    },
    async onTimingsFileSelect(file: File | null) {
      const replacesLyrics = file !== null && (await this.replacesLyrics(file));
      if (this.timingsStore.hasAnyTimings || replacesLyrics) {
        this.askToReplace({ kind: "timings", file, replacesLyrics });
        return;
      }
      this.mediaStore.timingsFile = file;
      this.onTimingsFileChange(file);
    },
    /**
     * Whether loading a timings file would replace lyrics the user has, which only a timings.txt
     * with other lyrics does. A file that can't be read replaces nothing, and says so once loaded.
     */
    async replacesLyrics(file: File): Promise<boolean> {
      const text = await file.text();
      if (!isTimingsText(text) || this.lyricsStore.lyricText.trim() === "") return false;
      try {
        return !lyricsMatch(this.lyricsStore.lyricText, parseTimingsText(text).voices);
      } catch {
        return false;
      }
    },
    askToReplace(replacement: PendingReplacement) {
      this.pendingReplacement = replacement;
      this.isConfirmingReplacement = true;
    },
    confirmReplacement() {
      const replacement = this.pendingReplacement;
      if (replacement?.kind === "lyrics") {
        this.mediaStore.lyricsFile = replacement.file;
        this.onLyricsFileChange(replacement.file);
      } else if (replacement?.kind === "timings") {
        this.mediaStore.timingsFile = replacement.file;
        this.onTimingsFileChange(replacement.file);
      } else if (replacement?.kind === "kbp" && replacement.file) {
        this.mediaStore.kbpFile = replacement.file;
        this.onKbpFileChange(replacement.file);
      } else if (replacement?.kind === "ass" && replacement.file) {
        this.mediaStore.assFile = replacement.file;
        this.onAssFileChange(replacement.file);
      }
    },
    // Clearing the input leaves what the file loaded alone, as clearing the lyrics file does.
    onKbpFileSelect(file: File | null) {
      const hasData = this.lyricsStore.lyricText.trim() !== "" || this.timingsStore.hasAnyTimings;
      if (file && hasData) {
        this.askToReplace({ kind: "kbp", file });
        return;
      }
      this.mediaStore.kbpFile = file;
      if (file) {
        this.onKbpFileChange(file);
      }
    },
    /**
     * Loads a project converted to the app's own three files the way their own inputs would.
     * Returns the converter's warnings together with the settings file's.
     */
    async applyConvertedProject<T extends ConvertedProject>(converted: T): Promise<T> {
      this.lyricsStore.setLyrics(converted.lyrics);
      this.timingsStore.setAllSegments(converted.timings);
      // The import also changes the settings, which the history doesn't cover.
      this.historyStore.clear();
      const settingsWarnings = await this.applySettingsFile(
        new File([converted.settings], "settings.yaml"),
      );
      // Those inputs would otherwise go on naming files that no longer describe what is loaded.
      this.mediaStore.lyricsFile = null;
      this.mediaStore.timingsFile = null;
      this.mediaStore.settingsFile = null;
      return { ...converted, warnings: [...converted.warnings, ...settingsWarnings] };
    },
    async onKbpFileChange(file: File) {
      return this.lyricsLookupStore.whileLoading(async () => {
        try {
          const { warnings, audioName } = await this.applyConvertedProject(
            kbpToProjectFiles(await file.text(), { fonts: this.knownFonts }),
          );
          this.kbpWarnings = warnings;
          const song = audioName && !this.mediaStore.songFile ? ` Its song is ${audioName}.` : "";
          this.$buefy.toast.open({
            message: warnings.length
              ? `Project loaded, with a few changes listed under the KBP File input.${song}`
              : `Project loaded!${song}`,
            type: warnings.length ? "is-warning" : "is-success",
            duration: warnings.length || song ? 6000 : 2000,
          });
        } catch (e) {
          console.error(e);
          this.mediaStore.kbpFile = null;
          this.kbpWarnings = [];
          this.$buefy.toast.open({
            message: `Couldn't read that KBP file: ${(e as Error).message}`,
            type: "is-danger",
            duration: 5000,
          });
        }
      });
    },
    onAssFileSelect(file: File | null) {
      const hasData = this.lyricsStore.lyricText.trim() !== "" || this.timingsStore.hasAnyTimings;
      if (file && hasData) {
        this.askToReplace({ kind: "ass", file });
        return;
      }
      this.mediaStore.assFile = file;
      if (file) {
        this.onAssFileChange(file);
      }
    },
    async onAssFileChange(file: File) {
      return this.lyricsLookupStore.whileLoading(async () => {
        try {
          const { warnings } = await this.applyConvertedProject(
            assToProjectFiles(await file.text(), { fonts: this.knownFonts }),
          );
          this.assWarnings = warnings;
          this.$buefy.toast.open({
            message: warnings.length
              ? "Subtitles loaded, with a few changes listed under the ASS File input."
              : "Subtitles loaded!",
            type: warnings.length ? "is-warning" : "is-success",
            duration: warnings.length ? 6000 : 2000,
          });
        } catch (e) {
          console.error(e);
          this.mediaStore.assFile = null;
          this.assWarnings = [];
          this.$buefy.toast.open({
            message: `Couldn't read that ASS file: ${(e as Error).message}`,
            type: "is-danger",
            duration: 5000,
          });
        }
      });
    },
    async onTimingsFileChange(file: File | null) {
      if (!file) {
        this.historyStore.record({ label: "Clear timings file", tab: "song" }, () =>
          this.timingsStore.resetTimings([]),
        );
        return;
      }
      try {
        this.timingsWarnings = await this.applyTimingsFile(file);
        if (this.timingsWarnings.length) {
          this.$buefy.toast.open({
            message: "Timings loaded, with a few changes listed under the Timings File input.",
            type: "is-warning",
            duration: 6000,
          });
        }
      } catch (e) {
        console.error(e);
        this.mediaStore.timingsFile = null;
        this.timingsWarnings = [];
        this.$buefy.toast.open({
          message: `Couldn't read that timings file: ${(e as Error).message}`,
          type: "is-danger",
          duration: 5000,
        });
      }
    },
    // Clearing the file leaves the lyrics alone: the text is editable in the
    // Lyrics tab and there is no earlier version to fall back to.
    async onLyricsFileChange(file: File | null) {
      if (!file) {
        return;
      }
      try {
        const text = await this.readLyricsFile(file);
        this.historyStore.record(
          { label: "Lyrics file", tab: "song" },
          () => this.lyricsStore.setLyrics(text),
          { warnLoss: true },
        );
        this.$buefy.toast.open({ message: "Lyrics loaded!", type: "is-success", duration: 2000 });
      } catch (e) {
        console.error(e);
        this.mediaStore.lyricsFile = null;
        this.$buefy.toast.open({
          message: `Couldn't read that lyrics file: ${(e as Error).message}`,
          type: "is-danger",
          duration: 5000,
        });
      }
    },
    // Loads whatever an extracted project folder holds, applying each file exactly
    // as its own upload field would. What the folder hasn't got is left alone.
    /**
     * Settings always hold something, so they are offered for download but never make the prompt appear on their own.
     */
    folderLosses(project: ProjectFolder, includeSettings: boolean): FolderLosses {
      const losses: FolderLosses = { labels: [], files: {} };
      const tracks = this.replacedTracks(project);
      if (project.song && this.mediaStore.songFile) {
        losses.labels.push("song");
      }
      if (project.lyrics && this.lyricsStore.lyricText.trim() !== "") {
        losses.labels.push("lyrics");
        losses.files.lyrics = this.lyricsStore.lyricText;
      }
      if (project.timings && this.timingsStore.hasAnyTimings) {
        losses.labels.push("timings");
        losses.files.timings = this.timingsStore.timingsText;
      }
      const backingCount = tracks.filter((pair) => pair.backing.size > 0).length;
      const vocalCount = tracks.filter((pair) => pair.vocals.size > 0).length;
      if (backingCount > 0) {
        losses.labels.push(backingCount > 1 ? "backing tracks" : "backing track");
      }
      if (vocalCount > 0) {
        losses.labels.push(vocalCount > 1 ? "vocal tracks" : "vocal track");
      }
      if (tracks.length > 0) {
        losses.files.tracks = tracks;
      }
      if (project.background && this.mediaStore.background) {
        losses.labels.push("background");
        losses.files.background = this.mediaStore.background;
      }
      if (includeSettings && project.settings) {
        losses.labels.push("settings");
        losses.files.settings = this.settingsStore.settingsYaml;
      }
      return losses;
    },
    /**
     * The tracks loading the folder would discard. A track in the folder replaces its model's pair,
     * or the uploaded file of the same kind and name.
     */
    replacedTracks(project: ProjectFolder): TrackPair[] {
      const pairs = this.mediaStore.trackPairs ?? [];
      return pairs.filter((pair) => {
        const file = parseFileSource(pair.source);
        return file
          ? project.uploadedTracks[file.kind].some((track) => track.name === file.name)
          : !!project.modelTracks[pair.source as SeparationModel];
      });
    },
    onProjectFolderSelect(files: File[], name: string | null) {
      const project = classifyProjectFolder(files);
      if (this.folderLosses(project, false).labels.length > 0) {
        this.pendingFolder = { project, name };
        this.isConfirmingFolder = true;
        return;
      }
      this.loadProjectFolder(project, name);
    },
    confirmFolder() {
      if (this.pendingFolder) {
        this.loadProjectFolder(this.pendingFolder.project, this.pendingFolder.name);
      }
    },
    async loadProjectFolder(project: ProjectFolder, name: string | null) {
      return this.lyricsLookupStore.whileLoading(async () => {
        this.mediaStore.projectFolderName = name;
        const loaded: string[] = [];
        const failed: string[] = [];
        const apply = async (label: string, file: File, run: () => Promise<void> | void) => {
          try {
            await run();
            loaded.push(label);
          } catch (e) {
            console.error(e);
            failed.push(file.name);
          }
        };

        if (project.song) {
          const song = project.song;
          await apply("the song", song, async () => {
            this.mediaStore.songFile = song;
            // The song's own tags land on the title and artist a moment later. Let them,
            // before the settings file puts the project's own values back.
            await this.mediaStore.metadataSettled();
          });
        }
        // A new background resets the video's offset, which the settings file then puts back.
        if (project.background) {
          const background = project.background;
          await apply("the background", background, () => {
            this.mediaStore.background = background;
          });
        }
        if (project.settings) {
          const settings = project.settings;
          await apply("settings", settings, async () => {
            await this.applySettingsFile(settings);
            this.mediaStore.settingsFile = settings;
          });
        }
        if (project.lyrics) {
          const lyrics = project.lyrics;
          await apply("lyrics", lyrics, async () => {
            this.lyricsStore.setLyrics(await this.readLyricsFile(lyrics));
            this.mediaStore.lyricsFile = lyrics;
          });
        }
        if (project.timings) {
          const timings = project.timings;
          await apply("timings", timings, async () => {
            const warnings = await this.applyTimingsFile(timings);
            this.mediaStore.timingsFile = timings;
            this.timingsWarnings = warnings;
          });
        }
        const skippedTracks: File[] = [];
        for (const kind of ["backing", "vocals"] as const) {
          for (const file of project.uploadedTracks[kind]) {
            if (!this.mediaStore.replaceUploadedTrack(kind, null, file)) {
              skippedTracks.push(file);
              continue;
            }
            loaded.push(file.name);
            const field = kind === "backing" ? "backingTrackFile" : "vocalTrackFile";
            this.mediaStore[field] ??= file;
          }
        }
        type FolderTracks = { backing?: File; vocals?: File };
        for (const [model, tracks] of Object.entries(project.modelTracks) as [
          SeparationModel,
          FolderTracks,
        ][]) {
          const file = (tracks.backing ?? tracks.vocals)!;
          await apply(`the ${separationModelShortName(model)} tracks`, file, () =>
            this.mediaStore.putTrackPair(model, {
              backing: tracks.backing ?? new Blob(),
              vocals: tracks.vocals ?? new Blob(),
            }),
          );
        }
        if (project.fonts.length > 0) {
          const { added, failed: unreadable } = await this.settingsStore.addFonts(project.fonts);
          if (added.length > 0) {
            loaded.push(added.length === 1 ? "the font" : "the fonts");
          }
          failed.push(...unreadable.map(({ file }) => file.name));
          // A project saved before the font library carried one font,
          // which overrode the font its settings name.
          if (project.settings && project.fonts.length === 1 && added.length === 1) {
            const face = added[0].name.toLowerCase();
            const { videoOptions, voiceStyles } = this.settingsStore;
            const named = [
              videoOptions.font.name,
              videoOptions.titleStyle.fontName,
              ...Object.values(voiceStyles).map((style) => style.fontName),
            ];
            if (!named.some((name) => name?.toLowerCase() === face)) {
              videoOptions.font.name = added[0].name;
            }
          }
        }

        // The folder brings a song and settings, which the history doesn't cover.
        this.historyStore.clear();
        if (project.ignored.length) {
          console.warn(`Not loaded from the project folder: ${project.ignored.join(", ")}`);
        }
        if (failed.length) {
          this.$buefy.toast.open({
            message: loaded.length
              ? `Loaded ${formatList(loaded)}, but couldn't read ${formatList(failed)}.`
              : `Couldn't read ${formatList(failed)}.`,
            type: "is-danger",
            duration: 5000,
          });
          return;
        }
        this.$buefy.toast.open({
          message: loaded.length
            ? `Loaded ${formatList(loaded)}.`
            : "Nothing to load in that folder.",
          type: loaded.length ? "is-success" : "is-warning",
          duration: loaded.length ? 3000 : 5000,
        });
        const trackWarnings: string[] = [];
        if (skippedTracks.length > 0) {
          trackWarnings.push(
            `The uploaded tracks are limited to ${MAX_UPLOADED_TRACKS} vocal and ` +
              `${MAX_UPLOADED_TRACKS} backing tracks. ` +
              `Ignored ${formatList(skippedTracks.map((file) => file.name))}.`,
          );
        }
        const folderTracks = [
          ...project.uploadedTracks.backing,
          ...project.uploadedTracks.vocals,
          ...Object.values(project.modelTracks).flatMap((tracks) => Object.values(tracks)),
        ].filter((file) => !skippedTracks.includes(file));
        // A new song is compared with the tracks kept from before it too.
        const lengthWarning = await this.lengthWarning(
          project.song ? this.currentTrackFiles() : folderTracks,
        );
        if (lengthWarning) {
          trackWarnings.push(lengthWarning);
        }
        if (trackWarnings.length > 0) {
          this.$buefy.toast.open({
            message: trackWarnings.join(" "),
            type: "is-warning",
            duration: 8000,
          });
        }
      });
    },
    onSeparationModelChange(model: SeparationModel) {
      this.mediaStore.separationModel = model;
    },
    // The field swaps the file it held for the new one, leaving the folder's other files alone.
    async onUploadedTrackChange(kind: TrackKind, file: File | null) {
      const field = kind === "backing" ? "backingTrackFile" : "vocalTrackFile";
      const added = this.mediaStore.replaceUploadedTrack(kind, this.mediaStore[field], file);
      this.mediaStore[field] = added ? file : null;
      if (!added) {
        this.$buefy.toast.open({
          message:
            `There are already ${MAX_UPLOADED_TRACKS} uploaded ` +
            `${kind === "backing" ? "backing" : "vocal"} tracks. Remove one to add another.`,
          type: "is-warning",
          duration: 5000,
        });
      } else if (file) {
        await this.warnAboutLength([file]);
      }
    },
    /**
     * Says which of the tracks differ in length from the song, since a track cut or padded at the
     * start no longer lines up with timings tapped against the song. Null when they all match,
     * or when no song is loaded to compare with.
     */
    async lengthWarning(tracks: File[]): Promise<string | null> {
      const songDuration = this.mediaStore.songDuration;
      if (!songDuration || tracks.length === 0) {
        return null;
      }
      const names = await tracksOffLength(tracks, songDuration);
      if (names.length === 0) {
        return null;
      }
      const one = names.length === 1;
      return (
        `${formatList(names)} ${one ? "is" : "are"} not the same length as the song, ` +
        `so the timings may not line up with ${one ? "it" : "them"}.`
      );
    },
    async warnAboutLength(tracks: File[]) {
      const message = await this.lengthWarning(tracks);
      if (message) {
        this.$buefy.toast.open({ message, type: "is-warning", duration: 8000 });
      }
    },
    // A new song keeps the tracks, which may still belong to the old one.
    onSongFileSelect(file: File | null) {
      this.mediaStore.songFile = file;
      if (file) {
        void this.warnAboutKeptTracks();
      }
    },
    /**
     * Warns about the tracks that don't match a new song's length once it has been measured.
     */
    async warnAboutKeptTracks() {
      await this.mediaStore.metadataSettled();
      await this.warnAboutLength(this.currentTrackFiles());
    },
    /**
     * Every track loaded, under the name the project download gives it.
     */
    currentTrackFiles(): File[] {
      return trackEntries(this.mediaStore.trackPairs ?? []).map(
        ({ name, blob }) => new File([blob], name, { type: blob.type }),
      );
    },
    // Separating again with a model replaces the tracks it made before, so ask first.
    separateTrack() {
      if (this.selectedModelTracks) {
        this.isConfirmingSeparation = true;
        return;
      }
      this.runSeparation();
    },
    runSeparation() {
      this.mediaStore.startSeparation(this.mediaStore.songFile, this.mediaStore.separationModel);
    },
    cancelSeparation() {
      this.mediaStore.cancelSeparation();
    },
  },
});
</script>
<style scoped>
.import-warnings ul {
  list-style: disc;
  padding-left: 1.25em;
}

.song-info-tab {
  overflow-x: hidden;
  overflow-y: auto;
}

.box {
  border: 1px solid var(--bulma-border);
  box-shadow: none;
}

.metadata-input :deep(.input) {
  width: auto;
  max-width: 100%;
}

/* Content sizing drops the browser's default 20-character box,
  which is the width of the YouTube field above; 14rem restores it as the floor. */
@supports (field-sizing: content) {
  .metadata-input :deep(.input) {
    min-width: 14rem;
    field-sizing: content;
  }
}

.buttons {
  margin-top: 1.5rem;
}

/* A disabled button eats its own hover events, so the tooltip wrapper around it would never see them. */
.buttons :deep(button[disabled]) {
  pointer-events: none;
}

.separation-progress {
  padding-top: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.separation-progress :deep(.progress-wrapper) {
  flex: 1;
  margin-bottom: 0;
}

.separation-model-radios {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.separation-model-radios .model-group-label {
  font-weight: 600;
  font-size: 0.9em;
  margin-top: 0.5rem;
  color: #555;
}

.separation-model-radios .model-group-label:first-child {
  margin-top: 0;
}

.separation-model-radios .hint {
  color: #888;
  font-size: 0.85em;
  margin-left: 0.25rem;
}

.separation-model-radios .separated-mark {
  margin-left: 0.25rem;
}
</style>
