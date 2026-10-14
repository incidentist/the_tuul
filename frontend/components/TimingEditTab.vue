<template>
  <b-tab-item
    value="edit"
    icon="pen-to-square"
    label="Edit"
    :disabled="!isEnabled"
    :visible="advancedStore.isAdvanced"
    class="timing-edit-tab"
  >
    <div class="title-row">
      <h2 class="title">Edit Timings</h2>
      <voice-selector />
    </div>
    <help-section>
      <p>
        This is the active voice's part of <code>timings.txt</code>. Each line of lyrics sits
        between two time rows, and each row in between is a syllable: its text in quotes, when it
        starts, then when it ends. A syllable with no end lasts until the next one starts. A space
        at the end of a syllable ends its word, and <code>page</code> starts a new page. A time row
        followed directly by another one is a blank line that keeps its place on the page, and a
        <code>|</code> row between two syllables continues their line on the row below.
      </p>
      <p>
        The time rows around a line hold when it appears and disappears, and <code>-</code> leaves
        that to the app. A time that cuts into the line's syllables is moved back to them on Apply,
        and the Submit tab's <b>Use Line Display Times</b> turns them off in the video.
      </p>
      <p>
        A second time on those rows holds when Restore Gaps starts and stops playing the backing
        track around the line. It's left out when the app sets it. The mute may start up to 0.2
        seconds after the line's first syllable, and a time that cuts further into the line is moved
        back on Apply.
      </p>
      <p>
        Edit the times to fine-tune them, or copy times from one place and paste them elsewhere to
        reuse the exact same timing. Comments that start with <code>#</code> are dropped on Apply.
      </p>
      <p>
        Press <b>Apply</b> to use your edits, or <b>Reload</b> to discard them and show the current
        timings again.
      </p>
    </help-section>
    <div ref="host" class="textarea code-editor timing-editor"></div>
    <p v-if="error" class="has-text-danger">{{ error }}</p>
    <b-message
      v-if="warnings.length"
      class="apply-warnings"
      type="is-warning"
      size="is-small"
      title="Some parts were changed on Apply"
      closable
      @close="warnings = []"
    >
      <ul>
        <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
      </ul>
    </b-message>
    <div class="buttons">
      <b-button type="is-primary" @click="apply" :disabled="!hasChanges">Apply</b-button>
      <b-button @click="reload" :disabled="!hasChanges">Reload</b-button>
    </div>
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent, shallowRef } from "vue";
import { Compartment, EditorState, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { EditorView, GutterMarker, gutterLineClass, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { BButton, BMessage } from "buefy";
import HelpSection from "@/components/HelpSection.vue";
import VoiceSelector from "@/components/VoiceSelector.vue";
import { useTimingsStore } from "@/stores/timings";
import { useHistoryStore } from "@/stores/history";
import { useAdvancedStore } from "@/stores/advanced";
import { useLyricsStore } from "@/stores/lyrics";
import {
  TimingsTextError,
  keepReviewFlags,
  parseVoiceTimingsText,
  writeVoiceTimingsText,
} from "@/lib/timingsText";
import { joinLyrics } from "@/lib/timing";
import { VoiceId } from "@/lib/voices";
import {
  findAndReplace,
  minimalChange,
  programmatic,
  restoreScrollWhenShown,
} from "@/lib/codeEditor";
import { timingsMarkup } from "@/lib/timingsMarkup";

const undoHistory = new Compartment();

const setErrorRow = StateEffect.define<number | undefined>();

const errorMarker = new (class extends GutterMarker {
  elementClass = "is-error";
})();

// Marks the number of the row that failed to apply, and follows that row as the text is edited.
const errorRowField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(markers, transaction) {
    markers = markers.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setErrorRow)) continue;
      const row = effect.value;
      const { doc } = transaction.state;
      markers =
        row === undefined || row > doc.lines
          ? RangeSet.empty
          : RangeSet.of([errorMarker.range(doc.line(row).from)]);
    }
    return markers;
  },
  provide: (field) => gutterLineClass.from(field),
});

export default defineComponent({
  components: { BButton, BMessage, HelpSection, VoiceSelector },
  setup() {
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    return {
      timingsStore,
      lyricsStore,
      advancedStore: useAdvancedStore(),
      historyStore: useHistoryStore(),
      view: shallowRef<EditorView | null>(null),
    };
  },
  data() {
    return {
      draft: "",
      error: "",
      errorRow: undefined as number | undefined,
      warnings: [] as string[],
      stopRestoringScroll: null as (() => void) | null,
    };
  },
  mounted() {
    const view = new EditorView({
      parent: this.$refs.host as HTMLElement,
      state: EditorState.create({
        doc: this.draft,
        extensions: [
          findAndReplace(),
          undoHistory.of(history()),
          keymap.of([...historyKeymap, ...defaultKeymap]),
          lineNumbers(),
          errorRowField,
          EditorView.contentAttributes.of({
            "aria-label": "Timings",
            spellcheck: "false",
            autocorrect: "off",
            autocapitalize: "off",
          }),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((tr) => tr.annotation(programmatic))
            ) {
              this.draft = update.state.doc.toString();
            }
          }),
          timingsMarkup,
        ],
      }),
    });
    this.view = view;
    this.stopRestoringScroll = restoreScrollWhenShown(view);
  },
  beforeUnmount() {
    this.stopRestoringScroll?.();
    this.view?.destroy();
  },
  computed: {
    activeVoice(): VoiceId {
      return this.timingsStore.activeVoice;
    },
    isEnabled(): boolean {
      return this.timingsStore.length > 0;
    },
    current(): string {
      return writeVoiceTimingsText(this.timingsStore.activeSegments);
    },
    hasChanges(): boolean {
      return this.draft !== this.current;
    },
  },
  watch: {
    hasChanges(changed: boolean) {
      // A draft back to the current timings no longer holds what the error was about.
      if (!changed) {
        this.error = "";
        this.errorRow = undefined;
      }
    },
    draft: {
      // A deferred watcher would miss an edit and a Reload made in the same tick.
      flush: "sync",
      handler(value: string) {
        const view = this.view;
        const shown = view?.state.doc.toString();
        if (!view || value === shown) return;
        // Undoing an edit across a replaced draft would garble it, so the replacement starts the
        // editor's undo history over, as setting a textarea's value does.
        view.dispatch({
          changes: minimalChange(shown!, value),
          annotations: programmatic.of(true),
          effects: undoHistory.reconfigure([]),
        });
        view.dispatch({ effects: undoHistory.reconfigure(history()) });
      },
    },
    errorRow(row: number | undefined) {
      this.view?.dispatch({ effects: setErrorRow.of(row) });
    },
    activeVoice() {
      this.error = "";
      this.errorRow = undefined;
      this.warnings = [];
    },
    current: {
      immediate: true,
      handler(value: string) {
        this.draft = value;
      },
    },
  },
  methods: {
    apply() {
      this.warnings = [];
      try {
        const { segments: parsed, warnings } = parseVoiceTimingsText(this.draft);
        const edited = joinLyrics(parsed);
        // A spacer lives in the lyrics like a word, so changing one changes the lyrics too.
        const lyricsChanged =
          edited !== joinLyrics(this.lyricsStore.segmentsForVoice(this.activeVoice));
        // Only a voice that owns the whole lyric blob can have words written back to it.
        // Putting an edit back through the `[tag]` lines of a multi-voice blob is not implemented.
        if (lyricsChanged && this.lyricsStore.voices.length > 1) {
          this.error =
            "This tab can only change timings while the song has more than one voice. Edit the words, blank lines and row breaks in the Lyrics tab.";
          return;
        }

        this.historyStore.record({ label: "Edit", tab: "edit" }, () => {
          this.timingsStore.resetSegments(
            keepReviewFlags(this.timingsStore.activeSegments, parsed),
          );
          if (lyricsChanged) {
            this.lyricsStore.setLyrics(edited);
          }
        });
        // A rewrite that only drops comments leaves `current` as it was, so its watcher won't fire.
        this.draft = this.current;
        this.error = "";
        this.errorRow = undefined;
        this.warnings = warnings;
      } catch (e) {
        this.error = "Could not apply timings: " + (e as Error).message;
        this.errorRow = e instanceof TimingsTextError ? e.row : undefined;
      }
    },
    reload() {
      this.draft = this.current;
      this.error = "";
      this.errorRow = undefined;
      this.warnings = [];
    },
  },
});
</script>

<style scoped>
.timing-edit-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.title-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

/* Bulma only spaces a title that is :not(:last-child), and the voice selector beside it
   is v-if'd away for single-voice songs. The row owns the spacing instead. */
.title-row .title {
  margin-bottom: 0;
}

.apply-warnings ul {
  list-style: disc;
  padding-left: 1.25em;
}

.timing-editor {
  flex: 1;
  margin-bottom: 0.75rem;
  font-family: var(--bulma-family-code), monospace;
  font-size: var(--bulma-size-normal);
  line-height: 1.6;
}

.timing-editor :deep(.cm-gutters) {
  background-color: var(--bulma-background);
  color: var(--bulma-text-weak);
  border-right: var(--bulma-control-border-width) solid var(--bulma-border);
}

.timing-editor :deep(.cm-lineNumbers .cm-gutterElement) {
  padding: 0 0.5em;
}

.timing-editor :deep(.cm-lineNumbers .cm-gutterElement.is-error) {
  color: var(--bulma-danger);
  font-weight: bold;
}

.timing-editor :deep(.cm-markup-syllable) {
  color: var(--bulma-link-text);
}

.timing-editor :deep(.cm-markup-time) {
  color: var(--bulma-text-strong);
}

.timing-editor :deep(.cm-markup-placeholder),
.timing-editor :deep(.cm-markup-comment) {
  color: var(--bulma-text-weak);
}

.timing-editor :deep(.cm-markup-comment) {
  font-style: italic;
}

.timing-editor :deep(.cm-markup-keyword) {
  font-weight: bold;
}
</style>
