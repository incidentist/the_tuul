<template>
  <b-tab-item
    value="lyrics"
    label="Lyrics"
    icon="align-left"
    class="lyric-input-tab"
    headerClass="lyric-input-tab-header"
  >
    <h2 class="title">Lyrics</h2>
    <help-section>
      <p v-if="provider">
        When you load a song and this box is empty, {{ appName }} tries to fetch the lyrics from
        <a :href="provider.url" target="_blank" rel="noopener">{{ provider.name }}</a
        >.
      </p>
      <div class="columns is-variable is-5">
        <div class="column">
          <p>
            {{
              provider
                ? "If that finds nothing, paste them from the Internet."
                : "Paste 'em from the Internet!"
            }}
            A blank line indicates a new screen. By default, you'll enter the timing of each line.
            Use <kbd>_</kbd> to enter a timing of a word or <kbd>/</kbd> to enter a timing of a
            syllable. Example:
          </p>
          <pre>{{ singleVoiceExample }}</pre>
        </div>
        <div class="column">
          <p>
            If there is more than one voice in your song, prefix the first line of each new voice
            with a tag between square brackets. Example:
          </p>
          <pre>{{ multiVoiceExample }}</pre>
          <p>Lines that a tag moves to another voice keep their timings.</p>
        </div>
      </div>
      <p>
        <kbd>{{ findShortcut }}</kbd> finds and replaces text in the lyrics.
        <kbd>{{ undoShortcut }}</kbd> and <kbd>{{ redoShortcut }}</kbd> undo and redo your changes
        to the lyrics and the timings, whichever tab you made them in. If an edit here removes
        timings, a message says how many, and offers to undo it.
      </p>
    </help-section>
    <p v-if="statusMessage" class="lyrics-lookup-status" role="status">
      {{ statusMessage.text }}
      <a v-if="statusMessage.url" :href="statusMessage.url" target="_blank" rel="noopener"
        >See it on {{ provider.name }}</a
      >
    </p>
    <div class="level is-mobile lyric-tools" :class="{ 'is-compact': isCompact }">
      <Teleport defer to="#drawer-settings-lyrics" :disabled="!isCompact">
        <label
          v-if="vocalSources.length > 0"
          class="level-item playback-field"
          :class="{ 'is-in-drawer': isCompact }"
        >
          <span class="label">Playback track</span>
          <track-select kind="vocals" v-model="playerTrackChoice" />
        </label>
        <div class="level-item playback-field" :class="{ 'is-in-drawer': isCompact }">
          <span id="lyrics-playback-rate-label" class="label">Playback rate</span>
          <b-numberinput
            aria-labelledby="lyrics-playback-rate-label"
            :model-value="playbackRate"
            @update:model-value="(v) => (playbackRate = Number(v ?? playbackRate))"
            :min="0.25"
            :max="2"
            :step="0.25"
            controls-position="compact"
          />
        </div>
        <div class="level-item playback-field" :class="{ 'is-in-drawer': isCompact }">
          <span id="lyrics-preserve-pitch-label" class="label">
            Preserve pitch
            <viewport-tooltip
              label="Hold the original key at other speeds. Turned off, a slower speed lowers the pitch too."
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </viewport-tooltip>
          </span>
          <b-switch v-model="preservePitch" ariaLabelledby="lyrics-preserve-pitch-label" />
        </div>
      </Teleport>
      <div class="level-item">
        <viewport-tooltip position="is-right" label="Convert all spaces to underscores">
          <b-button @click="convertSpaces">Add Underscores</b-button></viewport-tooltip
        >
      </div>
      <div class="level-item">
        <viewport-tooltip position="is-right" :label="`Find and replace text (${findShortcut})`">
          <b-button
            :type="isSearchOpen ? 'is-primary' : ''"
            :aria-pressed="isSearchOpen"
            @click="$refs.lyricEditor.toggleSearch()"
            >Find and Replace</b-button
          ></viewport-tooltip
        >
      </div>
      <Teleport defer to="#drawer-settings-lyrics" :disabled="!isCompact">
        <div class="level-item" :class="{ 'is-in-drawer': isCompact }">
          <b-checkbox class="magic-slashes" type="is-primary" v-model="magicSlashes"
            >Magic Slashes</b-checkbox
          >
          <viewport-tooltip
            label="Adding a slash to a word will add the same slash to all instances of that word"
          >
            <b-icon size="is-small" icon="circle-question"></b-icon>
          </viewport-tooltip>
        </div>
      </Teleport>
    </div>
    <!-- A new song starts the player over, while another track of the same song keeps its place. -->
    <song-player
      :key="songKey"
      :file="playerFile"
      :playback-rate="playbackRate"
      :preserve-pitch="preservePitch"
    />
    <lyric-editor
      ref="lyricEditor"
      :modelValue="lyricText"
      :magic-slashes="magicSlashes"
      @update:modelValue="onLyricInput"
      @search-toggle="(isOpen) => (isSearchOpen = isOpen)"
    ></lyric-editor>
  </b-tab-item>
</template>

<script>
import { defineComponent } from "vue";
import { storeToRefs } from "pinia";
import { useLyricsStore } from "@/stores/lyrics";
import LyricEditor from "@/components/LyricEditor.vue";
import HelpSection from "@/components/HelpSection.vue";
import SongPlayer from "@/components/SongPlayer.vue";
import TrackSelect from "@/components/TrackSelect.vue";
import ViewportTooltip from "@/components/ViewportTooltip.vue";
import { useMediaStore } from "@/stores/media";
import { REDO_SHORTCUT, SHORTCUT_MODIFIER, UNDO_SHORTCUT } from "@/lib/history";
import { useLyricsLookupStore } from "@/stores/lyricsLookup";
import { formatDuration } from "@/lib/lyricsLookup";
import { appName } from "@/constants";
import { DRAWER_QUERY, useMediaQuery } from "@/lib/device";

/**
 * Describes a match as "Artist – Title (Album, 3:52)".
 */
function describeMatch(match) {
  const details = [match.album, match.duration ? formatDuration(match.duration) : null]
    .filter(Boolean)
    .join(", ");
  return `${match.artist} – ${match.title}${details ? ` (${details})` : ""}`;
}

export default defineComponent({
  components: {
    HelpSection,
    LyricEditor,
    SongPlayer,
    TrackSelect,
    ViewportTooltip,
  },
  setup() {
    const lyricStore = useLyricsStore();
    const { lyricText } = storeToRefs(lyricStore);
    const mediaStore = useMediaStore();
    const { songFile, vocalSources } = storeToRefs(mediaStore);
    const { provider, status } = storeToRefs(useLyricsLookupStore());
    return {
      lyricText,
      mediaStore,
      songFile,
      vocalSources,
      provider,
      status,
      appName: appName(),
      // On a narrow screen, the settings move to the drawer.
      isCompact: useMediaQuery(DRAWER_QUERY),
      findShortcut: `${SHORTCUT_MODIFIER}+F`,
      undoShortcut: UNDO_SHORTCUT,
      redoShortcut: REDO_SHORTCUT,
    };
  },
  data() {
    return {
      magicSlashes: true,
      // "full" or a track source.
      playerTrackChoice: "full",
      playbackRate: 1,
      preservePitch: true,
      isSearchOpen: false,
      songKey: 0,
      singleVoiceExample: "Hell/o_from_the_oth/er_side\nI_must_have_called_a_thou/sand_times",
      multiVoiceExample:
        "[Bob]Hell/o_from_the_oth/er_side\n[Alice]I_must_have_called_a_thou/sand_times\n[Alice+Bob]To_tell_you_I'm so/rry_for_e/very/thing_that_I've_done",
    };
  },
  computed: {
    playerFile() {
      return this.mediaStore.trackFor("vocals", this.playerTrackChoice) ?? this.songFile;
    },
    statusMessage() {
      const name = this.provider?.name;
      const status = this.status;
      if (!name || !status) return null;
      switch (status.kind) {
        case "looking":
          return { text: `Looking up lyrics on ${name}…` };
        case "found":
          return {
            text: `Lyrics from ${name}: ${describeMatch(status.match)}. Check them against the song.`,
            url: status.match.url,
          };
        case "instrumental":
          return { text: `${name} lists this song as instrumental.`, url: status.match.url };
        case "notFound":
          return { text: `No lyrics found on ${name}.` };
        default:
          return { text: `Couldn't reach ${name}.` };
      }
    },
  },
  watch: {
    songFile() {
      this.songKey++;
    },
  },
  methods: {
    onLyricInput(newValue) {
      this.lyricText = newValue;
    },
    convertSpaces(e) {
      this.$refs.lyricEditor.convertSpaces();
    },
  },
});
</script>

<style scoped>
.lyric-input-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.playback-field {
  gap: 0.4rem;
}

.playback-field .label {
  margin: 0;
  white-space: nowrap;
}

.magic-slashes :deep(.control-label) {
  color: var(--bulma-text-strong);
  font-weight: var(--bulma-weight-semibold);
}

/* Bulma keeps a mobile level on one row, which the fields overflow on a narrow window. */
.lyric-tools {
  flex-wrap: wrap;
  row-gap: 0.75rem;
}

.lyric-tools:not(.is-compact) > .level-item:not(.is-narrow) {
  flex-grow: 0;
}

.lyric-tools.is-compact > .level-item {
  flex: 1 1 auto;
}

.lyric-tools.is-compact :deep(.b-tooltip),
.lyric-tools.is-compact .button {
  width: 100%;
}

/* The drawer is too narrow for the label beside its control. */
.level-item.is-in-drawer {
  justify-content: flex-start;
}

.playback-field.is-in-drawer {
  flex-direction: column;
  align-items: stretch;
  gap: 0.25rem;
}

.lyrics-lookup-status {
  margin-bottom: 0.75rem;
  font-size: 0.875rem;
  opacity: 0.8;
}
</style>
