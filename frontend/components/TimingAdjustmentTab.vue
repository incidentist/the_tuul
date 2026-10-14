<template>
  <b-tab-item
    value="adjust"
    icon="stopwatch"
    label="Timing"
    :disabled="!isEnabled"
    class="timing-adjustment-tab"
    :class="{ 'is-immersive': isImmersive }"
    headerClass="timing-adjustment-tab-header"
  >
    <div v-if="isImmersive" class="immersive-bar" role="toolbar" aria-label="Timing">
      <div class="buttons">
        <b-button icon-left="bars" aria-label="Menu" @click="$emit('open-drawer')" />
        <b-button
          icon-left="arrow-rotate-left"
          aria-label="Undo"
          :title="undoTitle"
          :disabled="!canStep('undo')"
          @click="stepHistory('undo')"
        />
        <span
          v-if="timingStatus"
          class="immersive-status"
          :class="timingStatus === 'done' ? 'has-text-success' : 'has-text-warning'"
          role="img"
          :aria-label="statusTitle"
          :title="statusTitle"
        >
          <b-icon :icon="timingStatus === 'done' ? 'check' : 'warning'" />
        </span>
      </div>
      <div id="immersive-overview" class="immersive-overview" />
      <div class="buttons">
        <b-button
          v-if="canFullScreen"
          :icon-left="isFullScreen ? 'compress' : 'expand'"
          :aria-label="isFullScreen ? 'Leave full screen' : 'Full screen'"
          @click="toggleFullScreen"
        />
      </div>
    </div>
    <div class="title-row">
      <div class="title-main">
        <h2 class="title">Timing</h2>
        <Teleport defer to="#navbar-tab-status" :disabled="!isCompact">
          <button
            v-if="timingStatus && acknowledgedStatus === timingStatus"
            type="button"
            class="status-icon"
            :class="timingStatus === 'done' ? 'has-text-success' : 'has-text-warning'"
            :aria-label="statusTitle"
            :title="`${statusTitle}. Click for more.`"
            @click="acknowledgedStatus = null"
          >
            <b-icon :icon="timingStatus === 'done' ? 'check' : 'warning'" />
          </button>
        </Teleport>
      </div>
      <div class="title-actions">
        <b-button
          v-if="canSync"
          icon-left="wand-magic-sparkles"
          label="Sync"
          title="Time this voice automatically from its vocals"
          @click="openSync"
        />
        <b-button
          v-if="canMarkChecked"
          icon-left="check"
          label="Mark as checked"
          :title="`Clear the review flag of the selected syllables (${keyLabels.markChecked})`"
          @click="markChecked"
        />
        <div v-if="reviewIndices.length > 0" class="buttons has-addons review-nav">
          <b-button
            icon-left="angle-left"
            aria-label="Previous syllable to review"
            :title="`Previous syllable to review (${keyLabels.previousReview})`"
            @click="goToReview(-1)"
          />
          <span class="button is-static review-count" :title="reviewCountTitle">
            <b-icon icon="flag" size="is-small" />
            <span>{{ reviewIndices.length }}</span>
          </span>
          <b-button
            icon-left="angle-right"
            aria-label="Next syllable to review"
            :title="`Next syllable to review (${keyLabels.nextReview})`"
            @click="goToReview(1)"
          />
        </div>
        <b-button
          v-if="isTapMode"
          icon-left="keyboard"
          aria-label="Timing buttons"
          :aria-pressed="showTapButtons"
          :type="showTapButtons ? 'is-primary' : ''"
          title="Show or hide buttons for tapping without a keyboard"
          @click="showTapButtons = !showTapButtons"
        />
        <b-button
          v-if="displayMode"
          icon-left="eraser"
          aria-label="Reset line display times"
          title="Put every line of this voice back on its automatic display times"
          :disabled="!activeVoiceHasDisplayPeriods"
          @click="timingsStore.clearDisplayPeriods(activeVoice)"
        />
        <b-button
          v-else-if="mixMode"
          icon-left="eraser"
          aria-label="Reset mute times"
          title="Put every line of every voice back on its automatic mute times"
          :disabled="!timingsStore.hasMuteBounds"
          @click="timingsStore.clearMuteBounds()"
        />
        <b-button
          v-else
          icon-left="eraser"
          aria-label="Reset timings"
          title="Clear every timing of this voice"
          :disabled="!hasTimings && !pass"
          @click="resetTimings"
        />
        <voice-selector />
      </div>
    </div>
    <help-section>
      <template v-if="isTapMode">
        <p>
          Play the song and tap along. The queue on the waveform lists the syllables to time,
          starting at the playhead. Press <kbd>{{ keyLabels.start }}</kbd> as the highlighted
          syllable starts, and the next one takes its place. A syllable lasts until the next one
          starts, so press <kbd>{{ keyLabels.end }}</kbd> only where the singer pauses.
        </p>
        <p>
          Your taps are saved when playback stops. While paused, either key plays from the playhead.
          <kbd>{{ keyLabels.redo }}</kbd> goes back a line, and <kbd>Esc</kbd> stops.
        </p>
        <p>
          Click a rectangle or a syllable in the queue to tap again from there. The playhead moves
          back by the preroll set below, so you hear the run-up. Clicking a syllable that isn't
          timed yet takes you back to where the timing stops. In the queue, timed syllables are
          tinted purple, and checkered ones have a start but no end.
        </p>
        <p>
          <kbd>{{ undoShortcut }}</kbd> takes back your last tap and moves the playhead to just
          before it. If the song is playing, it plays on from there.
          <kbd>{{ redoShortcut }}</kbd> puts a tap back while paused. The eraser clears every timing
          of this voice, which you can undo too.
        </p>
        <p>
          The <kbd>{{ keyLabels.seekBack }}</kbd> and <kbd>{{ keyLabels.seekForward }}</kbd> keys
          move the playhead by the preroll, and so does scrolling sideways on the waveform. Scroll
          up and down, or press the <kbd>{{ keyLabels.zoomIn }}</kbd> and
          <kbd>{{ keyLabels.zoomOut }}</kbd> keys, to zoom. Press
          <kbd>{{ keyLabels.switchMode }}</kbd> to switch to {{ editModeName }} mode. The keyboard
          button at the top of the page lists every key, and lets you change them.
        </p>
        <p v-if="reviewIndices.length > 0">
          A lyric edit changed the timings of the syllables outlined in red or orange. Those
          outlined in yellow were placed by syncing, which wasn't sure of them. The arrows by the
          heading make the next or previous one the syllable to tap. The
          <kbd>{{ keyLabels.nextReview }}</kbd> and <kbd>{{ keyLabels.previousReview }}</kbd> keys
          do the same.
        </p>
        <p v-if="canSync">
          <strong>Sync</strong> times this voice for you from its vocals. It then switches to Adjust
          mode, where you check its work.
        </p>
        <p class="legacy-tab-switch">
          Looking for the old timing tab?
          <b-switch v-model="legacyTimingStore.isShown">Show it</b-switch>
        </p>
      </template>
      <template v-else>
        <template v-if="displayMode">
          <p>
            Each line gets a frame for the time it's on screen. Drag its edges to change when the
            line appears and disappears, or double-click an edge to go back to the automatic time.
            Drag a frame to move both its edges. A frame always keeps its line's syllables inside
            it, and stops at the lines shown at the same height. Dashed edges are automatic, and
            solid ones were set by hand.
          </p>
          <p>
            Click a frame to select it, then click another to select everything in between. You can
            also drag a box across the waveform from a bare spot to select every frame it touches.
            Click a selected frame or a bare spot on the waveform, or press <kbd>Esc</kbd>, to clear
            the selection. Dragging a selected frame moves the whole selection, and dragging an edge
            of one moves that edge of every selected frame.
          </p>
        </template>
        <template v-else-if="mixMode">
          <p>
            The video plays the original song where nobody sings, so only the sung parts lose what
            the separation removed. Each line gets a frame for the time the backing track plays
            around it. The shaded stretches between frames play the original, and playback here
            plays the mix as the video will.
          </p>
          <p>
            The settings below set how far the frames reach before and after each line, the shortest
            gap worth restoring, and how long the fades last. A hatched gap sounds the same in both
            tracks, so restoring it changes nothing. A line marked with ⚠ ends on a syllable without
            an end, which runs on to the next line and leaves no gap after it. Set that end in
            Adjust mode to restore what follows.
          </p>
          <p>
            Drag a frame's edges to mute more or less of the song around one line, or double-click
            an edge to go back to the settings. A frame always keeps its line's syllables inside it,
            except that it may start up to 0.2 seconds after the first one, in the part shaded
            yellow. Dashed edges follow the settings, and solid ones were set by hand.
          </p>
        </template>
        <template v-else>
          <p>
            Drag the left edge of a rectangle to change when a syllable starts, and the right edge
            to change when it ends. Drag an end onto the next start to join the two. Once they're
            joined, dragging that start moves the end before it too.
          </p>
          <p>
            Click a rectangle to select it, then click another to select everything in between. You
            can also drag across the waveform from a bare spot to select every rectangle in that
            stretch of time. Click a selected rectangle or a bare spot on the waveform, or press
            <kbd>Esc</kbd>, to clear the selection.
          </p>
          <p>
            Drag a rectangle to move it, or a selected one to move the whole selection. While the
            song is paused, clicking a syllable plays it, and so does letting go of what you
            dragged. Once it has played, the playhead goes back to the preroll before it. While the
            song plays, letting go moves the playhead to the preroll before what you dragged, and
            the song plays on from there.
          </p>
        </template>
        <p>
          <kbd>{{ keyLabels.playPause }}</kbd> plays and pauses.
          <kbd>{{ keyLabels.replay }}</kbd> replays from the last spot you picked by clicking the
          waveform, stepping or dragging a timing. The <kbd>{{ keyLabels.seekBack }}</kbd> and
          <kbd>{{ keyLabels.seekForward }}</kbd> keys step by the preroll set below, and the
          <kbd>{{ keyLabels.seekBackFar }}</kbd> and <kbd>{{ keyLabels.seekForwardFar }}</kbd> keys
          five times as far. The <kbd>{{ keyLabels.viewStart }}</kbd> and
          <kbd>{{ keyLabels.viewEnd }}</kbd> keys jump to the edges of the view, and the
          <kbd>{{ keyLabels.songStart }}</kbd> and <kbd>{{ keyLabels.songEnd }}</kbd> keys to the
          start and end of the song. Scroll up and down on the waveform, or press the
          <kbd>{{ keyLabels.zoomIn }}</kbd> and <kbd>{{ keyLabels.zoomOut }}</kbd> keys, to zoom.
        </p>
        <p>
          <kbd>{{ undoShortcut }}</kbd> and <kbd>{{ redoShortcut }}</kbd> undo and redo your edits,
          including those made to the lyrics and in other tabs.
          <template v-if="displayMode">
            The eraser puts every line of this voice back on automatic times, which you can undo
            too.
          </template>
          <template v-else-if="mixMode">
            The eraser puts every line of every voice back on the settings above, which you can undo
            too.
          </template>
          <template v-else>
            The eraser clears every timing of this voice, which you can undo too.
          </template>
          Press <kbd>{{ keyLabels.switchMode }}</kbd> to switch to Tap mode. The keyboard button at
          the top of the page lists every key, and lets you change them.
        </p>
        <p v-if="reviewIndices.length > 0 && !displayMode && !mixMode">
          Syllables to check are drawn in red, orange or yellow, with a line across the waveform at
          each. Red ones lost their timing in a lyric edit and sit where the syllables around them
          put them. Orange ones took their timing from a word a lyric edit replaced. Yellow ones
          were placed by syncing, which wasn't sure of them. The arrows by the heading go from one
          to the next and move the playhead to the preroll before it. The
          <kbd>{{ keyLabels.nextReview }}</kbd> and <kbd>{{ keyLabels.previousReview }}</kbd> keys
          do the same. Moving a syllable clears its mark, and <strong>Mark as checked</strong>, or
          the <kbd>{{ keyLabels.markChecked }}</kbd> key, clears it on the selected syllables
          without moving them, then goes to the next one.
        </p>
        <p v-if="canSync && !displayMode">
          <strong>Sync</strong> times this voice for you from its vocals: the lines around the
          syllables without a timing, the lines you selected, or all of them.
        </p>
      </template>
    </help-section>
    <p class="rotate-hint notification is-info">
      Turn your phone sideways to give the waveform the whole screen.
    </p>
    <b-message
      v-if="timingStatus && acknowledgedStatus !== timingStatus"
      :key="timingStatus"
      :type="timingStatus === 'done' ? 'is-success' : 'is-warning'"
      has-icon
      :icon="timingStatus === 'done' ? 'check' : 'warning'"
      icon-size="is-small"
      class="status-message"
    >
      <!-- Buefy only draws a close button in a titled header, which this short message goes without. -->
      <div class="status-message-body">
        <span v-if="timingStatus === 'almost'">
          Almost done! Press <kbd>{{ keyLabels.end }}</kbd> when the last line ends.
        </span>
        <span v-else>
          Done! You've got everything you need to create your video. Go to the Submit tab.
        </span>
        <button
          type="button"
          class="delete"
          aria-label="Tuck the message away"
          title="Tuck the message away. Its icon by the heading brings it back."
          @click="tuckStatusMessage"
        />
      </div>
    </b-message>
    <div class="adjust-top">
      <Teleport defer to="#drawer-settings-adjust" :disabled="!isCompact">
        <div class="adjustment-form" :class="{ 'is-in-drawer': isCompact }">
          <div
            class="adjustment-fields"
            :class="{ 'has-more-above': settingsScrolled }"
            @scroll="onSettingsScroll"
          >
            <b-field label="Mode" horizontal>
              <div class="buttons has-addons mode-switch">
                <b-button
                  :type="isTapMode ? 'is-primary' : ''"
                  :aria-pressed="isTapMode"
                  :title="`Tap the timings as the song plays (${keyLabels.switchMode})`"
                  @click="setMode('tap')"
                >
                  Tap
                </b-button>
                <b-button
                  :type="isAdjustMode ? 'is-primary' : ''"
                  :aria-pressed="isAdjustMode"
                  :disabled="!hasTimings"
                  :title="`Drag the timings into place (${keyLabels.switchMode})`"
                  @click="setMode('adjust')"
                >
                  Adjust
                </b-button>
                <b-button
                  v-if="advancedStore.isAdvanced"
                  :type="displayMode ? 'is-primary' : ''"
                  :aria-pressed="displayMode"
                  :disabled="!hasTimings"
                  :title="`Drag when each line is on screen (${keyLabels.switchMode})`"
                  @click="setMode('lines')"
                >
                  Lines
                </b-button>
                <b-button
                  v-if="advancedStore.isAdvanced"
                  :type="mixMode ? 'is-primary' : ''"
                  :aria-pressed="mixMode"
                  :disabled="!hasTimings"
                  :title="`See where the video plays the original song (${keyLabels.switchMode})`"
                  @click="setMode('mix')"
                >
                  Mix
                </b-button>
              </div>
            </b-field>
            <b-field label="View mode" horizontal>
              <div class="buttons has-addons mode-switch">
                <b-button
                  :type="showSpectrogram ? '' : 'is-primary'"
                  :aria-pressed="!showSpectrogram"
                  title="Draw the loudness of the song"
                  @click="showSpectrogram = false"
                >
                  Waveform
                </b-button>
                <b-button
                  :type="showSpectrogram ? 'is-primary' : ''"
                  :aria-pressed="showSpectrogram"
                  title="Draw the pitches in the song"
                  @click="showSpectrogram = true"
                >
                  Spectrogram
                </b-button>
              </div>
            </b-field>
            <b-field label="Playback rate" horizontal>
              <b-numberinput
                expanded
                :model-value="playbackRate"
                @update:model-value="
                  (v: number | null | undefined) => (playbackRate = Number(v ?? playbackRate))
                "
                :min="0.25"
                :max="2"
                :step="0.25"
                controls-position="compact"
              />
            </b-field>
            <b-field horizontal>
              <template #label>
                Preserve pitch
                <viewport-tooltip
                  label="Hold the original key at other speeds. Turned off, a slower speed lowers the pitch too."
                >
                  <b-icon size="is-small" icon="circle-question"></b-icon>
                </viewport-tooltip>
              </template>
              <b-switch v-model="preservePitch"></b-switch>
            </b-field>
            <b-field label="Playhead preroll (seconds)" horizontal>
              <b-numberinput
                expanded
                :model-value="prerollSeconds"
                @update:model-value="
                  (v: number | null | undefined) => (prerollSeconds = Number(v ?? prerollSeconds))
                "
                :min="0"
                :max="30"
                :step="1"
                controls-position="compact"
              />
            </b-field>
            <b-field v-if="vocalTrack && !mixMode" label="Playback track" horizontal>
              <track-select kind="vocals" expanded v-model="playbackTrackChoice" />
            </b-field>
            <template v-if="mixMode">
              <b-field v-if="mediaStore.backingSources.length > 1" label="Backing track" horizontal>
                <track-select
                  kind="backing"
                  :include-full="false"
                  expanded
                  :model-value="mediaStore.separatedTrack?.source ?? null"
                  @update:model-value="(v: TrackSource) => (mediaStore.renderTrackSource = v)"
                />
              </b-field>
              <b-field horizontal :message="mixMessage">
                <template #label>
                  <span id="mix-restore-gaps-label">Restore gaps </span>
                  <viewport-tooltip
                    wide
                    label="Play the original song instead of the backing track where nobody sings"
                  >
                    <b-icon size="is-small" icon="circle-question"></b-icon>
                  </viewport-tooltip>
                </template>
                <b-switch
                  v-model="videoOptions.restoreGaps"
                  ariaLabelledby="mix-restore-gaps-label"
                ></b-switch>
              </b-field>
              <b-field
                v-for="field in gapFields"
                :key="field.option"
                :label="field.label"
                horizontal
              >
                <b-numberinput
                  expanded
                  :model-value="videoOptions[field.option]"
                  @update:model-value="
                    (v: number | null | undefined) =>
                      (videoOptions[field.option] = Number(v ?? videoOptions[field.option]))
                  "
                  :min="field.min"
                  :step="field.step"
                  :min-step="0.01"
                  controls-position="compact"
                />
              </b-field>
              <b-field horizontal>
                <template #label>
                  Restore pauses in lines
                  <viewport-tooltip
                    wide
                    label="Treat a long pause between two syllables of a line like a gap between lines. These are not stored and can't be adjusted."
                  >
                    <b-icon size="is-small" icon="circle-question"></b-icon>
                  </viewport-tooltip>
                </template>
                <b-switch v-model="videoOptions.restorePausesInLines"></b-switch>
              </b-field>
              <b-field horizontal :message="mixLevelLabel">
                <template #label>
                  Match levels
                  <viewport-tooltip
                    wide
                    label="The backing track is often quieter than the original between lines. Turn the original down, or turn the backing track up, engaging the limiter. Nothing is changed when the two tracks don't line up."
                  >
                    <b-icon size="is-small" icon="circle-question"></b-icon>
                  </viewport-tooltip>
                </template>
                <div class="mix-balance">
                  <b-slider
                    :model-value="videoOptions.gapLevelBalance"
                    @update:model-value="
                      (v: number | [number, number]) => (videoOptions.gapLevelBalance = Number(v))
                    "
                    aria-label="Match levels"
                    :min="0"
                    :max="1"
                    :step="0.05"
                    :tooltip="false"
                    lazy
                  />
                  <div class="mix-balance-ends">
                    <span>Original down</span>
                    <span>Backing up</span>
                  </div>
                </div>
              </b-field>
              <b-field horizontal>
                <template #label>
                  Compensate gain
                  <viewport-tooltip
                    wide
                    label="Compensate gain to listen for possible distortion when the limiter is on. Preview only."
                  >
                    <b-icon size="is-small" icon="circle-question"></b-icon>
                  </viewport-tooltip>
                </template>
                <b-switch v-model="mixAtBackingLevel"></b-switch>
              </b-field>
              <b-field label="Mix settings" horizontal>
                <b-button
                  class="reset-mix"
                  icon-left="eraser"
                  label="Reset to defaults"
                  title="Put the settings above back on their defaults"
                  :disabled="settingsStore.mixSettingsAreDefault"
                  @click="settingsStore.resetMixSettings()"
                />
              </b-field>
            </template>
            <b-field v-if="isAdjustMode" label="Shift all timings (ms)" horizontal>
              <b-numberinput
                expanded
                :model-value="shiftMs"
                @update:model-value="
                  (v: number | null | undefined) => (shiftMs = Number(v ?? shiftMs))
                "
                :step="1"
                controls-position="compact"
              />
              <b-button class="field-action" label="Apply" @click="applyShift" />
            </b-field>
          </div>
          <b-button
            v-if="isImmersive"
            class="immersive-exit"
            label="Show the whole tab"
            @click="showWholeTab"
          />
        </div>
      </Teleport>
      <subtitle-display
        class="subtitle-display"
        v-if="songFile"
        ref="subtitleDisplay"
        :subtitles="debouncedSubtitles"
        :fonts="previewFonts"
        backgroundColor="transparent"
      />
    </div>
    <timing-adjuster
      v-if="songFile"
      ref="timing-adjuster"
      :segments="displayedSegments"
      :displayMode="displayMode"
      :mixMode="mixMode"
      :mixFrames="mixFrames"
      :mixGaps="mixGaps"
      :mixEnabled="mixEnabled"
      :spectrogram="showSpectrogram"
      :tapMode="isTapMode"
      :growing="pass?.growing"
      :head="tapHead"
      :tapped="tappedSegments"
      :queue="queue"
      :bands="displayBands"
      :bandsEnabled="settingsStore.videoOptions.useStoredDisplayPeriods"
      :audioData="songFile ?? undefined"
      :vocalTrack="vocalTrack ?? undefined"
      :playbackTrack="playbackTrack ?? undefined"
      :prerollSeconds="prerollSeconds"
      :zoom="zoom"
      :playbackRate="playbackRate"
      :preservePitch="preservePitch"
      :initialPlayhead="restoredPlayhead"
      :initialScroll="restoredScroll"
      :immersive="isImmersive"
      @segmentschange="onSegmentsChange"
      @bands-updated="onBandsUpdated"
      @band-reset="onBandReset"
      @mute-updated="onMuteUpdated"
      @mute-reset="onMuteReset"
      @zoom-change="onZoomChange"
      @zoom-by="onZoomBy"
      @scroll-change="onScrollChange"
      @timeupdate="onPlayheadUpdate"
      @seeking="onSeek"
      @segment-picked="onSegmentPicked"
      @selection-change="(indices: number[]) => (selectedSegments = indices)"
      @play="isPlaying = true"
      @pause="onPlaybackPause"
      @playback-loaded="onPlaybackLoaded"
    >
      <span
        v-if="mixStatus"
        class="mix-status tag"
        :class="mixStatus === 'applied' ? 'is-success' : 'is-info'"
        role="status"
      >
        <b-icon
          :icon="mixStatus === 'applied' ? 'check' : 'spinner'"
          :custom-class="mixStatus === 'applied' ? '' : 'fa-spin'"
          size="is-small"
        />
        <span>{{ mixStatus === "applied" ? "Mix updated" : "Updating the mix" }}</span>
      </span>
    </timing-adjuster>
    <tap-buttons
      v-if="songFile && (isImmersive || (isTapMode && showTapButtons))"
      :timing-buttons="isTapMode"
      :floating="isImmersive"
      :start-label="keyLabels.start"
      :end-label="keyLabels.end"
      :redo-label="keyLabels.redo"
      :playing="isPlaying"
      :show-keys="!isMobile && !isImmersive"
      @start="(at?: number) => onTimingKey('start', at)"
      @end="(at?: number) => onTimingKey('end', at)"
      @redo="onTimingKey('redo')"
      @play-pause="timingAdjusterRef()?.togglePlayPause()"
    />
    <auto-sync-dialog
      v-model="isSyncOpen"
      :voice="activeVoice"
      :vocals="vocalTrack"
      :selection="isAdjustMode ? selectedSegments : []"
      @synced="setMode('adjust')"
    />
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import AutoSyncDialog from "@/components/AutoSyncDialog.vue";
import HelpSection from "@/components/HelpSection.vue";
import TimingAdjuster from "@/components/TimingAdjuster.vue";
import SubtitleDisplay from "./SubtitleDisplay.vue";
import VoiceSelector from "@/components/VoiceSelector.vue";
import TrackSelect from "@/components/TrackSelect.vue";
import ViewportTooltip from "@/components/ViewportTooltip.vue";
import { useMediaStore } from "@/stores/media";
import { TrackSource } from "@/types";
import { useTimingsStore } from "@/stores/timings";
import { useAdvancedStore } from "@/stores/advanced";
import { useLyricsStore } from "@/stores/lyrics";
import { useSettingsStore } from "@/stores/settings";
import { useLegacyTimingStore } from "@/stores/legacyTiming";
import { storeToRefs } from "pinia";
import { BButton, BField, BIcon, BMessage, BNumberinput, BSwitch } from "buefy";
import {
  DRAWER_QUERY,
  PHONE_LANDSCAPE_QUERY,
  isMobile,
  useFullScreen,
  useMediaQuery,
} from "@/lib/device";
import TapButtons from "@/components/TapButtons.vue";
import { VoiceId } from "@/lib/voices";
import { clampSegmentOverlaps } from "@/lib/timingValidation";
import { isDragging } from "@/lib/wavesurferPlugins/OpenEndedRegionPlugin";
import { TimedSegment, fromLyric, hasDisplayPeriod, unflagged } from "@/lib/timedSegments";
import {
  TapPass,
  followHead,
  lineStarts,
  prerollStart,
  previousLine,
  moveHead,
  redoLine,
  segmentHeadAt,
  startPass,
  steppedTap,
  tapEnd,
  tapStart,
  tapSteps,
  undoTap,
} from "@/lib/tapPass";
import {
  TIMING_ACTIONS,
  TapAction,
  TimingAction,
  TimingKeys,
  findBinding,
  bindingLabel,
  isTapAction,
} from "@/lib/timingKeys";
import { QueueItem } from "@/components/TapQueue.vue";
import { displayText, resolveStarts } from "@/lib/timing";
import { isSyncAvailable } from "@/lib/alignment";
import { REDO_SHORTCUT, UNDO_SHORTCUT, historyStepFor, historyTitle } from "@/lib/history";
import { useHistoryStore } from "@/stores/history";
import { BandUpdate, DisplayBand, displayBands } from "@/lib/displayBands";
import { resolveThemeColor } from "@/lib/themeColor";
import { onSchemeChange } from "@/lib/colorScheme";
import { loadJsonFromStorage } from "@/lib/persistence";
import { findLast, findLastIndex, isEqual, pick, throttle } from "lodash-es";
import { gapDifferences, restoredBacking } from "@/lib/gapMix";
import { gapFades, type Span } from "@/lib/gapRestore";
import type { MixFrame, MixGap } from "@/lib/wavesurferPlugins/MixPlugin";
import { CJK_FONT, SYMBOL_FONT } from "@/lib/fonts";
import { useFallbackFontsStore } from "@/stores/fallbackFonts";
import { default as BuefyColor } from "buefy/src/utils/color";
import { DEFAULT_OUTLINE_WIDTH, GAP_MAX_LEAD } from "@/constants";

// The arrow keys step by the playhead preroll,
// so stepping and the preview jump after a drag agree on what one step is worth.
// The far steps take five of them.
const COARSE_STEP_MULTIPLIER = 5;

// The preview here is a working view of the timings, not a proxy for the final video,
// so it uses the app's own palette, font and size rather than the video settings.
// The size is in SUBTITLE_CANVAS units,
// so it scales with the preview instead of being a pixel height.
const PREVIEW_FONT_SIZE = 23;
const PREVIEW_FONT = SYMBOL_FONT;

// Fallbacks are the light-theme values, applied only where the stylesheet is absent.
const PREVIEW_PALETTE = {
  background: ["var(--bulma-body-background-color)", "#ffffff"],
  primary: ["var(--bulma-primary)", "#7957d5"],
  secondary: ["var(--bulma-grey-light)", "#abb1bf"],
} as const;

type PreviewColors = Record<keyof typeof PREVIEW_PALETTE, BuefyColor>;

function resolvePreviewColors(): PreviewColors {
  return {
    background: resolveThemeColor(...PREVIEW_PALETTE.background),
    primary: resolveThemeColor(...PREVIEW_PALETTE.primary),
    secondary: resolveThemeColor(...PREVIEW_PALETTE.secondary),
  };
}

interface AdjustVoiceState {
  playhead: number;
  manualPlayhead: number;
  // The preroll in Adjust mode. It keeps its old name so saved states still load.
  prerollSeconds: number;
  tapPrerollSeconds: number;
  shiftMs: number;
  zoomPercent: number;
  waveformScroll: number;
  playbackRate: number;
  playbackTrackChoice: "full" | TrackSource;
  tapHead: number;
  // The Almost done or Done message the user tucked away, which then shows as an icon.
  acknowledgedStatus?: TimingStatus | null;
}

// Lines mode edits when each line is on screen.
// Mix mode shows where the video plays the original song instead of the backing track.
type AdjustMode = "tap" | "adjust" | "lines" | "mix";

// The original and the backing track differ by less than this over a gap that changes nothing.
const EMPTY_GAP_DB = -40;

// The mix is rebuilt from the whole song, so a run of setting changes only rebuilds it once.
const MIX_PLAYBACK_DELAY_MS = 400;

// How long the waveform says the mix was updated.
const MIX_APPLIED_MS = 1500;

const GAP_FIELDS = [
  { option: "gapPreRoll", label: "Mute before a line (seconds)", step: 0.1, min: -GAP_MAX_LEAD },
  { option: "gapPostRoll", label: "Mute after a line (seconds)", step: 0.1, min: 0 },
  { option: "gapMinLength", label: "Shortest gap (seconds)", step: 0.5, min: 0 },
  { option: "gapFade", label: "Fade (seconds)", step: 0.05, min: 0 },
] as const;

// How far the voice is timed: every segment has an unflagged start, and the last one an end too.
type TimingStatus = "almost" | "done";

// A pass needs more of a run-up than a replay, to catch the beat before the first tap.
const DEFAULT_TAP_PREROLL = 2;

// The queue shows the rest of the head's line and this many lines after it.
const QUEUE_EXTRA_LINES = 2;

const ADJUST_STORAGE_KEY = "adjust.state";

// Version 2 made Preserve pitch the default. Older saves have it off whether or not the user
// chose that, so they restore it on.
const ADJUST_STATE_VERSION = 2;

// Zoom is a percentage, where 100% fits the whole track in the waveform's width.
const MIN_ZOOM = 100;
const MAX_ZOOM = 10000;
const ZOOM_WHEEL_FACTOR = 1.25;

// Everything the Adjust view restores on reload. It is per voice, except for the pitch toggle,
// which is a property of playback.
interface PersistedAdjust {
  version?: number;
  voiceState: Record<VoiceId, AdjustVoiceState>;
  preservePitch: boolean;
  // Older saves have Lines mode as a switch on Adjust mode.
  showDisplayBands?: boolean;
  mode?: AdjustMode;
  showTapButtons?: boolean;
  showSpectrogram?: boolean;
}

function writeAdjustState(value: PersistedAdjust) {
  try {
    localStorage.setItem(ADJUST_STORAGE_KEY, JSON.stringify(value));
  } catch (e) {
    console.error(`Failed to save ${ADJUST_STORAGE_KEY} to localStorage`, e);
  }
}

function restoredMode(restored: PersistedAdjust | null): AdjustMode {
  const mode = restored?.mode ?? "adjust";
  return mode === "adjust" && restored?.showDisplayBands ? "lines" : mode;
}

function defaultAdjustState(): AdjustVoiceState {
  return {
    playhead: 0.0,
    manualPlayhead: 0.0,
    prerollSeconds: 1,
    tapPrerollSeconds: DEFAULT_TAP_PREROLL,
    shiftMs: 0,
    zoomPercent: 100,
    waveformScroll: 0,
    playbackRate: 1,
    playbackTrackChoice: "full",
    tapHead: 0,
    acknowledgedStatus: null,
  };
}

export default defineComponent({
  emits: ["open-drawer", "close-drawer"],
  components: {
    AutoSyncDialog,
    BButton,
    BField,
    BNumberinput,
    BSwitch,
    HelpSection,
    BIcon,
    BMessage,
    TapButtons,
    TimingAdjuster,
    SubtitleDisplay,
    VoiceSelector,
    TrackSelect,
    ViewportTooltip,
  },
  setup() {
    const mediaStore = useMediaStore();
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    const settingsStore = useSettingsStore();
    const fallbackFontsStore = useFallbackFontsStore();
    const { subtitles } = storeToRefs(timingsStore);
    return {
      historyStore: useHistoryStore(),
      advancedStore: useAdvancedStore(),
      legacyTimingStore: useLegacyTimingStore(),
      mediaStore,
      timingsStore,
      lyricsStore,
      settingsStore,
      fallbackFontsStore,
      subtitles,
      // On a narrow screen, the status moves to the navbar and the settings to the drawer.
      isCompact: useMediaQuery(DRAWER_QUERY),
      ...useFullScreen(),
    };
  },
  data() {
    const restored = loadJsonFromStorage<PersistedAdjust | null>(ADJUST_STORAGE_KEY, null);
    const mode = restoredMode(restored);
    return {
      // Controls playhead in video and adjuster (in seconds)
      playhead: 0.0,
      // Last playhead position the user set on purpose
      // (waveform click, player seek, or the preroll a played region goes back to),
      // as opposed to one reached by playback running on.
      // Enter replays from here.
      manualPlayhead: 0.0,
      adjustPrerollSeconds: 1,
      tapPrerollSeconds: DEFAULT_TAP_PREROLL,
      shiftMs: 0,
      zoom: 100,
      waveformScroll: 0,
      playbackRate: 1,
      preservePitch:
        restored && (restored.version ?? 1) >= ADJUST_STATE_VERSION ? restored.preservePitch : true,
      // On by default where there is likely no keyboard to tap with.
      showTapButtons: restored?.showTapButtons ?? isMobile(),
      showSpectrogram: restored?.showSpectrogram ?? false,
      isPlaying: false,
      isPhoneLandscape: false,
      // Set by "Show the whole tab", until the phone is turned upright again.
      immersiveDismissed: false,
      _phoneLandscape: null as MediaQueryList | null,
      acknowledgedStatus: null as TimingStatus | null,
      // Which track to play back. The waveform always stays on the vocals.
      playbackTrackChoice: "full" as "full" | TrackSource,
      // Per-voice control state.
      // The flat fields above are the *active* voice's values.
      // On a voice switch they are saved here and the incoming voice's values are loaded.
      voiceState: (restored?.voiceState ?? {}) as Record<VoiceId, AdjustVoiceState>,
      // The restored playhead, kept fixed so the adjuster can seek to it once the audio has
      // metadata. The live `playhead` moves with playback, so it can't be used for this.
      restoredPlayhead: 0,
      restoredScroll: 0,
      // Debounced copy of `adjustmentSubtitles` fed to the SubtitleDisplay.
      // Regenerating the ASS file and re-rendering it is expensive
      // (SubtitlesOctopus.setTrack is a WASM re-parse),
      // so we defer it until dragging settles.
      debouncedSubtitles: "",
      _subtitleDebounceTimer: null as ReturnType<typeof setTimeout> | null,
      previewColors: resolvePreviewColors(),
      // Whether the settings column is scrolled down, which fades out its top edge.
      settingsScrolled: false,
      _unsubscribeScheme: null as (() => void) | null,
      mode,
      // The mode T switches to from Tap mode.
      lastEditMode: (mode === "tap" ? "adjust" : mode) as Exclude<AdjustMode, "tap">,
      // The active voice's head, the first segment the next start tap times.
      tapHead: 0,
      // The pass being tapped, and the voice it belongs to. Nothing is written before it ends.
      pass: null as TapPass | null,
      passVoice: null as VoiceId | null,
      // The voice the segments last seen belong to, so a voice switch isn't read as a lyrics edit.
      segmentsVoice: null as VoiceId | null,
      selectedSegments: [] as number[],
      isSyncOpen: false,
      // Whether the server can sync, which it is asked once the tab is mounted.
      isSyncAvailable: false,
      gapFields: GAP_FIELDS,
      // What Mix mode plays, once built, and how loud each gap differs between the two tracks.
      mixPlayback: null as Blob | null,
      gapLevels: null as { gaps: Span[]; gain: number; levels: number[] } | null,
      // Mix mode alone plays at this level. The video never does.
      mixAtBackingLevel: false,
      mixRequest: 0,
      _mixTimer: null as ReturnType<typeof setTimeout> | null,
      // Whether the mix playing is behind the settings, or has just caught up with them.
      mixStatus: null as "updating" | "applied" | null,
      _mixStatusTimer: null as ReturnType<typeof setTimeout> | null,
    };
  },
  computed: {
    undoShortcut(): string {
      return UNDO_SHORTCUT;
    },
    redoShortcut(): string {
      return REDO_SHORTCUT;
    },
    undoTitle(): string {
      return historyTitle(
        "undo",
        this.pass?.previous ? { label: "Tap", tab: "adjust" } : this.historyStore.nextUndo,
      );
    },

    // Each mode has its own preroll, set in the same field.
    prerollSeconds: {
      get(): number {
        return this.isTapMode ? this.tapPrerollSeconds : this.adjustPrerollSeconds;
      },
      set(seconds: number) {
        if (this.isTapMode) {
          this.tapPrerollSeconds = seconds;
        } else {
          this.adjustPrerollSeconds = seconds;
        }
      },
    },
    /**
     * The active voice's live values live in the flat fields,
     * so they are folded back in here rather than waiting for the voice switch that would otherwise save them.
     */
    persistedState(): PersistedAdjust {
      return {
        version: ADJUST_STATE_VERSION,
        voiceState: { ...this.voiceState, [this.activeVoice]: this.snapshotState() },
        preservePitch: this.preservePitch,
        showTapButtons: this.showTapButtons,
        showSpectrogram: this.showSpectrogram,
        mode: this.mode,
      };
    },
    activeVoice(): VoiceId {
      return this.timingsStore.activeVoice;
    },
    songFile(): Blob | null {
      return this.mediaStore.songFile;
    },
    // The waveform shows the vocals being played, or the latest ones while the full track plays.
    vocalTrack(): Blob | null {
      return (
        this.mediaStore.trackFor("vocals", this.playbackTrackChoice) ??
        this.mediaStore.trackFor("vocals", this.mediaStore.vocalSources.at(-1) ?? null)
      );
    },
    playbackTrack(): Blob | null {
      if (this.mixMode) {
        return this.mixPlayback ?? this.songFile;
      }
      return this.mediaStore.trackFor("vocals", this.playbackTrackChoice) ?? this.songFile;
    },
    // DejaVu Sans has no CJK glyphs, so CJK text is still tagged with the CJK font.
    previewFonts(): Record<string, string> {
      return pick(this.fallbackFontsStore.fontUrls, [PREVIEW_FONT, CJK_FONT]);
    },
    isEnabled(): boolean {
      return !!this.songFile && this.lyricsStore.lyricSegments.length > 0;
    },
    // Adjust mode needs timings to drag, so a voice without any is in Tap mode whatever was chosen.
    isTapMode(): boolean {
      return this.mode === "tap" || !this.hasTimings;
    },
    hasTimings(): boolean {
      return this.timingsStore.activeSegments.some((segment) => segment.start !== undefined);
    },
    // A voice that was never timed has no segments in the store yet, so they come from its lyrics.
    tapSegments(): TimedSegment[] {
      const stored = this.timingsStore.activeSegments;
      if (stored.length > 0) return stored;
      return this.lyricsStore.segmentsForVoice(this.activeVoice).map(fromLyric);
    },
    displayedSegments(): TimedSegment[] {
      return this.pass?.staged ?? this.timingsStore.activeSegments;
    },
    // The segments from the head to the end of the second line after its own.
    queue(): QueueItem[] {
      const segments = this.pass?.staged ?? this.tapSegments;
      const end =
        lineStarts(segments).filter((start) => start > this.tapHead)[QUEUE_EXTRA_LINES] ??
        segments.length;
      const resolved = resolveStarts(segments);
      return segments.slice(this.tapHead, end).map((segment, offset) => {
        const index = this.tapHead + offset;
        // A start is closed by the segment's own end, or by the start of the next one.
        const closed = segment.end !== undefined || resolved[index + 1]?.start !== undefined;
        return {
          index,
          text: displayText(segment.text).trim(),
          isHead: offset === 0,
          joinsNext: segment.text.endsWith("/"),
          endsLine: segment.text.endsWith("\n"),
          timing: segment.start === undefined ? "none" : closed ? "full" : "start",
          review: segment.review,
        };
      });
    },
    // A phone held sideways gives the whole screen to the waveform.
    isImmersive(): boolean {
      return this.isPhoneLandscape && !this.immersiveDismissed;
    },
    isMobile,
    /**
     * Whether every segment has a start and none is flagged for review, and whether the last one
     * has its end too, counting the taps of a pass under way.
     */
    timingStatus(): TimingStatus | null {
      const segments = this.pass?.staged ?? this.tapSegments;
      if (segments.length === 0) return null;
      if (segments.some((segment) => segment.review)) return null;
      if (resolveStarts(segments).some((segment) => segment.start === undefined)) return null;
      if (segments[segments.length - 1].end !== undefined) return "done";
      // The Almost done message asks for the end key, which only Tap mode answers.
      return this.isTapMode ? "almost" : null;
    },
    statusTitle(): string {
      return this.timingStatus === "done" ? "Done" : "Almost done";
    },
    reviewIndices(): number[] {
      return this.timingsStore.activeSegments.flatMap(({ review }, index) =>
        review ? [index] : [],
      );
    },
    reviewCountTitle(): string {
      const count = this.reviewIndices.length;
      return `${count} syllable${count === 1 ? "" : "s"} to review`;
    },
    canMarkChecked(): boolean {
      const segments = this.timingsStore.activeSegments;
      return !this.isTapMode && this.selectedSegments.some((index) => segments[index]?.review);
    },
    tappedSegments(): number[] {
      return this.pass ? [...this.pass.tapped] : [];
    },
    timingKeys(): TimingKeys {
      return this.settingsStore.timingKeys;
    },
    keyLabels(): Record<TimingAction, string> {
      return Object.fromEntries(
        TIMING_ACTIONS.map((action) => [action, bindingLabel(this.timingKeys[action])]),
      ) as Record<TimingAction, string>;
    },
    canSync(): boolean {
      return this.isSyncAvailable && !this.displayMode && !this.mixMode;
    },
    // Lines mode is Adjust mode while advanced mode is off, and comes back with it.
    displayMode(): boolean {
      return this.advancedStore.isAdvanced && this.mode === "lines" && !this.isTapMode;
    },
    // Like Lines mode, Mix mode is Adjust mode while advanced mode is off.
    mixMode(): boolean {
      return this.advancedStore.isAdvanced && this.mode === "mix" && !this.isTapMode;
    },
    isAdjustMode(): boolean {
      return !this.isTapMode && !this.displayMode && !this.mixMode;
    },
    editModeName(): string {
      if (!this.advancedStore.isAdvanced) return "Adjust";
      return { adjust: "Adjust", lines: "Lines", mix: "Mix" }[this.lastEditMode];
    },
    videoOptions() {
      return this.settingsStore.videoOptions;
    },
    mixBacking(): Blob | null {
      return this.mediaStore.separatedTrack?.backing ?? null;
    },
    mixEnabled(): boolean {
      return this.videoOptions.restoreGaps;
    },
    mixMessage(): string {
      if (!this.timingsStore.gapPlan.complete) {
        return "The gaps are restored once every syllable of every voice is timed.";
      }
      if (!this.mixBacking) {
        return "Separate the song or load a backing track to hear the mix.";
      }
      return "";
    },
    // The gains the mix applies to the two tracks, once measured for the current gaps.
    mixLevelLabel(): string {
      const { restoreGaps, gapLevelBalance } = this.videoOptions;
      const { gaps, complete } = this.timingsStore.gapPlan;
      if (!restoreGaps || !complete || !isEqual(this.gapLevels?.gaps, gaps)) return "";
      // A gain of exactly 1 is what the measurement gives back when the tracks don't line up.
      const gain = this.gapLevels!.gain;
      if (gain === 1) return "Not applied";
      const db = 20 * Math.log10(gain);
      const signed = (value: number) => {
        const rounded = Number(value.toFixed(1)) || 0;
        return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} dB`;
      };
      return `Backing track ${signed(db * gapLevelBalance)}, original ${signed(db * (gapLevelBalance - 1))}`;
    },
    mixFrames(): MixFrame[] {
      if (!this.mixMode) return [];
      return this.timingsStore.gapPlan.lines.map((line, index) => ({
        ...pick(line, [
          "start",
          "end",
          "voice",
          "segmentIndex",
          "text",
          "syllables",
          "openEnd",
          "startStored",
          "endStored",
          "latestStart",
          "earliestEnd",
        ]),
        row: index % 5,
      }));
    },
    mixGaps(): MixGap[] {
      if (!this.mixMode) return [];
      const { gaps } = this.timingsStore.gapPlan;
      const measured = isEqual(this.gapLevels?.gaps, gaps) ? this.gapLevels?.levels : undefined;
      const duration = this.mediaStore.songDuration ?? 0;
      return gaps.map((gap, i) => ({
        ...gap,
        ...gapFades(gap, this.videoOptions.gapFade, duration),
        empty: measured !== undefined && measured[i] < EMPTY_GAP_DB,
      }));
    },
    // What changes the mix that Mix mode plays.
    mixInputs(): unknown[] {
      if (!this.mixMode) return [false];
      return [
        this.mixMode,
        this.mixBacking,
        this.songFile,
        JSON.stringify(this.timingsStore.restoredGaps),
        JSON.stringify(this.timingsStore.gapPlan.gaps),
        this.videoOptions.gapFade,
        this.videoOptions.gapLevelBalance,
        this.mixAtBackingLevel,
      ];
    },
    activeVoiceHasDisplayPeriods(): boolean {
      return this.timingsStore.activeSegments.some(hasDisplayPeriod);
    },
    displayBands(): DisplayBand[] {
      if (!this.displayMode) return [];
      return displayBands(
        this.timingsStore.activeSegments,
        this.mediaStore.songDuration ?? 0,
        this.settingsStore.renderOptions,
        this.timingsStore.activeLinePlacements,
        this.settingsStore.fonts,
      );
    },
    adjustmentSubtitles(): string {
      return this.subtitles({
        addTitleScreen: false,
        countInMode: "none",
        font: { name: PREVIEW_FONT, size: PREVIEW_FONT_SIZE },
        outlineWidth: DEFAULT_OUTLINE_WIDTH,
        shadowX: 0,
        shadowY: 0,
        color: { ...this.previewColors, outline: this.previewColors.background, shadow: null },
      });
    },
  },
  created() {
    // This runs before the adjuster mounts, so it can pick the playhead up as a prop.
    this.loadState(this.activeVoice);
    this.restoredPlayhead = this.playhead;
    this.restoredScroll = this.waveformScroll;
    this.segmentsVoice = this.activeVoice;
  },
  mounted() {
    // The navbar's Undo and Redo come through here while this tab is shown, as the shortcuts do.
    this.historyStore.setTabStepper({
      tab: "adjust",
      canStep: (step) => this.canStep(step),
      step: (step) => this.stepHistory(step),
    });
    // Capture phase: the playback slider handles these same keys when it has focus,
    // so we have to get in ahead of it and cancel the native behavior.
    // A bubble-phase listener runs too late and both act.
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("pagehide", this.saveBeforeLeaving);
    this._phoneLandscape = window.matchMedia?.(PHONE_LANDSCAPE_QUERY) ?? null;
    this.isPhoneLandscape = this._phoneLandscape?.matches ?? false;
    this._phoneLandscape?.addEventListener("change", this.onPhoneLandscapeChange);
    this._unsubscribeScheme = onSchemeChange(this.applyPreviewColors);
    isSyncAvailable().then((available) => (this.isSyncAvailable = available));
  },
  beforeUnmount() {
    this.historyStore.setTabStepper(null);
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("pagehide", this.saveBeforeLeaving);
    this._phoneLandscape?.removeEventListener("change", this.onPhoneLandscapeChange);
    this._unsubscribeScheme?.();
    if (this._subtitleDebounceTimer) {
      clearTimeout(this._subtitleDebounceTimer);
    }
    if (this._mixTimer) {
      clearTimeout(this._mixTimer);
    }
    if (this._mixStatusTimer) {
      clearTimeout(this._mixStatusTimer);
    }
  },
  watch: {
    mixInputs: {
      handler() {
        this.scheduleMixPlayback();
      },
      immediate: true,
    },
    activeVoice(newVoice: VoiceId, oldVoice?: VoiceId) {
      this.endPass();
      // Save the outgoing voice's control state and load the incoming voice's.
      if (oldVoice) {
        this.voiceState = { ...this.voiceState, [oldVoice]: this.snapshotState() };
      }
      this.loadState(newVoice);
    },
    playhead(newPlayhead: number) {
      this.subtitleDisplayRef()?.setPlayhead(newPlayhead);
    },
    "timingsStore.reviewRequest"() {
      const [first] = this.reviewIndices;
      if (first !== undefined) this.goToSegment(first);
    },
    // An edit to the lyrics shifts the segments, and the head has to follow the one it was on.
    tapSegments(after: TimedSegment[], before: TimedSegment[]) {
      const sameVoice = this.segmentsVoice === this.activeVoice;
      this.segmentsVoice = this.activeVoice;
      if (!sameVoice || this.pass) return;
      if (after.length === before.length && after.every((s, i) => s.text === before[i].text))
        return;
      this.tapHead = followHead(before, after, this.tapHead);
    },
    persistedState: {
      handler(value: PersistedAdjust) {
        this.saveState(value);
      },
      deep: true,
    },
    adjustmentSubtitles: {
      handler(newSubs: string) {
        // First population (and clearing) should be immediate so the preview appears without delay.
        // Rapid edits while dragging are debounced.
        if (!this.debouncedSubtitles || !newSubs) {
          if (this._subtitleDebounceTimer) {
            clearTimeout(this._subtitleDebounceTimer);
            this._subtitleDebounceTimer = null;
          }
          this.debouncedSubtitles = newSubs;
          return;
        }
        if (this._subtitleDebounceTimer) {
          clearTimeout(this._subtitleDebounceTimer);
        }
        this._subtitleDebounceTimer = setTimeout(() => {
          this.debouncedSubtitles = newSubs;
          this._subtitleDebounceTimer = null;
        }, 250);
      },
      immediate: true,
    },
  },
  methods: {
    applyPreviewColors() {
      this.previewColors = resolvePreviewColors();
    },
    // $refs is not reactive, so these must be read on each call rather than cached.
    subtitleDisplayRef() {
      return this.$refs.subtitleDisplay as InstanceType<typeof SubtitleDisplay> | undefined;
    },
    timingAdjusterRef() {
      return this.$refs["timing-adjuster"] as InstanceType<typeof TimingAdjuster> | undefined;
    },
    snapshotState(): AdjustVoiceState {
      return {
        playhead: this.playhead,
        manualPlayhead: this.manualPlayhead,
        prerollSeconds: this.adjustPrerollSeconds,
        tapPrerollSeconds: this.tapPrerollSeconds,
        shiftMs: this.shiftMs,
        zoomPercent: this.zoom,
        waveformScroll: this.waveformScroll,
        playbackRate: this.playbackRate,
        playbackTrackChoice: this.playbackTrackChoice,
        tapHead: this.tapHead,
        acknowledgedStatus: this.acknowledgedStatus,
      };
    },
    loadState(voice: VoiceId) {
      const state = this.voiceState[voice] ?? defaultAdjustState();
      this.playhead = state.playhead;
      this.manualPlayhead = state.manualPlayhead;
      this.adjustPrerollSeconds = state.prerollSeconds;
      this.tapPrerollSeconds = state.tapPrerollSeconds ?? DEFAULT_TAP_PREROLL;
      this.shiftMs = state.shiftMs;
      this.zoom = state.zoomPercent ?? 100;
      this.waveformScroll = state.waveformScroll ?? 0;
      this.playbackRate = state.playbackRate;
      this.playbackTrackChoice = state.playbackTrackChoice;
      this.tapHead = state.tapHead ?? 0;
      this.acknowledgedStatus = state.acknowledgedStatus ?? null;
    },
    // The save is throttled, because the playhead ticks several times a second while the track
    // plays.
    saveState: throttle(function (this: void, value: PersistedAdjust) {
      writeAdjustState(value);
    }, 1000),
    /**
     * Write a pass in progress and save everything at once, since a page being reloaded or closed
     * doesn't wait for the saves that follow a change.
     */
    saveBeforeLeaving() {
      this.endPass();
      this.timingsStore.saveToStorage();
      writeAdjustState(this.persistedState);
    },
    onScrollChange(startSeconds: number) {
      this.waveformScroll = startSeconds;
    },
    showWholeTab() {
      this.immersiveDismissed = true;
      this.$emit("close-drawer");
    },
    onPhoneLandscapeChange(event: MediaQueryListEvent) {
      this.isPhoneLandscape = event.matches;
      if (!event.matches) {
        this.immersiveDismissed = false;
      }
    },
    onZoomBy(ratio: number) {
      this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(this.zoom * ratio)));
    },
    onZoomChange(direction: number) {
      this.zoom = this.steppedZoom(direction);
    },
    /**
     * Zoom in or out by one wheel step, around the playhead.
     */
    zoomAroundPlayhead(direction: 1 | -1) {
      const zoom = this.steppedZoom(direction);
      // An anchor left unused would be taken up by the next resize.
      if (zoom === this.zoom) return;
      this.timingAdjusterRef()?.anchorZoomOnPlayhead();
      this.zoom = zoom;
    },
    steppedZoom(direction: number): number {
      const zoom = Math.round(this.zoom * ZOOM_WHEEL_FACTOR ** direction);
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    },
    onKeyDown(event: KeyboardEvent) {
      const historyStep = historyStepFor(event);
      const action = historyStep ? null : this.actionFor(event);
      const isEscape = event.key === "Escape";
      if (!historyStep && !action && !isEscape) return;
      const target = event.target as HTMLElement | null;
      // Form controls need these keys for themselves, apart from the playback slider, which
      // would otherwise take the shortcuts away once it has been dragged.
      if (
        target &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) &&
        !target.matches(".transport-slider")
      ) {
        return;
      }
      if (document.querySelector(".modal.is-active")) return;
      // Enter is also how a focused button or link is activated,
      // so leave those to the browser rather than hijacking the key.
      // A tap can't wait for the focus to move, so a timing key is taken anyway.
      const isEnter = event.key === "Enter";
      const isTap = !!action && isTapAction(action);
      if (isEnter && !isTap && target?.closest?.("button, a")) return;
      // A fixed element has no offset parent, so the full-screen layout asks for its boxes instead.
      if (
        this.isImmersive ? this.$el.getClientRects().length === 0 : this.$el.offsetParent === null
      ) {
        return;
      }
      event.preventDefault();
      const adjuster = this.timingAdjusterRef();
      if (historyStep) {
        this.stepHistory(historyStep);
      } else if (isEscape && this.isTapMode) {
        adjuster?.pause();
      } else if (isEscape) {
        adjuster?.clearSelection();
      } else if (action && isTapAction(action)) {
        if (!event.repeat) {
          this.onTimingKey(action, event.timeStamp);
        }
      } else if (action === "switchMode") {
        this.setMode(this.isTapMode ? this.lastEditMode : "tap");
      } else if (action === "markChecked") {
        this.markChecked();
      } else if (action === "nextReview" || action === "previousReview") {
        this.goToReview(action === "nextReview" ? 1 : -1);
      } else if (action === "viewStart" || action === "viewEnd") {
        adjuster?.seekToViewEdge(action === "viewStart" ? "start" : "end");
      } else if (action === "songStart" || action === "songEnd") {
        adjuster?.seekToTrackEdge(action === "songStart" ? "start" : "end");
      } else if (action === "replay") {
        adjuster?.restartAt(this.manualPlayhead);
      } else if (action === "zoomIn" || action === "zoomOut") {
        this.zoomAroundPlayhead(action === "zoomIn" ? 1 : -1);
      } else if (action === "seekBack" || action === "seekForward") {
        adjuster?.seekBy((action === "seekBack" ? -1 : 1) * this.prerollSeconds);
      } else if (action === "seekBackFar" || action === "seekForwardFar") {
        const step = this.prerollSeconds * COARSE_STEP_MULTIPLIER;
        adjuster?.seekBy((action === "seekBackFar" ? -1 : 1) * step);
      } else {
        adjuster?.togglePlayPause();
      }
    },
    /**
     * The action the key is bound to in the current mode, if any.
     * Alt and Meta make the press someone else's shortcut.
     */
    actionFor(event: KeyboardEvent): TimingAction | null {
      // AltGr reports as Ctrl and Alt on Windows, and is how some layouts type a character.
      const isAltGraph = event.getModifierState?.("AltGraph") ?? false;
      if ((event.altKey && !isAltGraph) || event.metaKey) return null;
      const candidates = TIMING_ACTIONS.filter(
        (candidate) =>
          (this.isTapMode || !isTapAction(candidate)) &&
          // Mark as checked needs a selection, which Tap mode doesn't have.
          !(this.isTapMode && candidate === "markChecked"),
      );
      return findBinding(event, this.timingKeys, candidates) ?? null;
    },
    onSettingsScroll(event: Event) {
      // Sub-pixel leftovers are rounding, not content.
      this.settingsScrolled = (event.target as HTMLElement).scrollTop > 1;
    },
    scheduleMixPlayback() {
      this.setMixStatus(this.mixMode && this.mixBacking ? "updating" : null);
      if (this._mixTimer) clearTimeout(this._mixTimer);
      this._mixTimer = setTimeout(() => {
        this._mixTimer = null;
        this.updateMixPlayback();
      }, MIX_PLAYBACK_DELAY_MS);
    },
    /**
     * Build the mix that Mix mode plays, and measure its gaps. Outside Mix mode, the mix is
     * dropped.
     */
    async updateMixPlayback() {
      const request = ++this.mixRequest;
      const backing = this.mixBacking;
      const song = this.songFile;
      if (!this.mixMode || !backing || !song) {
        this.mixPlayback = null;
        this.setMixStatus(null);
        return;
      }
      const { gaps } = this.timingsStore.gapPlan;
      try {
        const [mix, { gain, levels }] = await Promise.all([
          restoredBacking(backing, song, this.timingsStore.restoredGaps, {
            fade: this.videoOptions.gapFade,
            balance: this.videoOptions.gapLevelBalance,
            atBackingLevel: this.mixAtBackingLevel,
          }),
          gapDifferences(backing, song, gaps),
        ]);
        if (request !== this.mixRequest) return;
        // The same mix is already playing, so no load will come to mark it applied.
        if (mix === this.mixPlayback) this.setMixStatus("applied");
        this.mixPlayback = mix;
        this.gapLevels = { gaps, gain, levels };
      } catch (error) {
        console.error("Could not build the mix", error);
        this.setMixStatus(null);
      }
    },
    onPlaybackLoaded(track: Blob) {
      if (this.mixStatus === "updating" && track === this.mixPlayback) {
        this.setMixStatus("applied");
      }
    },
    /**
     * Show the mix's status. "applied" only shows for a moment.
     */
    setMixStatus(status: "updating" | "applied" | null) {
      if (this._mixStatusTimer) clearTimeout(this._mixStatusTimer);
      this._mixStatusTimer = null;
      this.mixStatus = status;
      if (status === "applied") {
        this._mixStatusTimer = setTimeout(() => {
          this._mixStatusTimer = null;
          this.mixStatus = null;
        }, MIX_APPLIED_MS);
      }
    },
    setMode(mode: AdjustMode) {
      if (mode !== "tap" && !this.hasTimings) return;
      if ((mode === "tap") !== this.isTapMode) {
        this.endPass();
        if (mode === "tap") {
          this.tapHead = segmentHeadAt(this.tapSegments, this.playhead);
        }
      }
      if (mode !== "tap") this.lastEditMode = mode;
      this.mode = mode;
    },
    /**
     * Whether an undo or a redo has anything to do. A staged tap can be taken back, but nothing
     * can be redone during a pass.
     */
    canStep(step: "undo" | "redo"): boolean {
      return step === "undo"
        ? !!this.pass?.previous || this.historyStore.canUndo
        : !this.pass && this.historyStore.canRedo;
    },
    /**
     * Undo or redo one tap, or one edit made in Adjust mode. In Tap mode the head goes back to where
     * the tap was, and the playhead to the preroll before it, playing on if it was playing.
     */
    stepHistory(step: "undo" | "redo") {
      if (isDragging()) return;
      const adjuster = this.timingAdjusterRef();
      const playing = this.isTapMode && !!adjuster && !adjuster.isPaused();
      if (playing) {
        // A redo would put a tap back ahead of the playhead.
        if (step === "redo") return;
        if (this.pass?.previous) {
          this.undoLastTap();
          return;
        }
      }
      this.endPass();
      const before = this.tapSegments;
      const voice = this.activeVoice;
      this.historyStore[step]();
      // The step may have switched to another voice, whose taps the head doesn't follow.
      if (this.activeVoice !== voice) return;
      const tap = steppedTap(before, this.tapSegments, step);
      if (!tap) return;
      this.tapHead = tap.head;
      if (!this.isTapMode) return;
      const at = Math.max(0, tap.time - this.prerollSeconds);
      if (playing) {
        adjuster.restartAt(at);
      } else {
        adjuster?.setAudioPlayhead(at);
      }
    },
    /**
     * Act on a timing key. A tap is stamped with the song time heard at `at`, the
     * `performance.now()` time of the key press.
     */
    onTimingKey(key: TapAction, at = performance.now()) {
      const adjuster = this.timingAdjusterRef();
      if (!adjuster) return;
      if (key === "redo") {
        if (this.pass) {
          this.pass = redoLine(this.pass);
          this.tapHead = this.pass.head;
        } else {
          this.tapHead = previousLine(this.tapSegments, this.tapHead);
        }
        if (adjuster.isPaused()) {
          this.cueHead();
        } else {
          this.playFromHead();
        }
        return;
      }
      // Whatever moves the head while paused cues the playhead to it, so play starts wherever the
      // playhead was left, even if it was moved since.
      if (adjuster.isPaused()) {
        adjuster.togglePlayPause();
        return;
      }
      const time = adjuster.currentTime(at);
      if (!this.pass) {
        const pass = startPass(this.tapSegments, this.tapHead);
        if (key === "end" && pass.growing === undefined) return;
        this.pass = pass;
        this.passVoice = this.activeVoice;
        // A voice with no timings is in Tap mode without it being chosen, and its first pass
        // would otherwise drop it into Adjust mode.
        this.mode = "tap";
      }
      if (key === "start") {
        this.pass = tapStart(this.pass, time);
        this.tapHead = this.pass.head;
      } else {
        this.pass = tapEnd(this.pass, time);
      }
    },
    /**
     * Make a segment clicked on the waveform or in the queue the head, and move the playhead to the
     * preroll before it. During a pass, the taps made so far are kept, as on the redo key.
     *
     * The segments before an untimed one aren't timed either, so the head goes back to where the
     * timing stops: the last timed segment if it has no end, to be tapped again, or the one after it.
     */
    onSegmentPicked(index: number) {
      const segments = this.pass?.staged ?? this.tapSegments;
      const resolved = resolveStarts(segments);
      let head = index;
      if (resolved[index]?.start === undefined) {
        const lastTimed = findLastIndex(
          resolved.slice(0, index),
          (segment) => segment.start !== undefined,
        );
        head = lastTimed === -1 ? 0 : lastTimed + (segments[lastTimed].end === undefined ? 0 : 1);
      }
      if (this.pass) {
        this.pass = moveHead(this.pass, head);
      }
      this.tapHead = head;
      this.cueHead();
    },
    undoLastTap() {
      const undone = this.pass && undoTap(this.pass);
      if (!undone) return;
      this.pass = undone.pass;
      this.tapHead = undone.pass.head;
      this.timingAdjusterRef()?.restartAt(Math.max(0, undone.time - this.prerollSeconds));
    },
    /**
     * Move the playhead to the preroll before the head, without playing.
     */
    cueHead() {
      const segments = this.pass?.staged ?? this.tapSegments;
      this.timingAdjusterRef()?.setAudioPlayhead(
        prerollStart(segments, this.tapHead, this.prerollSeconds),
      );
    },
    playFromHead() {
      const segments = this.pass?.staged ?? this.tapSegments;
      this.timingAdjusterRef()?.restartAt(
        prerollStart(segments, this.tapHead, this.prerollSeconds),
      );
    },
    tuckStatusMessage() {
      this.acknowledgedStatus = this.timingStatus;
    },
    onPlaybackPause() {
      this.isPlaying = false;
      this.endPass();
    },
    /**
     * Write the pass to the store as one edit per tap. The head stays on the next segment to tap.
     */
    openSync() {
      this.endPass();
      this.isSyncOpen = true;
    },
    endPass() {
      const { pass, passVoice } = this;
      if (!pass || !passVoice) return;
      this.pass = null;
      this.passVoice = null;
      this.timingsStore.applyVoiceEdits(passVoice, tapSteps(pass), "Tap");
      this.tapHead = pass.head;
    },
    /**
     * Clear every timing of the active voice as one edit, and start tapping again from the top.
     */
    resetTimings() {
      this.timingAdjusterRef()?.pause();
      this.endPass();
      this.timingsStore.applyVoiceEdit(
        this.activeVoice,
        this.tapSegments.map(
          ({ start, end, displayStart, displayEnd, review, ...segment }) => segment,
        ),
        "Clear timings",
      );
      this.tapHead = 0;
      this.cueHead();
    },
    /**
     * Go to the next or previous segment to review, wrapping around.
     * It counts from the selection in Adjust mode, and from the head in Tap mode.
     */
    goToReview(direction: 1 | -1) {
      const flagged = this.reviewIndices;
      if (flagged.length === 0) return;
      const selected = this.isTapMode ? [this.tapHead] : this.selectedSegments;
      const target =
        direction === 1
          ? (flagged.find((index) => index > Math.max(-1, ...selected)) ?? flagged[0])
          : (findLast(flagged, (index) => index < Math.min(Infinity, ...selected)) ??
            flagged[flagged.length - 1]);
      this.goToSegment(target);
    },
    /**
     * Select a segment's region, scroll it into view and move the playhead to the preroll before
     * it, or make it the head in Tap mode.
     */
    goToSegment(index: number) {
      if (this.isTapMode) {
        this.onSegmentPicked(index);
      } else {
        const adjuster = this.timingAdjusterRef();
        adjuster?.selectSegment(index);
        adjuster?.setAudioPlayhead(
          prerollStart(this.timingsStore.activeSegments, index, this.prerollSeconds),
        );
      }
    },
    /**
     * Clear the review flag of the selected segments, keeping their timings, and go to the next
     * segment to review.
     */
    markChecked() {
      if (!this.canMarkChecked) return;
      const selected = new Set(this.selectedSegments);
      this.timingsStore.applyAdjustEdit(
        this.timingsStore.activeSegments.map((segment, index) =>
          selected.has(index) ? unflagged(segment) : segment,
        ),
        "Mark as checked",
      );
      this.goToReview(1);
    },
    applyShift() {
      const deltaSeconds = this.shiftMs / 1000;
      const shift = (time: number | undefined) =>
        time === undefined ? undefined : Math.max(0, time + deltaSeconds);
      const shifted = this.timingsStore.activeSegments.map((segment) => ({
        ...segment,
        start: shift(segment.start),
        end: shift(segment.end),
      }));
      // A shift moves every timing without checking any of them.
      this.timingsStore.applyAdjustEdit(clampSegmentOverlaps(shifted), "Shift", {
        keepReview: true,
      });
    },
    onBandsUpdated(updates: BandUpdate[]) {
      const segments = this.timingsStore.activeSegments.map((segment) => ({ ...segment }));
      for (const { segmentIndex, start, end } of updates) {
        if (start !== undefined) segments[segmentIndex].displayStart = start;
        if (end !== undefined) segments[segmentIndex].displayEnd = end;
      }
      this.timingsStore.applyAdjustEdit(segments, "Display time");
    },
    onBandReset(segmentIndex: number, side: "start" | "end") {
      const segments = this.timingsStore.activeSegments.map((segment) => ({ ...segment }));
      delete segments[segmentIndex][side === "start" ? "displayStart" : "displayEnd"];
      this.timingsStore.applyAdjustEdit(segments, "Display time");
    },
    onMuteUpdated(frame: MixFrame, side: "start" | "end", time: number) {
      this.writeMuteBound(frame, side, time);
    },
    onMuteReset(frame: MixFrame, side: "start" | "end") {
      if (side === "start" ? frame.startStored : frame.endStored) {
        this.writeMuteBound(frame, side, undefined);
      }
    },
    /**
     * Store or clear one edge of a line's muted period, in whichever voice the line belongs to.
     */
    writeMuteBound(frame: MixFrame, side: "start" | "end", time: number | undefined) {
      const segments = this.timingsStore
        .timedSegmentsForVoice(frame.voice)
        .map((segment) => ({ ...segment }));
      const key = side === "start" ? "muteStart" : "muteEnd";
      if (time === undefined) delete segments[frame.segmentIndex][key];
      else segments[frame.segmentIndex][key] = time;
      this.timingsStore.applyVoiceEdit(frame.voice, segments, "Mute time");
    },
    onSegmentsChange(newSegments: Array<TimedSegment>) {
      // Guard against a committed overlap (an end past the next segment's start).
      this.timingsStore.applyAdjustEdit(clampSegmentOverlaps(newSegments), "Drag");
    },
    onPlayheadUpdate(newPlayhead: number) {
      if (newPlayhead !== this.playhead) {
        this.playhead = newPlayhead;
      }
    },
    // Every seek is a deliberate move of the playhead
    // (playback progress comes through as a timeupdate instead),
    // so it becomes the Enter replay point.
    // In Tap mode it leaves the head and the pass alone, so the song can be rewound to get back
    // into the rhythm before a missed tap. Only a click on a region moves the head.
    onSeek(newPlayhead: number) {
      this.manualPlayhead = newPlayhead;
      this.onPlayheadUpdate(newPlayhead);
    },
  },
});
</script>

<style scoped>
.timing-adjustment-tab {
  container: adjust-tab / inline-size;
  display: flex;
  flex-direction: column;
}

/* Once the preview is down to its floor, a short window still cannot show the rest,
and the waveform is the point of the tab, so it scrolls.
Buefy pins .tab-item at flex-shrink: 0,
which with min-height: auto would hold this one open at content height
and leave nothing to scroll.
It grows to the full height too, so the waveform can take what the rest leaves. */
.b-tabs .tab-content .timing-adjustment-tab {
  flex-grow: 1;
  flex-shrink: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

/* The waveform takes the height left under the settings. */
.timing-adjuster {
  flex: 1 0 auto;
}

.title-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

/* Bulma only spaces a title that is :not(:last-child),
and the voice selector beside it is v-if'd away for single-voice songs.
The row owns the spacing instead. */
.title-row .title {
  margin-bottom: 0;
}

.title-main {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* The Almost done or Done message, tucked away. A click brings it back. */
.status-icon {
  display: inline-flex;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
}

.status-message-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.title-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: var(--bulma-control-height);
}

/* Bulma's button group pulls itself up by the margin it leaves under each button for wrapping.
The buttons never wrap, so neither margin is wanted. */
.mode-switch,
.mode-switch :deep(.button),
.review-nav,
.review-nav :deep(.button) {
  margin-bottom: 0;
}

/* Bulma also spaces a button group from whatever follows it,
which in the title row would lift the group above the other buttons.
Its rule ties on specificity with the one above. */
.title-actions .review-nav {
  flex-wrap: nowrap;
  margin-bottom: 0;
}

/* Bulma greys out a static button's text with a more specific rule. */
.review-nav .review-count {
  gap: 0.25em;
  color: var(--region-review-lost);
  font-weight: var(--bulma-weight-semibold);
}

.mix-balance {
  width: 14em;
}

.mix-balance .b-slider {
  margin: 0.5em 0 0.25em;
}

.mix-balance-ends {
  display: flex;
  justify-content: space-between;
  font-size: 0.85em;
}

.is-in-drawer .mix-balance {
  width: 100%;
}

/* The mix's status sits in the waveform's top right corner, over the frames. */
.mix-status {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  z-index: 5;
  gap: 0.35em;
  pointer-events: none;
}

/* Bulma's padding would push four buttons past the width of the other controls.
Each button grows from its label's width, so a short label leaves room to a long one. */
.mode-switch {
  flex-wrap: nowrap;
  width: 14em;
}

.mode-switch :deep(.button) {
  flex: 1 1 auto;
  padding-inline: 0.4em;
}

/* Two columns for as long as they fit,
with labels beside their control while there is room for that and stacked below.
Bulma keys the same switch off the viewport, which overshoots here:
the tab strip takes a fixed slice of it.
A container query has to be answered by an ancestor, so the grid needs this wrapper. */
.adjustment-form {
  container-type: inline-size;
}

/* While labels sit above their controls, a column is as wide as its widest field and every field
takes that width, so the labels and controls line up. The columns are centred. */
.adjustment-fields {
  display: grid;
  grid-template-columns: fit-content(100%);
  justify-content: center;
  column-gap: 1.5rem;
  row-gap: 0.5rem;
  justify-items: stretch;
}

.adjustment-fields > :deep(.field) {
  margin-bottom: 0;
}

.adjustment-fields :deep(.field.is-horizontal) {
  display: block;
}

.adjustment-fields :deep(.field-label) {
  white-space: nowrap;
  text-align: left;
  margin: 0 0 0.25rem;
}

/* Bulma only makes this a row, and only spaces and de-margins its children,
from its tablet breakpoint up.
This tab switches on the container, not the viewport. */
.adjustment-fields :deep(.field-body) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.adjustment-fields :deep(.field-body .field) {
  margin: 0;
}

/* Bulma's own opt-out for this is .field-body > .field.is-narrow,
but BFieldBody generates these wrappers itself and forwards no class, so it has to be CSS. */
.adjustment-fields :deep(.field-body > .field) {
  flex-grow: 0;
  min-width: 0;
}

/* Two columns of label-above-control need 13rem each, the width of the longest label. */
@container (min-width: 28rem) {
  .adjustment-fields {
    grid-template-columns: repeat(2, fit-content(50%));
    justify-content: space-evenly;
  }
}

/* Labels move beside their control once each column can hold both,
13rem of label and 14em of control.
The Apply button wraps under its control until there is room for it too. */
@container (min-width: 58rem) {
  /* Every column gets the same label and control tracks, so every field is the same width.
  The floor clears the longest label.
  max-content grows a longer one rather than clipping it,
  at the cost of that column no longer matching.
  The empty outer tracks of each pair split the leftover space,
  centering the label and control in their column. */
  .adjustment-fields {
    grid-template-columns: repeat(
      var(--columns, 2),
      minmax(0, 1fr) minmax(13rem, max-content) minmax(0, auto) minmax(0, 1fr)
    );
    column-gap: 0.75rem;
    justify-items: stretch;
  }

  /* Subgrid, so every label in a column is as wide as that column's widest
  and all its controls start at the same offset. */
  .adjustment-fields > :deep(.field.is-horizontal) {
    display: grid;
    grid-column: span 4;
    grid-template-columns: subgrid;
    /* Rows stretch to the tallest control on the line;
    centering keeps each label on its own control. */
    align-items: center;
  }

  .adjustment-fields :deep(.field-label) {
    grid-column: 2;
    margin: 0;
  }
}

/* Three columns once each fits its label and control on one line, Apply button included. */
@container (min-width: 95rem) {
  .adjustment-fields {
    --columns: 3;
  }
}

.adjustment-fields :deep(.b-numberinput),
.adjustment-fields :deep(.select),
.adjustment-fields :deep(.switch),
.reset-mix {
  width: 14em;
}

/* A switch takes the room of the other controls, so its row is as tall as theirs,
and sits in the middle of it, as on the Submit tab.
Buefy's margin after it, and the padding of its empty label, would push it off that middle. */
.adjustment-fields :deep(.switch) {
  min-height: var(--bulma-control-height);
  justify-content: center;
  margin-inline-end: 0;
}

.adjustment-fields :deep(.switch .control-label:empty) {
  display: none;
}

/* The buttons beside a control are the same width, whatever their label. */
.adjustment-fields :deep(.field-action) {
  min-width: 4.75em;
}

/* Bulma's input padding alone is wider than the value at the narrowest column. */
.adjustment-fields :deep(.b-numberinput input) {
  padding-inline: 0.25em;
}

/* In the drawer, the controls fill its width, and the Apply button stays beside its control. */
.is-in-drawer .adjustment-fields {
  grid-template-columns: 100%;
}

.is-in-drawer .adjustment-fields :deep(.field-body) {
  flex-wrap: nowrap;
}

.is-in-drawer .adjustment-fields :deep(.field-body > .field) {
  flex-grow: 1;
}

.is-in-drawer .adjustment-fields :deep(.field-body > .field:has(.field-action)) {
  flex: none;
}

.is-in-drawer .mode-switch,
.is-in-drawer .adjustment-fields :deep(.b-numberinput),
.is-in-drawer .adjustment-fields :deep(.select),
.is-in-drawer .reset-mix {
  width: 100%;
}

.adjust-top {
  --preview-margin: 0.5rem;
  display: flex;
  flex-direction: column;
}

/* libass takes the glyph scale from the frame height,
so 480px is a readable preview and the floor is where it stops being one.
Shrinking below 480 keeps the waveform on screen.
The width follows from the height, so the frame is centred. */
.adjust-top > .subtitle-display {
  align-self: center;
  flex: 0 1 auto;
  height: min(480px, (100cqw - 2 * var(--preview-margin)) * 9 / 16);
  min-height: 15rem;
  width: auto;
  margin: var(--preview-margin);
  border: 1px solid var(--bulma-border-weak);
  background-color: var(--bulma-body-background-color);
}

/* The canvas is transparent so this band shows behind the subtitles. */
.adjust-top > .subtitle-display::before {
  --band-width: 10%;
  content: "";
  position: absolute;
  inset: 0;
  background-color: var(--bulma-border-weak);
  clip-path: polygon(0 0, var(--band-width) 0, 100% 100%, calc(100% - var(--band-width)) 100%);
}

/* Once the preview fits beside the settings at its floor height, the two share a row,
which leaves the height to the waveform.
As on the Submit tab, the settings take a third and the preview the rest.
The settings need about 35rem for one column with their labels beside them.
The preview's width sets its height, so it is capped at 400px to leave the waveform on screen,
and centred in its column.
These rules come last so they win over the form's own column rules. */
@container adjust-tab (min-width: 64rem) {
  .adjust-top {
    --settings-width: max(35rem, (100cqw - 1.5rem) / 3);
    flex-direction: row;
    align-items: center;
    gap: 1.5rem;
  }

  /* The preview alone sets the row's height. The settings scroll within it rather than pushing
  the waveform down, so their grid is taken out of the flow. */
  .adjust-top > .adjustment-form {
    flex: 0 0 var(--settings-width);
    align-self: stretch;
    position: relative;
  }

  /* Fading the content out at an edge reads as "there is more this way", scrollbar or not,
  as on the Submit tab. The bottom fade is always on, with padding under the last setting to
  scroll it clear. The top fade only shows once the column is scrolled. */
  .adjust-top .adjustment-fields {
    --fade-below: 2.5rem;
    position: absolute;
    inset: 0;
    overflow-y: auto;
    align-content: start;
    padding-bottom: var(--fade-below);
    scrollbar-color: var(--bulma-border) transparent;
    scrollbar-gutter: stable;
    mask-image: linear-gradient(
      to bottom,
      transparent 0,
      #000 var(--fade-above, 0px),
      #000 calc(100% - var(--fade-below)),
      transparent 100%
    );
  }

  .adjust-top .adjustment-fields.has-more-above {
    --fade-above: 2.5rem;
  }

  .adjust-top > .subtitle-display {
    flex: 0 0 auto;
    width: min(100cqw - 1.5rem - var(--settings-width) - 2 * var(--preview-margin), 400px * 16 / 9);
    height: auto;
    margin-inline: auto;
  }

  /* The control track always has room for a control and the button beside it, so the settings
  keep their width and place when a mode without those buttons hides them. */
  .adjustment-fields {
    grid-template-columns:
      minmax(0, 1fr) minmax(13rem, max-content) minmax(calc(18.75em + 0.75rem), auto)
      minmax(0, 1fr);
    column-gap: 0.75rem;
    justify-items: stretch;
  }

  .adjustment-fields > :deep(.field.is-horizontal) {
    display: grid;
    grid-column: span 4;
    grid-template-columns: subgrid;
    align-items: center;
  }

  .adjustment-fields :deep(.field-label) {
    grid-column: 2;
    margin: 0;
  }
}

/* A phone held sideways gives the whole screen to the waveform, over the app's own bars. The
buttons float over it, and the settings open in a drawer. */
.b-tabs .tab-content .timing-adjustment-tab.is-immersive {
  position: fixed;
  inset: 0;
  z-index: 35;
  padding: 0;
  overflow: hidden;
  background: var(--bulma-scheme-main);
}

.is-immersive > .title-row,
.is-immersive > .help-section,
.is-immersive > .status-message,
.is-immersive > .rotate-hint,
.is-immersive > .adjust-top,
.is-immersive .adjust-top > .subtitle-display,
.is-immersive :deep(.timing-adjuster > .playback-transport) {
  display: none;
}

.is-immersive > .timing-adjuster {
  flex: 1 1 auto;
  min-height: 0;
}

.is-immersive :deep(.waveform-stage) {
  min-height: 0;
}

/* The region rows start below the immersive bar. Keep in sync with its padding and the overview's
height. */
.is-immersive :deep(.wavesurfer-container) {
  --region-top-inset: calc(0.5rem + 40px);
}

.immersive-bar {
  position: absolute;
  inset: 0 0 auto;
  z-index: 30;
  display: flex;
  justify-content: space-between;
  padding: 0.5rem;
  pointer-events: none;
}

.immersive-bar .buttons {
  margin: 0;
  pointer-events: auto;
}

.immersive-bar :deep(.button:not(.is-primary)) {
  margin-bottom: 0;
  background: color-mix(in srgb, var(--bulma-scheme-main) 55%, transparent);
  backdrop-filter: blur(3px);
}

.immersive-status {
  display: inline-flex;
}

.immersive-overview {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  margin: 0 0.5rem;
}

.immersive-overview > :deep(*) {
  pointer-events: auto;
}

.immersive-exit {
  margin-top: 1rem;
}

/* A phone held upright could time too, but sideways gives the waveform far more room. */
.rotate-hint {
  display: none;
}

@media (orientation: portrait) and (max-width: 500px) {
  .rotate-hint {
    display: block;
    padding: 0.75rem 1rem;
  }
}
</style>
