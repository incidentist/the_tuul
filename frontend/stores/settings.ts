import { defineStore } from "pinia";
import { reactive, watch, ref, computed, shallowRef } from "vue";
import {
  BackgroundFit,
  CountInMode,
  DEFAULT_FRAME_RATE,
  DEFAULT_RENDER_QUALITY,
  DEFAULT_RESOLUTION,
  FrameRate,
  OutputFormat,
  RenderQuality,
  Resolution,
  VerticalAlignment,
} from "@/lib/timing";
import { useMediaStore } from "./media";
import { NO_VOCALS_SEPARATOR_MODEL, BACKING_VOCALS_SEPARATOR_MODEL } from "@/lib/separationModels";
import Color from "buefy/src/utils/color";
import { SeparationModel } from "@/types";
import {
  VoiceStyleOverride,
  serializeVoiceStyle,
  deserializeVoiceStyle,
  applyVoiceStyle,
  defaultEffectColor,
  outlineDrawn,
  shadowDrawn,
} from "@/lib/voiceStyle";
import { VoiceId } from "@/lib/voices";
import { persistBlobRef, takeLegacyBlob } from "@/lib/persistence";
import {
  TimingAction,
  TimingKeys,
  DEFAULT_TIMING_KEYS,
  KeyBinding,
  TIMING_ACTIONS,
  isCharacterKey,
  isKeyName,
  isTapAction,
  sameBinding,
} from "@/lib/timingKeys";
import { FontFaceInfo, FontMetrics, readFont } from "@/lib/fontFile";
import { BUNDLED_FONTS, BUNDLED_METRICS, GlyphCoverage } from "@/lib/fonts";
import { FontLibrary } from "@/lib/textWidth";
import {
  serializeSettingsYaml,
  serializeSubtitleSettings,
  SettingsFileSource,
} from "@/lib/settingsFile";
import {
  DEFAULT_COUNT_IN_MODE,
  DEFAULT_COUNT_IN_TEXT,
  DEFAULT_COUNT_IN_THRESHOLD,
  DEFAULT_COUNT_IN_DURATION,
  DEFAULT_LINE_SPACING,
  DEFAULT_TOP_MARGIN,
  DEFAULT_OUTLINE_WIDTH,
  DEFAULT_DYNAMIC_COUNT_INS,
  DEFAULT_INSTRUMENTAL_THRESHOLD,
  DEFAULT_GAP_PRE_ROLL,
  DEFAULT_GAP_POST_ROLL,
  DEFAULT_GAP_MIN_LENGTH,
  DEFAULT_GAP_FADE,
  DEFAULT_GAP_LEVEL_BALANCE,
  TITLE_SCREEN_DURATION,
} from "@/constants";

const VOICE_STYLES_STORAGE_KEY = "voiceStyles";
const FONT_LIBRARY_STORAGE_KEY = "settings.fontLibrary";
// Where uploaded fonts were kept before the library, one per style. They are dropped, not moved.
const LEGACY_FONT_STORAGE_KEYS = [
  "settings.customFont",
  "settings.titleFont",
  "settings.voiceFonts",
];
const TIMING_KEYS_STORAGE_KEY = "timingKeys";
// Where bindings saved as key positions kept what each key typed. Read once to migrate them.
const LEGACY_KEY_LABELS_STORAGE_KEY = "timingKeyLabels";

// What the position-named keys type on a US layout, for those saved without a label.
const LEGACY_CODE_CHARACTERS: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  IntlBackslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  NumpadAdd: "+",
  NumpadSubtract: "-",
  NumpadMultiply: "*",
  NumpadDivide: "/",
  NumpadDecimal: ".",
  NumpadEnter: "Enter",
};

function loadVoiceStyles(): Record<VoiceId, VoiceStyleOverride> {
  try {
    const raw = JSON.parse(localStorage.getItem(VOICE_STYLES_STORAGE_KEY) || "{}");
    const result: Record<VoiceId, VoiceStyleOverride> = {};
    for (const [voice, stored] of Object.entries(raw)) {
      result[voice] = deserializeVoiceStyle(stored as Record<string, unknown>);
    }
    return result;
  } catch (e) {
    console.error("Error loading voice styles:", e);
    return {};
  }
}

/**
 * The binding for a key saved by its position alone, such as "KeyQ", with what it typed when it
 * was bound.
 */
function legacyBinding(code: string, label: unknown): KeyBinding | undefined {
  const typed =
    typeof label === "string"
      ? label
      : (/^(?:Key|Digit|Numpad)(\w)$/.exec(code)?.[1] ?? LEGACY_CODE_CHARACTERS[code]);
  const key = typed?.length === 1 ? typed.toLowerCase() : typed;
  if (!isKeyName(key)) return undefined;
  return isCharacterKey(key) ? { key, code } : { key };
}

/**
 * A saved binding, or the fallback when it no longer names a key, so a stale entry can never
 * leave the timing tab with an unpressable binding.
 * Bindings were saved as plain strings before they kept where the key sits.
 */
function storedBinding(
  stored: unknown,
  labels: Record<string, unknown>,
  fallback: KeyBinding,
): KeyBinding {
  if (typeof stored === "string") {
    if (!isKeyName(stored)) return legacyBinding(stored, labels[stored]) ?? fallback;
    return stored === fallback.key ? fallback : { key: stored };
  }
  const { key, code, shift, ctrl } = (stored ?? {}) as Partial<KeyBinding>;
  if (!isKeyName(key)) return fallback;
  const binding: KeyBinding =
    typeof code === "string" && isCharacterKey(key) ? { key, code } : { key };
  if (shift === true) binding.shift = true;
  if (ctrl === true) binding.ctrl = true;
  return binding;
}

function loadTimingKeys(): TimingKeys {
  try {
    const raw = JSON.parse(localStorage.getItem(TIMING_KEYS_STORAGE_KEY) || "{}");
    const labels = JSON.parse(localStorage.getItem(LEGACY_KEY_LABELS_STORAGE_KEY) || "{}");
    const keys = Object.fromEntries(
      TIMING_ACTIONS.map((action) => [
        action,
        storedBinding(raw[action], labels, DEFAULT_TIMING_KEYS[action]),
      ]),
    ) as unknown as TimingKeys;
    // The labels are only good for the migration, so the migrated keys are saved before they go.
    if (localStorage.getItem(LEGACY_KEY_LABELS_STORAGE_KEY) !== null) {
      localStorage.setItem(TIMING_KEYS_STORAGE_KEY, JSON.stringify(keys));
      localStorage.removeItem(LEGACY_KEY_LABELS_STORAGE_KEY);
    }
    return keys;
  } catch (e) {
    console.error("Error loading timing keys:", e);
    return { ...DEFAULT_TIMING_KEYS };
  }
}

// Define interface for settings with simple hex string colors
export type VideoSettings = {
  vocalSeparationModel: SeparationModel;
  addTitleScreen: boolean;
  titleScreenDuration: number;
  showTitle: boolean;
  // The fields left out take the lyrics' own.
  titleStyle: VoiceStyleOverride;
  countInMode: CountInMode;
  countInText: string;
  dynamicCountIns: boolean;
  countInThreshold: number;
  countInDuration: number;
  instrumentalThreshold: number;
  addStaggeredLines: boolean;
  useStoredDisplayPeriods: boolean;
  // Play the original song instead of the backing track between sung parts.
  restoreGaps: boolean;
  gapPreRoll: number;
  gapPostRoll: number;
  gapMinLength: number;
  gapFade: number;
  // How the backing track is brought to the original's level in the gaps, from 0, which lowers
  // the original by the whole gain, to 1, which raises the backing track by it.
  gapLevelBalance: number;
  restorePausesInLines: boolean;
  useBackground: boolean;
  backgroundFit: BackgroundFit;
  outputFormat: OutputFormat;
  resolution: Resolution;
  frameRate: FrameRate;
  quality: RenderQuality;
  verticalAlignment: VerticalAlignment;
  lineSpacing: number;
  topMargin: number;
  outlineWidth: number;
  shadowX: number;
  shadowY: number;
  font: {
    size: number;
    name: string;
    bold?: boolean;
    italic?: boolean;
  };
  color: {
    background: Color;
    primary: Color;
    secondary: Color;
    // Null while the outline has no width.
    outline: Color | null;
    // Null while both shadow offsets are zero.
    shadow: Color | null;
  };
};

// Define StoredSettings by overriding the color fields in VideoSettings
type StoredSettings = Omit<VideoSettings, "color" | "titleStyle"> & {
  color: Record<keyof VideoSettings["color"], string | null>;
  titleStyle?: Record<string, unknown>;
};

const DEFAULT_SECONDARY_COLOR = Color.parse("#FFFFFF");

// Default settings with simple hex strings
const DEFAULT_SETTINGS: VideoSettings = {
  addTitleScreen: true,
  titleScreenDuration: TITLE_SCREEN_DURATION,
  showTitle: true,
  titleStyle: { fontSize: 45, outline: DEFAULT_SECONDARY_COLOR, outlineWidth: 1 },
  countInMode: DEFAULT_COUNT_IN_MODE,
  countInText: DEFAULT_COUNT_IN_TEXT,
  dynamicCountIns: DEFAULT_DYNAMIC_COUNT_INS,
  countInThreshold: DEFAULT_COUNT_IN_THRESHOLD,
  countInDuration: DEFAULT_COUNT_IN_DURATION,
  instrumentalThreshold: DEFAULT_INSTRUMENTAL_THRESHOLD,
  addStaggeredLines: true,
  useStoredDisplayPeriods: true,
  restoreGaps: false,
  gapPreRoll: DEFAULT_GAP_PRE_ROLL,
  gapPostRoll: DEFAULT_GAP_POST_ROLL,
  gapMinLength: DEFAULT_GAP_MIN_LENGTH,
  gapFade: DEFAULT_GAP_FADE,
  gapLevelBalance: DEFAULT_GAP_LEVEL_BALANCE,
  restorePausesInLines: false,
  useBackground: false,
  backgroundFit: "fill",
  outputFormat: "mp4",
  resolution: DEFAULT_RESOLUTION,
  frameRate: DEFAULT_FRAME_RATE,
  quality: DEFAULT_RENDER_QUALITY,
  verticalAlignment: VerticalAlignment.Middle,
  lineSpacing: DEFAULT_LINE_SPACING,
  topMargin: DEFAULT_TOP_MARGIN,
  outlineWidth: DEFAULT_OUTLINE_WIDTH,
  shadowX: 0,
  shadowY: 0,
  vocalSeparationModel: BACKING_VOCALS_SEPARATOR_MODEL,
  font: {
    size: 30,
    name: "Trebuchet MS",
    bold: true,
  },
  color: {
    background: Color.parse("#000000"),
    // Keep in sync with the primary in main.scss.
    primary: Color.parse("#7957D5"),
    secondary: DEFAULT_SECONDARY_COLOR,
    outline: Color.parse("#000000"),
    shadow: null,
  },
};

// The settings of the Fonts and Colors card, which Start Over puts back. Keep in sync with the card.
const STYLING_SETTINGS = [
  "font",
  "color",
  "outlineWidth",
  "shadowX",
  "shadowY",
  "verticalAlignment",
  "lineSpacing",
  "topMargin",
  "titleStyle",
] as const;

// The settings Mix mode tunes, which its reset puts back. The Restore Gaps switch is a choice, not
// a tuning, so it stays as the user left it.
const MIX_SETTINGS = [
  "gapPreRoll",
  "gapPostRoll",
  "gapMinLength",
  "gapFade",
  "gapLevelBalance",
  "restorePausesInLines",
] as const;

// A shallow spread would hand out DEFAULT_SETTINGS' own font and color objects, so
// writing a font name or color would rewrite the defaults.
function defaultSettings(): VideoSettings {
  return {
    ...DEFAULT_SETTINGS,
    titleStyle: { ...DEFAULT_SETTINGS.titleStyle },
    font: { ...DEFAULT_SETTINGS.font },
    color: { ...DEFAULT_SETTINGS.color },
  };
}

// An uploaded font file, with what it says about its face.
export interface LoadedFont extends FontFaceInfo {
  file: File;
  // libass takes URLs, not blobs. Revoked only once the face leaves the library, because
  // the preview and FFmpeg read the file when they need it.
  url: string;
}

/**
 * The bundled family a name stands for, ignoring case as libass does.
 */
function bundledFontName(name: string): string | undefined {
  const lower = name.toLowerCase();
  return Object.keys(BUNDLED_FONTS).find((bundled) => bundled.toLowerCase() === lower);
}

export const useSettingsStore = defineStore("settings", () => {
  // Initialize with default settings
  const videoOptions = reactive<VideoSettings>(defaultSettings());

  // Per-voice style overrides, keyed by voice id. Empty/absent => the voice uses the base.
  const voiceStyles = ref<Record<VoiceId, VoiceStyleOverride>>(loadVoiceStyles());

  // Kept out of `videoOptions`, which is what the exported settings.yaml describes: these
  // are about how the tapping tab is driven, not about the video.
  const timingKeys = ref<TimingKeys>(loadTimingKeys());

  // The uploaded fonts, which styles pick by face name. Kept out of `videoOptions`, which
  // settings.yaml describes. The files go to IndexedDB, and the rest is read back from them.
  const fontFiles = shallowRef<File[] | null>(null);
  const fontFaces = shallowRef<LoadedFont[]>([]);

  // Load saved settings when the store is initialized
  loadSettings();

  // A fixed count-in longer than the gap that triggers it would start
  // before the previous line ends, so the threshold caps the duration.
  // Enforced here because loaded and stored settings bypass the Submit tab's own bounds,
  // and kept in dynamic mode so switching back lands on a usable value.
  watch(
    () => [videoOptions.countInThreshold, videoOptions.countInDuration],
    ([threshold, duration]) => {
      if (duration > threshold) {
        videoOptions.countInDuration = threshold;
      }
    },
    { immediate: true },
  );

  // An outline or shadow that isn't drawn keeps no color, in the base style or an override.
  watch(
    [videoOptions, voiceStyles],
    () => {
      const color = videoOptions.color;
      if (outlineDrawn(videoOptions)) color.outline ??= defaultEffectColor();
      else color.outline = null;
      if (shadowDrawn(videoOptions)) color.shadow ??= defaultEffectColor();
      else color.shadow = null;
      for (const override of [videoOptions.titleStyle, ...Object.values(voiceStyles.value)]) {
        const resolved = applyVoiceStyle(videoOptions, override);
        if (!outlineDrawn(resolved)) delete override.outline;
        if (!shadowDrawn(resolved)) delete override.shadow;
      }
    },
    { deep: true, immediate: true },
  );

  // Automatically save settings when they change
  watch(
    videoOptions,
    () => {
      saveSettings();
    },
    { deep: true },
  );

  watch(
    voiceStyles,
    () => {
      const out: Record<string, unknown> = {};
      for (const [voice, style] of Object.entries(voiceStyles.value)) {
        out[voice] = serializeVoiceStyle(style);
      }
      localStorage.setItem(VOICE_STYLES_STORAGE_KEY, JSON.stringify(out));
    },
    { deep: true },
  );

  watch(
    timingKeys,
    () => {
      localStorage.setItem(TIMING_KEYS_STORAGE_KEY, JSON.stringify(timingKeys.value));
    },
    { deep: true },
  );

  /**
   * Adds faces to the library, a face replacing any of the same name.
   */
  function mergeFaces(added: LoadedFont[]): void {
    const names = new Set(added.map((face) => face.name.toLowerCase()));
    for (const face of fontFaces.value) {
      if (names.has(face.name.toLowerCase())) {
        URL.revokeObjectURL(face.url);
      }
    }
    // The menus list the faces in this order.
    fontFaces.value = [
      ...fontFaces.value.filter((face) => !names.has(face.name.toLowerCase())),
      ...added,
    ].sort(
      (a, b) =>
        a.family.localeCompare(b.family) ||
        a.weight - b.weight ||
        Number(a.italic) - Number(b.italic) ||
        a.name.localeCompare(b.name),
    );
    fontFiles.value = fontFaces.value.length > 0 ? fontFaces.value.map((face) => face.file) : null;
  }

  async function loadFont(file: File): Promise<LoadedFont> {
    return { ...(await readFont(file)), file, url: URL.createObjectURL(file) };
  }

  // The faces are re-read from the files on load rather than stored, so a file that has gone
  // unreadable is dropped instead of naming a font libass can't find.
  persistBlobRef(FONT_LIBRARY_STORAGE_KEY, fontFiles).then(async () => {
    const added = fontFaces.value;
    fontFaces.value = [];
    const stored: LoadedFont[] = [];
    for (const file of fontFiles.value ?? []) {
      try {
        stored.push(await loadFont(file));
      } catch (e) {
        console.error(`Could not read the saved font ${file.name}; dropping it`, e);
      }
    }
    // A face added while the library loaded wins over a stored one of the same name.
    mergeFaces(stored);
    mergeFaces(added);
  });
  for (const key of LEGACY_FONT_STORAGE_KEYS) {
    void takeLegacyBlob(key);
  }

  /**
   * Reads the files and adds their faces to the library, a face replacing any of the same name.
   * A file that isn't a readable font is left out and returned with its error,
   * without stopping the others.
   */
  async function addFonts(
    files: File[],
  ): Promise<{ added: LoadedFont[]; failed: { file: File; error: Error }[] }> {
    const added: LoadedFont[] = [];
    const failed: { file: File; error: Error }[] = [];
    for (const file of files) {
      try {
        added.push(await loadFont(file));
      } catch (e) {
        failed.push({ file, error: e as Error });
      }
    }
    mergeFaces(added);
    return { added, failed };
  }

  function removeFont(name: string): void {
    const lower = name.toLowerCase();
    for (const face of fontFaces.value) {
      if (face.name.toLowerCase() === lower) {
        URL.revokeObjectURL(face.url);
      }
    }
    fontFaces.value = fontFaces.value.filter((face) => face.name.toLowerCase() !== lower);
    fontFiles.value = fontFaces.value.length > 0 ? fontFaces.value.map((face) => face.file) : null;
  }

  /**
   * The uploaded face a style's font name picks, ignoring case as libass does.
   */
  function fontFace(name: string): LoadedFont | undefined {
    const lower = name.toLowerCase();
    return fontFaces.value.find((face) => face.name.toLowerCase() === lower);
  }

  /**
   * The name to draw a style's font in: the bundled or uploaded font it names, spelled as that
   * font spells it, or the default font when it names neither.
   * The renderers need this, because given a name they have no file for, FFmpeg draws nothing.
   */
  function resolveFontName(name: string): string {
    return fontFace(name)?.name ?? bundledFontName(name) ?? DEFAULT_SETTINGS.font.name;
  }

  function setTitleStyleField<K extends keyof VoiceStyleOverride>(
    field: K,
    value: VoiceStyleOverride[K],
  ) {
    videoOptions.titleStyle = { ...videoOptions.titleStyle, [field]: value };
  }

  function clearTitleStyle() {
    videoOptions.titleStyle = {};
  }

  /**
   * The voice's override as the renderer should use it, with its font name resolved.
   */
  function renderVoiceStyle(voice: VoiceId): VoiceStyleOverride | undefined {
    const style = voiceStyles.value[voice];
    if (style?.fontName === undefined) {
      return style;
    }
    return { ...style, fontName: resolveFontName(style.fontName) };
  }

  const settingsSource = computed((): SettingsFileSource => {
    const media = useMediaStore();
    return {
      song: {
        title: media.songTitle,
        artist: media.songArtist,
        duration: media.songDuration,
        youtubeUrl: media.youtubeUrl,
      },
      separationModel: media.separationModel,
      backingTrack: media.separatedTrack?.source ?? null,
      backgroundVideoOffset: media.backgroundVideoOffset,
      hintNote: media.hintNote,
      videoOptions,
      voiceStyles: voiceStyles.value,
    };
  });
  const settingsYaml = computed(() => serializeSettingsYaml(settingsSource.value));
  // What the exported subtitles carry of the settings, which is only what they can't show.
  const subtitleSettings = computed(() => serializeSubtitleSettings(settingsSource.value));

  // What everything that renders lyrics should use. `videoOptions` keeps a font name that is
  // neither bundled nor uploaded, so that the font comes back once it is uploaded.
  const renderOptions = computed<VideoSettings>(() => {
    const fontName = resolveFontName(videoOptions.font.name);
    const titleName = videoOptions.titleStyle.fontName;
    const titleFontName = titleName === undefined ? undefined : resolveFontName(titleName);
    if (fontName === videoOptions.font.name && titleFontName === titleName) {
      return videoOptions;
    }
    return {
      ...videoOptions,
      font: { ...videoOptions.font, name: fontName },
      titleStyle: { ...videoOptions.titleStyle, fontName: titleFontName },
    };
  });

  const glyphCoverage = computed<GlyphCoverage>(() =>
    Object.fromEntries(fontFaces.value.map((face) => [face.name, face.coverage])),
  );

  // What everything that lays lyrics out measures them with.
  const fonts = computed(() => {
    const metrics: Record<string, FontMetrics> = { ...BUNDLED_METRICS };
    for (const face of fontFaces.value) {
      metrics[face.name] = face.metrics;
    }
    return new FontLibrary(glyphCoverage.value, metrics);
  });

  /**
   * Binds the key to the action. A tap key takes its key from another tap key by swapping the two,
   * and so does any other action from another non-tap action.
   */
  function setTimingKey(role: TimingAction, binding: KeyBinding): void {
    const next: TimingKeys = { ...timingKeys.value };
    const clash = TIMING_ACTIONS.find(
      (other) =>
        other !== role &&
        isTapAction(other) === isTapAction(role) &&
        sameBinding(next[other], binding),
    );
    if (clash) {
      next[clash] = next[role];
    }
    next[role] = binding;
    timingKeys.value = next;
  }

  function resetTimingKeys(): void {
    timingKeys.value = { ...DEFAULT_TIMING_KEYS };
  }

  function getVoiceStyle(voice: VoiceId): VoiceStyleOverride | undefined {
    return voiceStyles.value[voice];
  }

  function setVoiceStyleField<K extends keyof VoiceStyleOverride>(
    voice: VoiceId,
    field: K,
    value: VoiceStyleOverride[K],
  ) {
    const current = { ...(voiceStyles.value[voice] ?? {}) };
    if (value === undefined) {
      delete current[field];
    } else {
      current[field] = value;
    }
    voiceStyles.value = { ...voiceStyles.value, [voice]: current };
  }

  function clearVoiceStyle(voice: VoiceId) {
    const { [voice]: _removed, ...rest } = voiceStyles.value;
    voiceStyles.value = rest;
  }

  // Move a style override onto another voice id. Used when a lyric tag edit renames a voice,
  // so the style follows the voice instead of being orphaned. No-op when the source has no override
  // or the target already has one.
  function renameVoiceStyle(from: VoiceId, to: VoiceId) {
    const style = voiceStyles.value[from];
    if (style && !voiceStyles.value[to]) {
      const { [from]: _removed, ...rest } = voiceStyles.value;
      voiceStyles.value = { ...rest, [to]: style };
    }
  }

  /**
   * Puts every setting of the Fonts and Colors card back to its default, the title and voice styles
   * included. The uploaded fonts stay in the library.
   */
  function resetStyling(): void {
    const defaults = defaultSettings();
    for (const key of STYLING_SETTINGS) {
      Object.assign(videoOptions, { [key]: defaults[key] });
    }
    voiceStyles.value = {};
  }

  // Merge a partial set of options over the current ones, e.g. from a loaded settings.yaml.
  // The nested font and color groups merge field by field, so a file that only mentions one color
  // leaves the others untouched.
  // The title style is replaced whole, since a field it leaves out takes the lyrics' own.
  function applyVideoOptions(options: Partial<VideoSettings>): void {
    const { font, color, ...rest } = options;
    Object.assign(videoOptions, rest);
    if (font) {
      Object.assign(videoOptions.font, font);
    }
    if (color) {
      Object.assign(videoOptions.color, color);
    }
  }

  // Replace every per-voice override. A settings file describes the complete set, so
  // voices it doesn't mention go back to the base style.
  function setVoiceStyles(styles: Record<VoiceId, VoiceStyleOverride>): void {
    voiceStyles.value = { ...styles };
  }

  function loadSettings(): void {
    const optionsStr = localStorage.videoOptions;
    if (!optionsStr) {
      return;
    }

    try {
      const options = JSON.parse(optionsStr) as StoredSettings;
      // Settings saved before the outline had its own color drew it in the background color.
      const storedColors = {
        ...options.color,
        outline:
          options.color.outline === undefined ? options.color.background : options.color.outline,
      };
      const newVideoOptions = {
        ...options,
        titleStyle: deserializeVoiceStyle(options.titleStyle ?? {}),
        color: {
          ...defaultSettings().color,
          ...Object.fromEntries(
            Object.entries(storedColors).map(([field, hex]) => [
              field,
              hex === null ? null : Color.parse(hex),
            ]),
          ),
        },
      } as VideoSettings;

      // Settings saved before image backgrounds name the switch after the video.
      const legacyBackground = (options as { useBackgroundVideo?: boolean }).useBackgroundVideo;
      if (legacyBackground !== undefined) {
        newVideoOptions.useBackground ??= legacyBackground;
        delete (newVideoOptions as { useBackgroundVideo?: boolean }).useBackgroundVideo;
      }

      // Settings saved before count-ins gained a "line" mode carry a boolean instead.
      const legacyCountIns = (options as { addCountIns?: boolean }).addCountIns;
      if (legacyCountIns !== undefined) {
        newVideoOptions.countInMode = legacyCountIns ? "screen" : "none";
        delete (newVideoOptions as { addCountIns?: boolean }).addCountIns;
      }

      // Handle legacy vocalSeparationModel setting
      if (
        (newVideoOptions.vocalSeparationModel as string) ===
        "model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt"
      ) {
        newVideoOptions.vocalSeparationModel = NO_VOCALS_SEPARATOR_MODEL;
      }

      // Update the reactive state with loaded options
      Object.assign(videoOptions, newVideoOptions);
    } catch (e) {
      console.error("Error loading settings:", e);
    }
  }

  function saveSettings(): void {
    try {
      const storageOptions = {
        ...videoOptions,
        titleStyle: serializeVoiceStyle(videoOptions.titleStyle),
        color: Object.fromEntries(
          Object.entries(videoOptions.color).map(([field, color]) => [
            field,
            color?.toString() ?? null,
          ]),
        ),
      } as StoredSettings;

      localStorage.videoOptions = JSON.stringify(storageOptions);
    } catch (e) {
      console.error("Error saving settings:", e);
    }
  }

  const mixSettingsAreDefault = computed(() =>
    MIX_SETTINGS.every((key) => videoOptions[key] === DEFAULT_SETTINGS[key]),
  );

  function resetMixSettings(): void {
    Object.assign(
      videoOptions,
      Object.fromEntries(MIX_SETTINGS.map((key) => [key, DEFAULT_SETTINGS[key]])),
    );
  }

  function resetSettings(): void {
    Object.assign(videoOptions, defaultSettings());
    voiceStyles.value = {};
    resetTimingKeys();
  }

  return {
    videoOptions,
    renderOptions,
    settingsYaml,
    subtitleSettings,
    voiceStyles,
    timingKeys,
    fontFaces,
    addFonts,
    removeFont,
    fontFace,
    resolveFontName,
    renderVoiceStyle,
    setTitleStyleField,
    clearTitleStyle,
    glyphCoverage,
    fonts,
    resetStyling,
    setTimingKey,
    resetTimingKeys,
    getVoiceStyle,
    setVoiceStyleField,
    clearVoiceStyle,
    renameVoiceStyle,
    applyVideoOptions,
    setVoiceStyles,
    loadSettings,
    saveSettings,
    resetSettings,
    mixSettingsAreDefault,
    resetMixSettings,
  };
});
