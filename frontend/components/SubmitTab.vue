<template>
  <b-tab-item
    value="submit"
    label="Submit"
    icon="blender"
    class="submit-tab scroll-wrapper"
    headerClass="submit-tab-header"
  >
    <div class="columns is-variable is-5">
      <div
        class="column is-4 settings-column"
        :class="{ 'has-more-above': scrollHints.above }"
        ref="settingsColumn"
        @scroll="updateScrollHints"
        @transitionend="updateScrollHints"
      >
        <h2 class="title">More Settings</h2>
        <b-field horizontal>
          <template #label>
            Count-Ins
            <viewport-tooltip
              wide
              label="Add count-in characters so you know when to start singing: before each screen, or before any line that follows a gap"
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </viewport-tooltip>
          </template>
          <b-radio-button
            v-model="videoOptions.countInMode"
            native-value="none"
            type="is-primary is-light is-outlined"
          >
            <span>None</span>
          </b-radio-button>
          <b-radio-button
            v-model="videoOptions.countInMode"
            native-value="screen"
            type="is-primary is-light is-outlined"
          >
            <span>Screen start</span>
          </b-radio-button>
          <b-radio-button
            v-model="videoOptions.countInMode"
            native-value="line"
            type="is-primary is-light is-outlined"
          >
            <span>Line start</span>
          </b-radio-button>
        </b-field>
        <template v-if="videoOptions.countInMode !== 'none'">
          <b-field horizontal>
            <template #label>
              Dynamic Count-Ins
              <viewport-tooltip
                wide
                label="Split the count-in text into up to three marks: a long gap gets them all and shorter gaps get fewer. A gap too short for one still gets the last mark, which starts while the previous line is being sung, as long as the line is already on screen. Turn this off to show the whole text for a fixed length instead"
              >
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </viewport-tooltip>
            </template>
            <b-switch v-model="videoOptions.dynamicCountIns"></b-switch>
          </b-field>
          <b-field horizontal>
            <template #label>
              Count-In Text
              <viewport-tooltip
                wide
                :label="
                  videoOptions.dynamicCountIns
                    ? 'What a count-in shows before the singing starts, split by word if it has spaces and by character otherwise. Leave it empty to draw blocks'
                    : 'What a count-in shows before the singing starts'
                "
              >
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </viewport-tooltip>
            </template>
            <b-field>
              <b-input
                ref="countInInput"
                expanded
                :model-value="videoOptions.countInText"
                @update:model-value="
                  (v: string | number | undefined) => (videoOptions.countInText = String(v ?? ''))
                "
              ></b-input>
              <p class="control">
                <SymbolPicker :groups="countInSymbols" @pick="insertCountInSymbol" />
              </p>
            </b-field>
          </b-field>
          <b-field horizontal>
            <template #label>
              Count-In Gap
              <viewport-tooltip
                wide
                :label="
                  videoOptions.dynamicCountIns
                    ? 'A line that starts this long after the previous one gets every mark, and shorter gaps get fewer, down to the last mark alone. A full count-in lasts this long, with its marks evenly spaced'
                    : 'Add a count-in when a line starts more than this many seconds after the previous line ends'
                "
              >
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </viewport-tooltip>
            </template>
            <b-numberinput
              expanded
              :model-value="videoOptions.countInThreshold"
              :min="0.5"
              :step="0.1"
              :min-step="0.01"
              @update:model-value="
                (v: number | null | undefined) =>
                  (videoOptions.countInThreshold = Number(v ?? videoOptions.countInThreshold))
              "
              controls-position="compact"
            ></b-numberinput>
          </b-field>
          <b-field v-if="!videoOptions.dynamicCountIns" horizontal>
            <template #label>
              Count-In Length
              <viewport-tooltip
                wide
                label="How many seconds a count-in lasts. Can't be longer than the gap above."
              >
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </viewport-tooltip>
            </template>
            <b-numberinput
              expanded
              :model-value="videoOptions.countInDuration"
              :min="0.5"
              :max="videoOptions.countInThreshold"
              :step="0.1"
              :min-step="0.01"
              @update:model-value="
                (v: number | null | undefined) =>
                  (videoOptions.countInDuration = Number(v ?? videoOptions.countInDuration))
              "
              controls-position="compact"
            ></b-numberinput>
          </b-field>
        </template>
        <b-field horizontal>
          <template #label>
            Instrumental Breaks
            <viewport-tooltip
              wide
              label="How many seconds without lyrics get a screen that counts down the instrumental. 0 turns them off."
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </viewport-tooltip>
          </template>
          <b-numberinput
            expanded
            :model-value="videoOptions.instrumentalThreshold"
            :min="0"
            :step="0.5"
            :min-step="0.01"
            @update:model-value="
              (v: number | null | undefined) =>
                (videoOptions.instrumentalThreshold = Number(
                  v ?? videoOptions.instrumentalThreshold,
                ))
            "
            controls-position="compact"
          ></b-numberinput>
        </b-field>
        <b-field horizontal>
          <template #label>
            Show Fast Lines Early
            <viewport-tooltip
              wide
              label="Show the first few lines of a screen early if it starts right after the previous screen ends"
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </viewport-tooltip> </template
          ><b-switch v-model="videoOptions.addStaggeredLines"></b-switch
        ></b-field>
        <b-field v-if="advancedStore.isAdvanced && timingsStore.hasDisplayPeriods" horizontal>
          <template #label>
            Use Line Display Times
            <viewport-tooltip
              wide
              label="Show each line when its display times say, as set in the Edit tab or imported from a KBP file. When off, the automatic rules apply. The times are kept either way, and the KBP export still writes them."
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </viewport-tooltip> </template
          ><b-switch v-model="videoOptions.useStoredDisplayPeriods"></b-switch
        ></b-field>
        <file-upload
          horizontal
          expanded
          name="background-upload"
          label="Background"
          tooltip="An image or video behind the lyrics, in place of the background color. Loading a YouTube video puts its video here."
          :accept="backgroundExtensions"
          :model-value="backgroundFile"
          @update:model-value="onBackgroundSelect"
        />
        <b-field v-if="background" horizontal label="Use Background">
          <b-switch v-model="videoOptions.useBackground"></b-switch
        ></b-field>
        <b-field v-if="background && videoOptions.useBackground" horizontal>
          <template #label>
            Background Fit
            <viewport-tooltip
              wide
              label="Fill covers the whole frame and crops what overflows. Fit shows the whole background, with bars in the background color."
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </viewport-tooltip>
          </template>
          <b-select v-model="videoOptions.backgroundFit" expanded>
            <option value="fill">Fill</option>
            <option value="fit">Fit</option>
          </b-select>
        </b-field>
        <b-field
          v-if="background && videoOptions.useBackground && backgroundKind === 'video'"
          horizontal
        >
          <template #label>
            Video Offset
            <viewport-tooltip
              wide
              label="Seconds to move the background video by when it is out of sync with the backing track. A positive offset delays the video, and a negative one skips its start."
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </viewport-tooltip>
          </template>
          <b-numberinput
            expanded
            :model-value="mediaStore.backgroundVideoOffset"
            :step="0.05"
            :min-step="0.01"
            @update:model-value="
              (v: number | null | undefined) =>
                (mediaStore.backgroundVideoOffset = Number(v ?? mediaStore.backgroundVideoOffset))
            "
            controls-position="compact"
          ></b-numberinput>
        </b-field>
        <b-field
          v-if="mediaStore.backingSources.length > 0 || rendersFullTrack"
          horizontal
          label="Backing Track"
        >
          <track-select
            kind="backing"
            :include-full="advancedStore.isAdvanced"
            expanded
            :model-value="rendersFullTrack ? 'full' : (mediaStore.separatedTrack?.source ?? null)"
            @update:model-value="(v: 'full' | TrackSource) => (mediaStore.renderTrackSource = v)"
          />
        </b-field>
        <b-field
          v-if="advancedStore.isAdvanced && !rendersFullTrack"
          horizontal
          :message="restoreGapsMessage"
        >
          <template #label>
            Restore Gaps
            <viewport-tooltip
              wide
              label="Play the original song instead of the backing track where nobody sings, so only the sung parts lose what the separation removed"
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </viewport-tooltip> </template
          ><b-switch v-model="videoOptions.restoreGaps"></b-switch
        ></b-field>
        <b-field horizontal>
          <template #label>
            Video Format
            <viewport-tooltip
              wide
              :label="`MKV also carries ${mkvExtraTracks} as extra audio tracks, for players that can switch between them`"
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </viewport-tooltip>
          </template>
          <b-select
            expanded
            :model-value="videoOptions.outputFormat"
            @update:model-value="(v: string) => (videoOptions.outputFormat = v as OutputFormat)"
          >
            <option v-for="(label, format) in outputFormatLabels" :key="format" :value="format">
              {{ label }}
            </option>
          </b-select>
        </b-field>
        <b-field v-if="advancedStore.isAdvanced" horizontal label="Resolution">
          <b-select v-model="videoOptions.resolution" expanded>
            <option v-for="resolution in resolutions" :key="resolution" :value="resolution">
              {{ resolution }}
            </option>
          </b-select>
        </b-field>
        <b-field v-if="advancedStore.isAdvanced" horizontal label="Frame Rate">
          <b-select v-model="videoOptions.frameRate" expanded>
            <option v-for="rate in frameRates" :key="rate" :value="rate">{{ rate }} fps</option>
          </b-select>
        </b-field>
        <b-field v-if="advancedStore.isAdvanced" horizontal>
          <template #label>
            Quality
            <viewport-tooltip
              wide
              label="High keeps more of the background's detail, for files two to four times as large and a render about a quarter slower"
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </viewport-tooltip>
          </template>
          <b-select
            expanded
            :model-value="videoOptions.quality"
            @update:model-value="(v: string) => (videoOptions.quality = v as RenderQuality)"
          >
            <option v-for="(label, quality) in qualityLabels" :key="quality" :value="quality">
              {{ label }}
            </option>
          </b-select>
        </b-field>
        <settings-section title="Title Screen" id="title-screen">
          <b-field horizontal>
            <template #label>
              Title Screen
              <viewport-tooltip
                wide
                label="Open the video on a screen without lyrics, where the title goes. When the song's intro is too short to hold it, the song starts after it."
              >
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </viewport-tooltip> </template
            ><b-switch v-model="videoOptions.addTitleScreen"></b-switch
          ></b-field>
          <template v-if="videoOptions.addTitleScreen">
            <b-field horizontal>
              <template #label>
                Length
                <viewport-tooltip
                  wide
                  label="How many seconds the title screen lasts from the start of the video"
                >
                  <b-icon size="is-small" icon="circle-question"></b-icon>
                </viewport-tooltip>
              </template>
              <b-numberinput
                expanded
                :model-value="videoOptions.titleScreenDuration"
                :min="0.5"
                :step="0.5"
                :min-step="0.01"
                @update:model-value="
                  (v: number | null | undefined) =>
                    (videoOptions.titleScreenDuration = Number(
                      v ?? videoOptions.titleScreenDuration,
                    ))
                "
                controls-position="compact"
              ></b-numberinput>
            </b-field>
            <b-field horizontal :type="hintNoteError ? 'is-danger' : ''" :message="hintNoteError">
              <template #label>
                Hint Note
                <viewport-tooltip
                  wide
                  label="Play this note over the title screen, so the singer can find the first note when the singing starts before the instruments. Type a note such as A3, C#4 or Bb2, or a frequency in Hz for a song off standard tuning. Leave it empty for no note."
                >
                  <b-icon size="is-small" icon="circle-question"></b-icon>
                </viewport-tooltip>
              </template>
              <b-input
                expanded
                aria-label="Hint note"
                :model-value="mediaStore.hintNote ?? ''"
                @update:model-value="
                  (v: string | number | undefined) =>
                    (mediaStore.hintNote = String(v ?? '') || null)
                "
              ></b-input>
            </b-field>
            <b-field horizontal>
              <template #label>
                Show Title
                <viewport-tooltip
                  wide
                  label="Write the song's title and artist on the title screen. Turn this off to leave it blank, for a background that shows a title of its own."
                >
                  <b-icon size="is-small" icon="circle-question"></b-icon>
                </viewport-tooltip> </template
              ><b-switch v-model="videoOptions.showTitle"></b-switch
            ></b-field>
          </template>
        </settings-section>
        <settings-section title="Fonts and Colors" id="fonts-and-colors">
          <font-field
            v-model="videoOptions.font.name"
            @face-switches="(switches) => Object.assign(videoOptions.font, switches)"
          />
          <b-field horizontal label="Font Size"
            ><b-numberinput
              expanded
              :model-value="videoOptions.font.size"
              @update:model-value="
                (v: number | null | undefined) =>
                  (videoOptions.font.size = Number(v ?? videoOptions.font.size))
              "
              controls-position="compact"
            ></b-numberinput
          ></b-field>
          <!-- The renderer draws bold unless told otherwise. -->
          <b-field horizontal label="Bold"
            ><b-switch
              :model-value="videoOptions.font.bold !== false"
              @update:model-value="(bold: boolean) => (videoOptions.font.bold = bold)"
            ></b-switch
          ></b-field>
          <b-field horizontal label="Italic"
            ><b-switch
              :model-value="videoOptions.font.italic === true"
              @update:model-value="(italic: boolean) => (videoOptions.font.italic = italic)"
            ></b-switch
          ></b-field>
          <b-field horizontal label="Background Color"
            ><color-field v-model="videoOptions.color.background" label="background color"
          /></b-field>
          <b-field horizontal label="Primary Color"
            ><color-field v-model="videoOptions.color.primary" label="primary color"
          /></b-field>
          <b-field horizontal label="Secondary Color"
            ><color-field v-model="videoOptions.color.secondary" label="secondary color"
          /></b-field>
          <b-field horizontal label="Outline Width"
            ><b-numberinput
              expanded
              :model-value="videoOptions.outlineWidth"
              :min="0"
              :step="0.5"
              :min-step="0.1"
              @update:model-value="
                (v: number | null | undefined) =>
                  (videoOptions.outlineWidth = Number(v ?? videoOptions.outlineWidth))
              "
              controls-position="compact"
            ></b-numberinput
          ></b-field>
          <b-field v-if="videoOptions.color.outline" horizontal label="Outline Color"
            ><color-field v-model="videoOptions.color.outline" label="outline color"
          /></b-field>
          <b-field horizontal>
            <template #label>
              Shadow Offset X
              <viewport-tooltip
                wide
                label="Positive values move the shadow right, negative values left. Zero on both axes turns it off."
              >
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </viewport-tooltip>
            </template>
            <b-numberinput
              expanded
              :model-value="videoOptions.shadowX"
              :step="0.5"
              :min-step="0.1"
              @update:model-value="
                (v: number | null | undefined) =>
                  (videoOptions.shadowX = Number(v ?? videoOptions.shadowX))
              "
              controls-position="compact"
            ></b-numberinput>
          </b-field>
          <b-field horizontal>
            <template #label>
              Shadow Offset Y
              <viewport-tooltip
                wide
                label="Positive values move the shadow down, negative values up. Zero on both axes turns it off."
              >
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </viewport-tooltip>
            </template>
            <b-numberinput
              expanded
              :model-value="videoOptions.shadowY"
              :step="0.5"
              :min-step="0.1"
              @update:model-value="
                (v: number | null | undefined) =>
                  (videoOptions.shadowY = Number(v ?? videoOptions.shadowY))
              "
              controls-position="compact"
            ></b-numberinput>
          </b-field>
          <b-field v-if="videoOptions.color.shadow" horizontal label="Shadow Color"
            ><color-field v-model="videoOptions.color.shadow" label="shadow color"
          /></b-field>
          <b-field horizontal label="Lyric Vertical Alignment"
            ><b-radio-button
              v-model="videoOptions.verticalAlignment"
              :native-value="VerticalAlignment.Top"
              type="is-primary is-light is-outlined"
            >
              <span>Top</span>
            </b-radio-button>

            <b-radio-button
              v-model="videoOptions.verticalAlignment"
              :native-value="VerticalAlignment.Middle"
              type="is-primary is-light is-outlined"
            >
              <span>Middle</span>
            </b-radio-button>

            <b-radio-button
              v-model="videoOptions.verticalAlignment"
              :native-value="VerticalAlignment.Bottom"
              type="is-primary is-light is-outlined"
            >
              Bottom
            </b-radio-button>
          </b-field>
          <b-field v-if="advancedStore.isAdvanced" horizontal>
            <template #label>
              Line Spacing
              <viewport-tooltip
                wide
                label="From the top of one line to the top of the next, as a multiple of the font size. A KBP file sets it from its own margins."
              >
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </viewport-tooltip>
            </template>
            <b-numberinput
              expanded
              :model-value="videoOptions.lineSpacing"
              :min="0.5"
              :step="0.1"
              :min-step="0.001"
              @update:model-value="
                (v: number | null | undefined) =>
                  (videoOptions.lineSpacing = Number(v ?? videoOptions.lineSpacing))
              "
              controls-position="compact"
            ></b-numberinput>
          </b-field>
          <b-field
            v-if="
              advancedStore.isAdvanced && videoOptions.verticalAlignment === VerticalAlignment.Top
            "
            horizontal
          >
            <template #label>
              Top Margin
              <viewport-tooltip
                wide
                label="The space above the first line, as a multiple of the font size. A KBP file sets it from its own margins."
              >
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </viewport-tooltip>
            </template>
            <b-numberinput
              expanded
              :model-value="videoOptions.topMargin"
              :min="0"
              :step="0.1"
              :min-step="0.001"
              @update:model-value="
                (v: number | null | undefined) =>
                  (videoOptions.topMargin = Number(v ?? videoOptions.topMargin))
              "
              controls-position="compact"
            ></b-numberinput>
          </b-field>
          <voice-style-settings v-if="voices.length > 1" />
          <style-override-row
            v-if="videoOptions.addTitleScreen && videoOptions.showTitle"
            label="Title"
            tooltip="Draw the title on the title screen with a font and colors of its own. When this is off, the title is drawn like the lyrics."
            :override="videoOptions.titleStyle"
            :base="titleBase"
            :with-secondary="false"
            @set="settingsStore.setTitleStyleField"
            @clear="settingsStore.clearTitleStyle()"
          />
        </settings-section>
      </div>
      <div class="column is-8 preview-column">
        <h3 class="title">Video Preview</h3>
        <b-field
          v-if="mediaStore.backingSources.length > 0"
          label="Preview audio"
          horizontal
          style="margin-bottom: 0.5em"
        >
          <track-select kind="backing" v-model="previewTrack" />
        </b-field>
        <video-preview
          v-if="songFile"
          :song-file="songFile"
          :backing-track="previewBacking ?? undefined"
          :preview-track="previewBacking ? 'backing' : 'full'"
          :gaps="timingsStore.restoredGaps"
          :gap-fade="videoOptions.gapFade"
          :gap-level-balance="videoOptions.gapLevelBalance"
          :subtitles="allVoicesSubtitles()"
          :audio-delay="audioDelay"
          :hint-tone="hintTone"
          :fonts="fontMap"
          :background-color="videoOptions.color.background.toString()"
          :background="videoOptions.useBackground ? (background ?? undefined) : undefined"
          :background-fit="videoOptions.backgroundFit"
          :video-offset="mediaStore.backgroundVideoOffset"
        />
        <b-message v-else type="is-info" :closable="false"
          >Upload a song to see the preview.</b-message
        >
      </div>
    </div>

    <div class="submit-button-container">
      <b-message
        :model-value="submitError !== null"
        @update:model-value="submitError = null"
        type="is-danger"
        has-icon
        icon="circle-exclamation"
      >
        There was a problem generating the video: {{ submitError }}
      </b-message>
      <b-message v-if="!canCreateVideo" type="is-info" :closable="false">
        {{ missingStepsMessage }}
      </b-message>
      <create-video-button
        :submitting="isSubmitting"
        :disabled="!canCreateVideo"
        :song-duration="songDuration ?? undefined"
        :phase="creationPhase"
        :progress="videoProgress"
        :step="creationStep"
        :elapsed-time="elapsedSubmissionTime ?? undefined"
        :separation-progress="mediaStore.separationProgress"
        :separation-stage="mediaStore.separationStage"
        :separation-songs-ahead="mediaStore.separationSongsAhead"
        :waiting-for-separation="waitingForSeparation"
        @create="createVideo"
        @cancel="cancelCreation"
      />
      <div class="download-links">
        <source-file-download-links
          :lyrics="lyricText"
          :timings="timingsText"
          :subtitles="allVoicesSubtitles()"
          :settings="settingsYaml"
          :fonts="usedFontFiles"
          :tracks="mediaStore.trackPairs ?? []"
          :background="background ?? undefined"
        />
        <div v-if="advancedStore.isAdvanced && lyricText.trim()" class="kbp-export is-size-7">
          <span>Karaoke Builder Studio</span>
          <viewport-tooltip
            wide
            label="These lyrics and timings as a Karaoke Builder Studio project. They aren't included in the project download."
          >
            <b-icon size="is-small" icon="circle-question"></b-icon>
          </viewport-tooltip>
          <button type="button" class="link-button ml-1" @click="downloadKbp">
            {{ kbpFileName }}
          </button>
        </div>
      </div>
      <b-message
        v-if="advancedStore.isAdvanced && kbpExportWarnings.length"
        class="kbp-warnings mt-3"
        type="is-warning"
        size="is-small"
        title="Some parts may not look the same in KBS"
        closable
        @close="kbpExportWarnings = []"
      >
        <ul>
          <li v-for="warning in kbpExportWarnings" :key="warning">{{ warning }}</li>
        </ul>
      </b-message>
    </div>
    <background-replacement-modal
      v-model="isConfirmingBackground"
      :current="background ?? undefined"
      :replacement="pendingBackground"
      @confirm="mediaStore.background = pendingBackground"
    />
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent, markRaw } from "vue";
import { storeToRefs } from "pinia";
import {
  FRAME_RATES,
  KaraokeOptions,
  OutputFormat,
  RESOLUTIONS,
  RenderQuality,
  VerticalAlignment,
} from "@/lib/timing";
import VideoPreview from "@/components/VideoPreview.vue";
import SourceFileDownloadLinks from "@/components/SourceFileDownloadLinks.vue";
import CreateVideoButton from "@/components/CreateVideoButton.vue";
import VoiceStyleSettings from "@/components/VoiceStyleSettings.vue";
import ColorField from "@/components/ColorField.vue";
import FileUpload from "@/components/FileUpload.vue";
import SymbolPicker from "@/components/SymbolPicker.vue";
import TrackSelect from "@/components/TrackSelect.vue";
import ViewportTooltip from "@/components/ViewportTooltip.vue";
import SettingsSection from "@/components/SettingsSection.vue";
import StyleOverrideRow from "@/components/StyleOverrideRow.vue";
import jszip from "jszip";
import video, { CreateVideoOptions } from "@/lib/video";
import type { HintTone } from "@/lib/hintTone";
import { CreationPhase, TrackSource } from "@/types";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore, VideoSettings } from "@/stores/settings";
import { useTimingsStore } from "@/stores/timings";
import { useAdvancedStore } from "@/stores/advanced";
import { useLyricsStore } from "@/stores/lyrics";
import { useFallbackFontsStore } from "@/stores/fallbackFonts";
import { abortable } from "@/lib/util";
import {
  TITLE_FRAME_ENTRY_NAME,
  projectBackgroundEntryName,
  projectSongEntryName,
  trackEntries,
} from "@/lib/projectFolder";
import {
  BACKGROUND_EXTENSIONS,
  BackgroundKind,
  backgroundKind,
  isBackgroundFile,
} from "@/lib/background";
import BackgroundReplacementModal from "@/components/BackgroundReplacementModal.vue";
import FontField from "@/components/FontField.vue";
import { COUNT_IN_SYMBOLS, fontFamiliesIn } from "@/lib/fonts";
import { projectFilesToKbp } from "@/lib/kbpConvert";
import { applyVoiceStyle } from "@/lib/voiceStyle";
import { restoredBacking } from "@/lib/gapMix";
import { HIGHEST_HINT_FREQUENCY, LOWEST_HINT_FREQUENCY, hintFrequency } from "@/lib/notes";

// The rest of the bar is the zip, which carries the source song and both separated tracks.
const RENDER_SHARE = 0.95;

type VideoAudio = Pick<CreateVideoOptions, "backing" | "mainTrack" | "alternateTracks">;

const qualityLabels: Record<RenderQuality, string> = {
  standard: "Standard",
  high: "High",
};

export default defineComponent({
  components: {
    VideoPreview,
    SourceFileDownloadLinks,
    CreateVideoButton,
    VoiceStyleSettings,
    ColorField,
    FileUpload,
    FontField,
    BackgroundReplacementModal,
    SymbolPicker,
    TrackSelect,
    ViewportTooltip,
    SettingsSection,
    StyleOverrideRow,
  },
  setup() {
    const mediaStore = useMediaStore();
    const settingsStore = useSettingsStore();
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    const fallbackFontsStore = useFallbackFontsStore();
    const { lyricText, voices } = storeToRefs(lyricsStore);
    const { allVoicesSubtitles } = storeToRefs(timingsStore);
    return {
      mediaStore,
      settingsStore,
      timingsStore,
      lyricsStore,
      fallbackFontsStore,
      advancedStore: useAdvancedStore(),
      lyricText,
      voices,
      allVoicesSubtitles,
    };
  },
  data() {
    return {
      // What the last KBP download couldn't carry over.
      kbpExportWarnings: [] as string[],
      countInSymbols: COUNT_IN_SYMBOLS,
      qualityLabels,
      resolutions: Object.keys(RESOLUTIONS),
      frameRates: FRAME_RATES,
      VerticalAlignment,
      backgroundExtensions: BACKGROUND_EXTENSIONS,
      isConfirmingBackground: false,
      pendingBackground: null as File | null,
      isSubmitting: false,
      elapsedSubmissionTime: null as number | null,
      creationPhase: CreationPhase.NotStarted,
      waitingForSeparation: false,
      videoProgress: 0,
      creationStep: "",
      submitError: null as string | null,
      // Which track the preview plays: "full" (with vocals) or the source of a backing track.
      previewTrack: "full" as "full" | TrackSource,
      // Vue would proxy the controller, whose methods need the instance itself.
      creation: markRaw({ abort: null as AbortController | null }),
      // Whether the settings column has content past its top and bottom edges. See the fade in the styles.
      scrollHints: { above: false },
      // Nothing rendered here, so keep Vue out of it.
      hintObserver: markRaw({ observer: null as ResizeObserver | null }),
    };
  },
  mounted() {
    // The tab starts hidden, so the column has no size to measure until it is opened.
    // The observer's first callback is what catches that, and the tab strip resizing it later.
    this.hintObserver.observer = new ResizeObserver(() => this.updateScrollHints());
    const settingsColumn = this.$refs.settingsColumn as HTMLElement | undefined;
    if (settingsColumn) {
      this.hintObserver.observer.observe(settingsColumn);
    }
  },
  // Fields appear and disappear with the count-in mode and the uploaded font,
  // which changes how far a column scrolls without anyone scrolling it.
  updated() {
    this.updateScrollHints();
  },
  beforeUnmount() {
    this.hintObserver.observer?.disconnect();
  },
  computed: {
    canCreateVideo() {
      return (
        this.mediaStore.songFile &&
        this.lyricText.length > 0 &&
        this.timingsStore.areTimingsFinished
      );
    },
    missingStepsMessage(): string {
      const steps = [];
      if (!this.mediaStore.songFile) {
        steps.push("upload a song");
      }
      if (this.lyricText.length === 0) {
        steps.push("enter lyrics");
      }
      if (!this.timingsStore.areTimingsFinished) {
        steps.push("finish timing the lyrics");
      }
      const last = steps.pop();
      const stepText = steps.length > 0 ? `${steps.join(", ")} and ${last}` : last;
      return `To create your video, ${stepText}.`;
    },
    videoOptions: {
      get() {
        return this.settingsStore.videoOptions;
      },
      set(newValue: VideoSettings) {
        this.settingsStore.videoOptions = newValue;
      },
    },
    renderOptions() {
      return this.settingsStore.renderOptions;
    },
    // Keyed by the name an ASS style row references, not by file name.
    fontMap(): Record<string, string> {
      const faces = this.settingsStore.fontFaces;
      const uploaded = new Set(faces.map((face) => face.name.toLowerCase()));
      // An uploaded face named like a bundled font takes its place.
      const bundled = Object.entries(this.fallbackFontsStore.fontUrls).filter(
        ([family]) => !uploaded.has(family.toLowerCase()),
      );
      return Object.fromEntries([...bundled, ...faces.map((face) => [face.name, face.url])]);
    },
    // Only these are written for FFmpeg's libass, which has no fonts of its own to fall back on.
    renderFontMap(): Record<string, string> {
      // libass matches family names case-insensitively.
      const families = new Set(
        [...fontFamiliesIn(this.allVoicesSubtitles())].map((family) => family.toLowerCase()),
      );
      return Object.fromEntries(
        Object.entries(this.fontMap).filter(([family]) => families.has(family.toLowerCase())),
      );
    },
    // The title is drawn on the first voice's style.
    titleBase(): KaraokeOptions {
      const [first] = this.timingsStore.voicesWithTimings;
      const style = first === undefined ? undefined : this.settingsStore.getVoiceStyle(first);
      return applyVoiceStyle(this.videoOptions, style);
    },
    songFile(): File | null {
      return this.mediaStore.songFile as File | null;
    },
    // The uploaded font files the settings name, which the project download carries.
    usedFontFiles(): File[] {
      const { videoOptions, voiceStyles } = this.settingsStore;
      const named = [
        videoOptions.font.name,
        videoOptions.titleStyle.fontName,
        ...Object.values(voiceStyles).map((style) => style.fontName),
      ];
      const used = new Set(named.map((name) => name?.toLowerCase()));
      return this.settingsStore.fontFaces
        .filter((face) => used.has(face.name.toLowerCase()))
        .map((face) => face.file);
    },
    rendersFullTrack(): boolean {
      return this.advancedStore.isAdvanced && this.mediaStore.renderTrackSource === "full";
    },
    mkvExtraTracks(): string {
      return this.rendersFullTrack
        ? "the backing track and the vocals"
        : "the vocals and the original mix";
    },
    outputFormatLabels(): Record<OutputFormat, string> {
      return {
        mp4: "MP4",
        mkv: this.rendersFullTrack
          ? "MKV, with backing and vocal tracks"
          : "MKV, with vocal and original tracks",
      };
    },
    previewBacking(): Blob | null {
      return this.mediaStore.trackFor("backing", this.previewTrack);
    },
    restoreGapsMessage(): string {
      return this.videoOptions.restoreGaps &&
        this.timingsStore.hasAnyTimings &&
        !this.timingsStore.gapPlan.complete
        ? "The gaps are restored once every syllable is timed."
        : "";
    },
    songDuration() {
      return this.mediaStore.songDuration;
    },
    background(): Blob | null {
      return this.mediaStore.background as Blob | null;
    },
    // The upload field shows a file, and every background but one saved by an old version is one.
    backgroundFile(): File | null {
      return this.background instanceof File ? this.background : null;
    },
    backgroundKind(): BackgroundKind | null {
      return this.background ? backgroundKind(this.background) : null;
    },
    audioDelay(): number {
      return this.timingsStore.audioDelay;
    },
    hintNoteError(): string {
      const text = this.mediaStore.hintNote ?? "";
      return text.trim() && !hintFrequency(text)
        ? `Type a note from A1 to G6, or a frequency from ${LOWEST_HINT_FREQUENCY} to ${HIGHEST_HINT_FREQUENCY} Hz.`
        : "";
    },
    hintTone(): HintTone | null {
      const frequency = hintFrequency(this.mediaStore.hintNote ?? "");
      if (!frequency || !this.videoOptions.addTitleScreen) {
        return null;
      }
      return { frequency, seconds: this.videoOptions.titleScreenDuration };
    },
    kbpFileName(): string {
      const song = this.mediaStore.songFile?.name;
      return song ? song.replace(/\.[^.]*$/, "") + ".kbp" : "project.kbp";
    },
    zipFileName(): string {
      return `${this.videoFileName}.zip`;
    },
    videoFileName(): string {
      const extension = this.videoOptions.outputFormat;
      if (this.mediaStore.songArtist && this.mediaStore.songTitle) {
        return `${this.mediaStore.songArtist} - ${this.mediaStore.songTitle} [karaoke].${extension}`;
      }
      return `karaoke.${extension}`;
    },
    timings() {
      return this.timingsStore.rawTimings;
    },
    timingsText(): string {
      return this.timingsStore.timingsText;
    },
    settingsYaml(): string {
      return this.settingsStore.settingsYaml;
    },
  },
  methods: {
    /**
     * Put a symbol into the count-in text where the cursor was, replacing any selection.
     */
    insertCountInSymbol(symbol: string) {
      const input = (this.$refs.countInInput as { $refs: { input: HTMLInputElement } }).$refs.input;
      const text = this.videoOptions.countInText;
      const start = input.selectionStart ?? text.length;
      const end = input.selectionEnd ?? text.length;
      this.videoOptions.countInText = text.slice(0, start) + symbol + text.slice(end);
      const cursor = start + symbol.length;
      // The input has lost focus to the picker but still keeps its cursor for the next pick.
      this.$nextTick(() => input.setSelectionRange(cursor, cursor));
    },
    updateScrollHints() {
      const el = this.$refs.settingsColumn as HTMLElement | undefined;
      // Sub-pixel leftovers are rounding, not content.
      this.scrollHints.above = !!el && el.scrollTop > 1;
    },
    // Stops whatever the submission is doing.
    // A separation that was already running when the video was requested keeps going:
    // the user called off the video, not the work the Song File tab started.
    cancelCreation() {
      this.creation.abort?.abort();
      if (!this.waitingForSeparation) {
        this.mediaStore.cancelSeparation();
      }
    },
    onBackgroundSelect(file: File | null) {
      if (file && !isBackgroundFile(file)) {
        this.$buefy.toast.open({
          message:
            "A background can be a PNG, JPEG or WebP image, or an MP4, WebM, MOV or MKV video.",
          type: "is-warning",
          duration: 5000,
        });
        return;
      }
      if (this.background) {
        this.pendingBackground = file;
        this.isConfirmingBackground = true;
        return;
      }
      this.mediaStore.background = file;
    },
    /**
     * The backing track the video plays, separated first if need be, with its gaps restored.
     */
    async backingAudio(
      songFile: File,
      videoOptions: VideoSettings,
      signal: AbortSignal,
    ): Promise<VideoAudio> {
      const separatedTrack =
        this.mediaStore.separatedTrack ??
        (await abortable(
          this.mediaStore.startSeparation(songFile, this.mediaStore.separationModel),
          signal,
        ));
      if (!separatedTrack) {
        throw new Error(this.mediaStore.error ?? "Track separation failed");
      }
      const gaps = this.timingsStore.restoredGaps;
      if (gaps.length > 0) {
        this.creationStep = "restoring the gaps";
      }
      const backing = await abortable(
        restoredBacking(separatedTrack.backing, songFile, gaps, {
          fade: videoOptions.gapFade,
          balance: videoOptions.gapLevelBalance,
        }),
        signal,
      );
      const restored = backing !== separatedTrack.backing;
      return {
        backing,
        mainTrack: restored ? "restoredBacking" : "backing",
        alternateTracks: {
          ...(restored && { backing: separatedTrack.backing }),
          vocals: separatedTrack.vocals,
          original: songFile,
        },
      };
    },
    async createVideo() {
      const songFile = this.songFile;
      if (!songFile) {
        return;
      }
      const abort = new AbortController();
      this.creation.abort = abort;
      let elapsedTimeInterval: ReturnType<typeof setInterval> | undefined;
      this.isSubmitting = true;
      try {
        this.videoProgress = 0;
        this.creationStep = "";
        const videoOptions = { createTitleScreens: true, ...this.renderOptions };
        let audio: VideoAudio;
        if (this.rendersFullTrack) {
          const pair = this.mediaStore.separatedTrack;
          audio = {
            backing: songFile,
            mainTrack: "original",
            alternateTracks: { backing: pair?.backing, vocals: pair?.vocals },
          };
        } else {
          this.creationPhase = CreationPhase.SeparatingVocals;
          // A separation started from the Song File tab keeps running and this one only waits on
          // it, which otherwise looks like a stalled render.
          this.waitingForSeparation =
            this.mediaStore.isProcessing && !this.mediaStore.separatedTrack;
          elapsedTimeInterval = setInterval(() => {
            if (!this.mediaStore.separationStartTime) {
              return;
            }
            this.elapsedSubmissionTime =
              new Date().getTime() - this.mediaStore.separationStartTime.getTime();
          }, 1000);
          audio = await this.backingAudio(songFile, videoOptions, abort.signal);
        }
        this.creationPhase = CreationPhase.CreatingVideo;
        this.waitingForSeparation = false;
        const { video: videoFile, titleFrame } = await video.createVideo({
          ...audio,
          background: videoOptions.useBackground ? this.background : null,
          backgroundVideoOffset: this.mediaStore.backgroundVideoOffset,
          subtitles: this.allVoicesSubtitles(),
          audioDelay: this.audioDelay,
          hintTone: this.hintTone,
          titleFrameTime: this.timingsStore.titleFrameTime,
          videoOptions,
          metadata: {
            artist: this.mediaStore.songArtist ?? undefined,
            title: this.mediaStore.songTitle ?? undefined,
            duration: this.mediaStore.songDuration ?? undefined,
          },
          fontMap: this.renderFontMap,
          signal: abort.signal,
          onProgress: (progress, step) => {
            this.videoProgress = progress * RENDER_SHARE;
            this.creationStep = step;
          },
        });
        await this.zipAndSendFiles(videoFile, titleFrame, abort.signal);
      } catch (e) {
        if (!abort.signal.aborted) {
          console.error(e);
          this.submitError = e instanceof Error ? e.message : String(e);
        }
      } finally {
        if (this.creation.abort === abort) {
          this.creation.abort = null;
        }
        this.isSubmitting = false;
        clearInterval(elapsedTimeInterval);
        this.elapsedSubmissionTime = null;
        this.creationPhase = CreationPhase.NotStarted;
        this.waitingForSeparation = false;
        this.creationStep = "";
      }
    },

    downloadKbp() {
      const { kbp, warnings } = projectFilesToKbp({
        lyrics: this.lyricText,
        timings: this.timingsStore.segmentsByVoice,
        settings: this.settingsYaml,
        audioName: this.mediaStore.songFile?.name ?? null,
      });
      this.kbpExportWarnings = warnings;
      const anchor = document.createElement("a");
      anchor.style.display = "none";
      anchor.href = URL.createObjectURL(new Blob([kbp], { type: "text/plain;charset=utf-8" }));
      anchor.download = this.kbpFileName;
      anchor.click();
      URL.revokeObjectURL(anchor.href);
    },
    async sendZipFile(zipFile: Blob) {
      const anchor = document.createElement("a");
      const filename = this.zipFileName;

      anchor.style.display = "none";
      anchor.href = URL.createObjectURL(zipFile);
      anchor.download = filename;
      anchor.click();
    },
    async zipAndSendFiles(
      videoBlob: Uint8Array,
      titleFrame: Uint8Array | null,
      signal?: AbortSignal,
    ) {
      signal?.throwIfAborted();
      const zip = new jszip();
      zip.file(this.videoFileName, videoBlob);
      if (titleFrame) {
        zip.file(TITLE_FRAME_ENTRY_NAME, titleFrame);
      }
      zip.file("subtitles.ass", this.allVoicesSubtitles());
      zip.file("lyrics.txt", this.lyricText);
      zip.file("timings.txt", this.timingsText);
      zip.file("settings.yaml", this.settingsYaml);
      for (const font of this.usedFontFiles) {
        zip.file(font.name, font);
      }

      // Named after its role rather than kept as uploaded,
      // so a folder extracted from this zip can tell the source song from the karaoke video beside it.
      if (this.songFile) {
        zip.file(projectSongEntryName(this.songFile.name), this.songFile);
      }
      if (this.background) {
        zip.file(projectBackgroundEntryName(this.background), this.background);
      }

      for (const { name, blob } of trackEntries(this.mediaStore.trackPairs ?? [])) {
        zip.file(name, blob);
      }

      this.creationStep = "packaging the files";
      const zipBlob = await zip.generateAsync({ type: "blob" }, ({ percent }) => {
        this.videoProgress = RENDER_SHARE + (percent / 100) * (1 - RENDER_SHARE);
      });
      // jszip has no way to stop, so a cancel lands here as a download not offered.
      signal?.throwIfAborted();
      await this.sendZipFile(zipBlob);
    },
  },
});
</script>
<style>
.field.is-horizontal .field-label {
  flex-grow: 3;
}
</style>
<style scoped>
.kbp-warnings ul {
  list-style: disc;
  padding-left: 1.25em;
}

.download-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  row-gap: 0.25rem;
  margin-top: 0.75rem;
}

.kbp-export {
  white-space: nowrap;
  border-left: 1px solid var(--bulma-border);
  margin-left: 0.75rem;
  padding-left: 0.75rem;
}

/* Narrow screens put the export on a line of its own, where a divider would lead nowhere. */
@media screen and (max-width: 768px) {
  .kbp-export {
    border-left: none;
    margin-left: 0;
    padding-left: 0;
  }
}

/* Buefy pins every .tab-item at flex-shrink: 0,
which would hold the tab open at its content height inside the clipped .tab-content
and leave nothing for overflow to scroll. */
.b-tabs .tab-content .submit-tab {
  display: flex;
  flex-direction: column;
  flex-shrink: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

/* Bulma only lays the columns side by side from its tablet breakpoint up.
Once they are, the settings list scrolls on its own rather than pushing Create Video off the bottom,
and the preview fits itself to the height beside it.
Below the breakpoint the columns are stacked blocks and the tab scrolls as one. */
@media screen and (min-width: 769px) {
  .b-tabs .tab-content .submit-tab {
    overflow-y: hidden;
  }

  .submit-tab > .columns {
    flex: 1 1 auto;
    min-height: 0;
  }

  .submit-tab > .columns > .column {
    min-height: 0;
  }

  /* Themed, always-on scrollbar for supporting browsers (not Firefox). */
  .settings-column {
    overflow-y: auto;
    scrollbar-color: var(--bulma-border) transparent;
    scrollbar-gutter: stable;
  }

  .preview-column {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* The height the heading and the track picker leave, which the preview fits itself into. */
  .preview-column > .preview-container {
    flex: 1 1 auto;
    min-height: 0;
  }

  /* Fading the content out at an edge reads as "there is more this way" in every browser,
  scrollbar or no scrollbar.
  The bottom fade is always on, so it doesn't pop in when a section grows past the edge.
  The padding of the same height lets the last setting scroll clear of it.
  The top fade only shows once the column is scrolled, so the heading stays crisp at rest. */
  .settings-column {
    --fade-below: 2.5rem;
    padding-bottom: var(--fade-below);
    mask-image: linear-gradient(
      to bottom,
      transparent 0,
      #000 var(--fade-above, 0px),
      #000 calc(100% - var(--fade-below)),
      transparent 100%
    );
  }

  .settings-column.has-more-above {
    --fade-above: 2.5rem;
  }

  .submit-button-container {
    flex-shrink: 0;
  }
}

.submit-tab .column {
  text-align: center;
}

/* Flex items default to refusing to shrink below their content,
which here means a long file name widens its field until it overflows the column. */
.submit-tab :deep(.field-body > .field) {
  min-width: 0;
}

/* Bulma decides label-beside-control on the viewport, from its tablet breakpoint up.
This column is a third of the viewport, so it has to answer to its own width instead. */
.settings-column {
  container-type: inline-size;
}

/* An even split with the control, rather than the global 3:5:
this is the narrow column, and at 3:5 twice as many of its labels wrap onto a second line. */
@container (min-width: 30rem) {
  .settings-column :deep(.field.is-horizontal > .field-label) {
    flex-grow: 5;
  }
}

/* Undo what Bulma's own breakpoint adds, which is all that makes the row. */
@container (max-width: 30rem) {
  .settings-column :deep(.field.is-horizontal) {
    display: block;
  }

  .settings-column :deep(.field-label) {
    flex: initial;
    margin-block-end: 0.5rem;
    margin-inline-end: 0;
    text-align: left;
  }

  /* Bulma lays .field-body's controls out in a row from its tablet breakpoint up,
  which keeps a multi-control field (the count-in buttons) on one line once the label moves off it.
  Only the wrapping is ours, for when even that row runs out of room. */
  .settings-column :deep(.field-body) {
    flex-wrap: wrap;
    row-gap: 0.5rem;
  }
}

/* Bulma's label padding assumes a one-line input; these rows hold taller controls. */
.submit-tab :deep(.field.is-horizontal) {
  align-items: center;
}

.submit-tab :deep(.field.is-horizontal > .field-label) {
  padding-top: 0;
}

.submit-tab .radios {
  width: 100%;
  flex-wrap: nowrap;
  column-gap: 0;
  justify-content: space-between;
}

.submit-tab .radios :deep(.radio) {
  white-space: nowrap;
}
</style>
