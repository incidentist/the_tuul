<template>
  <div class="wrapper">
    <b-navbar shadow :mobile-burger="false">
      <template #brand>
        <b-navbar-item v-if="isCompact" tag="div" class="drawer-toggle">
          <b-button
            type="is-text"
            @click="isDrawerOpen = !isDrawerOpen"
            aria-label="Menu"
            :aria-expanded="isDrawerOpen"
          >
            <b-icon icon="bars" size="is-large"></b-icon>
          </b-button>
          <span v-if="mediaStore.isProcessing" class="drawer-toggle-badge">
            <circular-progress
              v-if="mediaStore.separationProgress !== null"
              :value="mediaStore.separationProgress"
              size="1rem"
              label="Track separation progress"
            />
            <span v-else class="icon is-small loader" aria-label="Separating the track"></span>
          </span>
        </b-navbar-item>
        <b-navbar-item tag="span" class="navbar-title">
          <span class="title">{{ isCompact ? TAB_LABELS[activeTab] : appName }}</span>
          <span v-show="activeTab === 'adjust'" id="navbar-tab-status"></span>
        </b-navbar-item>
      </template>
      <template #end>
        <b-navbar-item tag="div">
          <div class="buttons">
            <viewport-tooltip :label="undoTitle">
              <b-button
                type="is-text"
                @click="stepHistory('undo')"
                aria-label="Undo"
                :disabled="!canStep('undo')"
              >
                <b-icon icon="arrow-rotate-left" size="is-large"></b-icon>
              </b-button>
            </viewport-tooltip>
            <viewport-tooltip :label="redoTitle">
              <b-button
                type="is-text"
                @click="stepHistory('redo')"
                aria-label="Redo"
                :disabled="!canStep('redo')"
              >
                <b-icon icon="arrow-rotate-right" size="is-large"></b-icon>
              </b-button>
            </viewport-tooltip>
            <viewport-tooltip
              v-for="action in navbarActions"
              :key="action.label"
              :label="action.tooltip"
            >
              <b-button
                :tag="action.href ? 'a' : 'button'"
                :href="action.href"
                :target="action.target"
                :type="action.isPressed ? 'is-primary' : 'is-text'"
                @click="action.onClick?.()"
                :aria-label="action.label"
                :aria-pressed="action.isPressed"
              >
                <b-icon :pack="action.pack" :icon="action.icon" size="is-large"></b-icon>
              </b-button>
            </viewport-tooltip>
          </div>
        </b-navbar-item>
      </template>
    </b-navbar>
    <b-tabs
      :model-value="activeTab"
      @update:model-value="selectTab"
      expanded
      :animated="false"
      vertical
      type="is-boxed"
      class="main-tabs"
      :class="{ 'has-drawer': isCompact, 'is-drawer-open': isDrawerOpen }"
    >
      <template v-if="isCompact" #start>
        <p class="drawer-title title">{{ appName }}</p>
      </template>
      <help-tab @show-tab="setActiveTab"></help-tab>
      <song-info-tab></song-info-tab>
      <lyric-input-tab></lyric-input-tab>
      <song-timing-tab></song-timing-tab>
      <timing-adjustment-tab
        @open-drawer="isDrawerOpen = true"
        @close-drawer="isDrawerOpen = false"
      />
      <timing-edit-tab />
      <submit-tab></submit-tab>
      <!-- Always rendered, as the tabs teleport their settings into it. -->
      <template #end>
        <div v-show="isCompact" class="drawer-sections">
          <details
            v-show="hasTabSettings"
            class="drawer-section"
            :open="drawerSections.settings"
            @toggle="onSectionToggle('settings', $event)"
          >
            <summary>{{ TAB_LABELS[activeTab] }} settings</summary>
            <div
              v-for="id in SETTINGS_TABS"
              v-show="activeTab === id"
              :key="id"
              :id="`drawer-settings-${id}`"
              class="drawer-settings"
            ></div>
          </details>
          <details
            class="drawer-section"
            :open="drawerSections.app"
            @toggle="onSectionToggle('app', $event)"
          >
            <summary>App</summary>
            <div class="drawer-actions">
              <b-button
                v-for="action in drawerActions"
                :key="action.label"
                :tag="action.href ? 'a' : 'button'"
                :href="action.href"
                :target="action.target"
                :type="action.isPressed ? 'is-primary' : 'is-text'"
                :icon-pack="action.pack"
                :icon-left="action.icon"
                @click="action.onClick?.()"
                :aria-pressed="action.isPressed"
              >
                {{ action.label }}
              </b-button>
            </div>
          </details>
        </div>
      </template>
    </b-tabs>
    <div v-if="isDrawerOpen" class="drawer-backdrop" @click="isDrawerOpen = false"></div>
    <key-bindings-modal v-model="isShowingKeyBindings" />
    <confirm-modal
      v-model="isConfirmingStartOver"
      title="Start over?"
      type="is-danger"
      icon="circle-exclamation"
      confirm-label="Start over"
      @confirm="startOver"
    >
      <p>
        This will discard the current song, tracks, lyrics and timings. Uploaded font files and
        settings will be kept. Save anything you want to keep first.
      </p>
      <b-checkbox v-model="resetsStylingOnStartOver" class="mt-4">
        Also reset the fonts and colors
      </b-checkbox>
      <source-file-download-links
        class="mt-4"
        label="Current files: "
        :song="mediaStore.songFile ?? undefined"
        :lyrics="lyricsStore.lyricText"
        :timings="timingsStore.hasAnyTimings ? timingsStore.timingsText : undefined"
        :tracks="mediaStore.trackPairs ?? []"
      />
    </confirm-modal>
  </div>
</template>

<script lang="ts">
import { defineComponent, h, ref } from "vue";
import { persistJsonRef } from "@/lib/persistence";
import { DRAWER_QUERY, useFullScreen, useMediaQuery } from "@/lib/device";
import { DONATE_URL, appName } from "@/constants";
import HelpTab from "@/components/HelpTab.vue";
import SongInfoTab from "@/components/SongInfoTab.vue";
import LyricInputTab from "@/components/LyricInputTab.vue";
import SongTimingTab from "@/components/SongTimingTab.vue";
import TimingAdjustmentTab from "@/components/TimingAdjustmentTab.vue";
import TimingEditTab from "@/components/TimingEditTab.vue";
import SubmitTab from "@/components/SubmitTab.vue";
import ConfirmModal from "@/components/ConfirmModal.vue";
import KeyBindingsModal from "@/components/KeyBindingsModal.vue";
import SourceFileDownloadLinks from "@/components/SourceFileDownloadLinks.vue";
import ViewportTooltip from "@/components/ViewportTooltip.vue";
import CircularProgress from "@/components/CircularProgress.vue";
import { useMediaStore } from "@/stores/media";
import { useLyricsStore } from "@/stores/lyrics";
import { useLyricsLookupStore } from "@/stores/lyricsLookup";
import { useTimingsStore } from "@/stores/timings";
import { useSettingsStore } from "@/stores/settings";
import { useHelpStore } from "@/stores/help";
import { useAdvancedStore } from "@/stores/advanced";
import { useLegacyTimingStore } from "@/stores/legacyTiming";
import { useThemeStore } from "@/stores/theme";
import { useFallbackFontsStore } from "@/stores/fallbackFonts";
import { ThemePreference } from "@/lib/colorScheme";
import { TabId, useTabRoute } from "@/lib/tabRoute";
import { useHistoryStore } from "@/stores/history";
import { HistoryEntry, TAB_LABELS, historyStepFor, historyTitle } from "@/lib/history";

// A navbar button, which the drawer shows with its label instead.
interface GlobalAction {
  label: string;
  tooltip: string;
  icon: string;
  pack?: string;
  isPressed?: boolean;
  // Kept in the navbar when the others move to the drawer.
  staysInNavbar?: boolean;
  href?: string;
  target?: string;
  onClick?: () => void;
}

// The tabs that move their settings into the drawer.
const SETTINGS_TABS: TabId[] = ["lyrics", "adjust"];

const THEME_BUTTONS: Record<ThemePreference, { icon: string; label: string }> = {
  system: { icon: "circle-half-stroke", label: "Theme: follow system" },
  light: { icon: "sun", label: "Theme: light" },
  dark: { icon: "moon", label: "Theme: dark" },
};

/**
 * What a lyric edit did to the timings, by the segments it flagged.
 */
function reviewMessage({
  entry,
  lost,
  moved,
}: {
  entry: HistoryEntry;
  lost: number;
  moved: number;
}): string {
  const edit = `This ${entry.label.toLowerCase()}`;
  const syllables = `${lost} syllable${lost === 1 ? "" : "s"}`;
  if (moved === 0) return `${edit} lost the timings of ${syllables}.`;
  if (lost === 0)
    return `${edit} moved ${moved} timing${moved === 1 ? "" : "s"} to replaced words.`;
  return `${edit} lost the timings of ${syllables}, and moved ${moved} to replaced words.`;
}

export default defineComponent({
  components: {
    HelpTab,
    SongInfoTab,
    LyricInputTab,
    SongTimingTab,
    TimingAdjustmentTab,
    TimingEditTab,
    SubmitTab,
    ConfirmModal,
    KeyBindingsModal,
    SourceFileDownloadLinks,
    ViewportTooltip,
    CircularProgress,
  },
  setup() {
    const drawerSections = ref({ settings: true, app: true });
    persistJsonRef("drawer.sections", drawerSections);
    return {
      drawerSections,
      mediaStore: useMediaStore(),
      lyricsStore: useLyricsStore(),
      lyricsLookupStore: useLyricsLookupStore(),
      timingsStore: useTimingsStore(),
      settingsStore: useSettingsStore(),
      helpStore: useHelpStore(),
      advancedStore: useAdvancedStore(),
      legacyTimingStore: useLegacyTimingStore(),
      themeStore: useThemeStore(),
      fallbackFontsStore: useFallbackFontsStore(),
      historyStore: useHistoryStore(),
      isCompact: useMediaQuery(DRAWER_QUERY),
      ...useFullScreen(),
      ...useTabRoute(),
    };
  },
  data() {
    return {
      TAB_LABELS,
      SETTINGS_TABS,
      appName: appName(),
      isSubmitting: false,
      isConfirmingStartOver: false,
      // Whether Start Over also puts the Fonts and Colors card, title and voice styles back.
      resetsStylingOnStartOver: false,
      isShowingKeyBindings: false,
      isDrawerOpen: false,
    };
  },

  computed: {
    hasTabSettings(): boolean {
      return SETTINGS_TABS.includes(this.activeTab);
    },
    themeButton(): { icon: string; label: string } {
      return THEME_BUTTONS[this.themeStore.preference];
    },
    actions(): GlobalAction[] {
      const actions: GlobalAction[] = [
        {
          label: "Instructions",
          tooltip: "Show or hide the instructions on each tab",
          icon: "circle-question",
          isPressed: this.helpStore.isShowingHelp,
          onClick: () => this.helpStore.toggleHelp(),
        },
        {
          label: "Keyboard shortcuts",
          tooltip: "Keyboard shortcuts (?)",
          icon: "keyboard",
          onClick: () => (this.isShowingKeyBindings = true),
        },
        {
          label: "Advanced",
          tooltip: "Show or hide the advanced features",
          icon: "sliders",
          isPressed: this.advancedStore.isAdvanced,
          onClick: () => this.advancedStore.toggleAdvanced(),
        },
        {
          label: "Start Over",
          tooltip: "Discard the saved session and start fresh",
          icon: "trash-can",
          onClick: this.confirmStartOver,
        },
        {
          label: this.themeButton.label,
          tooltip: this.themeTitle,
          icon: this.themeButton.icon,
          onClick: () => this.themeStore.cycle(),
        },
      ];
      if (DONATE_URL) {
        actions.push({
          label: "Buy Me A Coffee",
          tooltip: "Support the project on Buy Me A Coffee",
          icon: "circle-dollar-to-slot",
          href: DONATE_URL,
          target: "_blank",
        });
      }
      if (this.canFullScreen) {
        const label = this.isFullScreen ? "Leave full screen" : "Full screen";
        actions.push({
          label,
          tooltip: label,
          icon: this.isFullScreen ? "compress" : "expand",
          staysInNavbar: true,
          onClick: this.toggleFullScreen,
        });
      }
      actions.push({
        label: "GitHub",
        tooltip: "View the source code on GitHub",
        icon: "github",
        pack: "fab",
        href: "https://github.com/vctls/le_toul",
      });
      return actions;
    },
    navbarActions(): GlobalAction[] {
      return this.isCompact ? this.actions.filter((action) => action.staysInNavbar) : this.actions;
    },
    drawerActions(): GlobalAction[] {
      return this.actions.filter((action) => !action.staysInNavbar);
    },
    undoTitle(): string {
      return historyTitle("undo", this.historyStore.nextUndo);
    },
    redoTitle(): string {
      return historyTitle("redo", this.historyStore.nextRedo);
    },
    themeTitle(): string {
      return `${this.themeButton.label} — click to change`;
    },
    pageTitle(): string {
      return [this.appName, this.mediaStore.songTitle, this.mediaStore.songArtist]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(" | ");
    },
    isOnHiddenTab(): boolean {
      return (
        (this.activeTab === "edit" && !this.advancedStore.isAdvanced) ||
        (this.activeTab === "timing" && !this.legacyTimingStore.isShown)
      );
    },
  },
  watch: {
    isCompact(isCompact: boolean) {
      if (!isCompact) this.isDrawerOpen = false;
    },
    pageTitle: {
      handler(title: string) {
        document.title = title;
      },
      immediate: true,
    },
    // Buefy shows a blank page for a hidden tab that is still active.
    isOnHiddenTab: {
      handler(isHidden: boolean) {
        if (isHidden) this.setActiveTab("adjust");
      },
      immediate: true,
    },
    "historyStore.lastStep"(last: { entry: HistoryEntry; step: "undo" | "redo" } | null) {
      if (!last || last.entry.tab === this.activeTab) return;
      const { entry, step } = last;
      this.$buefy.snackbar.open({
        message: `${step === "undo" ? "Undid" : "Redid"} ${entry.label} (${TAB_LABELS[entry.tab]})`,
        actionText: "Show",
        onAction: () => this.setActiveTab(entry.tab),
        position: "is-bottom",
        duration: 4000,
      });
    },
    "historyStore.lastLoss"(loss: { entry: HistoryEntry; lost: number; moved: number } | null) {
      if (!loss) return;
      const { entry } = loss;
      // The message is a slot, so that Show can sit beside Undo.
      const snackbar = this.$buefy.snackbar.open({
        message: [
          h("div", { class: "text" }, reviewMessage(loss)),
          h(
            "div",
            {
              class: "action is-warning",
              onClick: () => {
                this.setActiveTab("adjust");
                this.timingsStore.requestReview();
                snackbar.close();
              },
            },
            h("button", { class: "button" }, "Show"),
          ),
        ],
        type: "is-warning",
        actionText: "Undo",
        // After another edit, Undo would take back that one instead.
        onAction: () => {
          if (this.historyStore.undoStack.at(-1) === entry) this.historyStore.undo();
        },
        position: "is-bottom",
        duration: 8000,
      });
    },
  },
  created() {
    // Before the tabs mount, so that this capture listener runs ahead of the Timing tab's,
    // which would take Escape for itself.
    window.addEventListener("keydown", this.onDrawerKeyDown, true);
  },
  mounted() {
    window.addEventListener("keydown", this.onKeyDown);
  },
  beforeUnmount() {
    window.removeEventListener("keydown", this.onDrawerKeyDown, true);
    window.removeEventListener("keydown", this.onKeyDown);
  },
  methods: {
    onSectionToggle(section: "settings" | "app", event: Event) {
      this.drawerSections[section] = (event.target as HTMLDetailsElement).open;
    },
    selectTab(id: string | number | null | undefined) {
      this.setActiveTab(id);
      this.isDrawerOpen = false;
    },
    confirmStartOver() {
      this.isConfirmingStartOver = true;
    },
    /**
     * Closes the drawer on Escape, before anything behind it can act on the key.
     */
    onDrawerKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !this.isDrawerOpen) return;
      if (document.querySelector(".modal.is-active")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.isDrawerOpen = false;
    },
    /**
     * Undoes and redoes, and opens the keyboard shortcuts on ?, from anywhere that doesn't handle
     * the keys itself. Form controls keep their own undo.
     */
    onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const step = historyStepFor(event);
      // The character, wherever the layout puts it, as nothing can rebind it.
      const isShortcutsKey = event.key === "?" && !event.ctrlKey && !event.metaKey;
      if (!step && !isShortcutsKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, select, [contenteditable]")) return;
      if (document.querySelector(".modal.is-active")) return;
      event.preventDefault();
      if (step) {
        this.historyStore[step]();
      } else {
        this.isShowingKeyBindings = true;
      }
    },
    /**
     * Whether the navbar's Undo or Redo has anything to do, asking the shown tab if it steps the
     * history its own way.
     */
    canStep(step: "undo" | "redo"): boolean {
      const stepper = this.historyStore.tabStepper;
      if (stepper?.tab === this.activeTab) return stepper.canStep(step);
      return step === "undo" ? this.historyStore.canUndo : this.historyStore.canRedo;
    },
    stepHistory(step: "undo" | "redo") {
      const stepper = this.historyStore.tabStepper;
      if (stepper?.tab === this.activeTab) {
        stepper.step(step);
      } else {
        this.historyStore[step]();
      }
    },
    async startOver() {
      this.timingsStore.clear();
      this.lyricsStore.clear();
      this.historyStore.clear();
      this.lyricsLookupStore.reset();
      await this.mediaStore.clearSession();
      if (this.resetsStylingOnStartOver) {
        this.settingsStore.resetStyling();
      }
      this.setActiveTab("song");
    },
  },
});
</script>

<style scoped>
.wrapper > .navbar {
  flex-shrink: 0;
}

/* Bulma hides the navbar menu below its desktop breakpoint, behind a burger we
   don't use. Keep the whole bar laid out as one row at every width. */
@media screen and (max-width: 1023px) {
  .wrapper :deep(.navbar) {
    display: flex;
    align-items: stretch;
  }

  .wrapper :deep(.navbar-menu) {
    display: flex;
    align-items: stretch;
    flex-grow: 1;
    background-color: transparent;
    box-shadow: none;
    padding: 0;
  }

  .wrapper :deep(.navbar-end) {
    display: flex;
    align-items: stretch;
    margin-left: auto;
  }

  .wrapper :deep(.navbar-end .navbar-item) {
    display: flex;
    align-items: center;
  }
}

.drawer-toggle {
  position: relative;
}

/* The Files tab shows separation progress in its header, which the closed drawer hides. */
.drawer-toggle-badge {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  display: flex;
  pointer-events: none;
}

.navbar-title {
  min-width: 0;
  gap: 0.5rem;
}

.navbar-title .title {
  margin-bottom: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The tab list, with the app title above it and the other global buttons
   below it, slides in from the left. */
.main-tabs.has-drawer > :deep(nav.tabs) {
  position: fixed;
  inset: 0 auto 0 0;
  /* Above the Timing tab's full screen mode, which can open the drawer. */
  z-index: 37;
  width: min(80vw, 18rem);
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  overflow-y: auto;
  background-color: var(--bulma-scheme-main);
  box-shadow: var(--bulma-shadow);
  transform: translateX(-100%);
  visibility: hidden;
  transition:
    transform 0.2s ease,
    visibility 0.2s;
}

/* Bulma stretches the list to fill the drawer, spacing the tabs apart. */
.main-tabs.has-drawer > :deep(nav.tabs ul) {
  flex-grow: 0;
}

.main-tabs.has-drawer.is-drawer-open > :deep(nav.tabs) {
  transform: none;
  visibility: visible;
}

.drawer-title {
  padding: 1rem;
  margin-bottom: 0;
}

.drawer-section {
  border-top: 1px solid var(--bulma-border);
}

/* Firefox gives the content of a details element content-box sizing, as Bulma's inherited
   border-box does not reach through it. */
.drawer-settings,
.drawer-actions {
  box-sizing: border-box;
}

.drawer-section > summary {
  padding: 0.75rem 1rem;
  font-weight: var(--bulma-weight-semibold);
  cursor: pointer;
}

.drawer-settings {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0 1rem 1rem;
}

.drawer-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 0 0.5rem 0.5rem;
}

.drawer-actions > .button {
  justify-content: flex-start;
  text-decoration: none;
}

.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 36;
  background-color: rgba(10, 10, 10, 0.4);
}

.main-tabs {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  overflow: hidden;
}

/* Buefy adds a bottom margin once the tabs have a sibling after them, such as
   the start over modal while it is open. The doubled class outranks that rule. */
.b-tabs.main-tabs {
  margin-bottom: 0;
}

.b-tabs.is-vertical {
  flex-wrap: nowrap;
}

.scroll-wrapper {
  overflow-y: scroll;
  -webkit-overflow-scrolling: touch;
  height: 100%;
}
</style>
<style>
.b-tabs.main-tabs .tab-content {
  flex-grow: 1;
  overflow: hidden;
}

.b-tabs.main-tabs .tab-content h2.title:not(.title-row *),
.b-tabs.main-tabs .tab-content .title-row {
  margin-bottom: 0.75rem;
}

/* The navbar shows the tab's name, so its heading is only kept for screen readers. */
.b-tabs.main-tabs.has-drawer .tab-content h2.title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
