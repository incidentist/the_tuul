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
import { persistBlobRef } from "@/lib/persistence";
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
import { readFont } from "@/lib/fontFile";
import { GlyphCoverage } from "@/lib/fonts";
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

interface LoadedFont {
  family: string;
  url: string;
  coverage: ReadonlySet<number>;
}

export const useSettingsStore = defineStore("settings", () => {
  // Initialize with default settings
  const videoOptions = reactive<VideoSettings>(defaultSettings());

  // Per-voice style overrides, keyed by voice id. Empty/absent => the voice uses the base.
  const voiceStyles = ref<Record<VoiceId, VoiceStyleOverride>>(loadVoiceStyles());

  // Kept out of `videoOptions`, which is what the exported settings.yaml describes: these
  // are about how the tapping tab is driven, not about the video.
  const timingKeys = ref<TimingKeys>(loadTimingKeys());

  // Kept out of `videoOptions`, which is JSON-serialized to localStorage wholesale. The
  // file goes to IndexedDB instead.
  const customFont = ref<File | null>(null);
  // The name the font declares for itself, which is what an ASS style row must carry.
  // Null means the picked font stands.
  const customFontFamily = ref<string | null>(null);
  // libass takes URLs, not blobs. Not revoked while the font is in use: the preview's
  // worker and FFmpeg read it lazily, and revoking mid-read fails the read.
  const customFontUrl = ref<string | null>(null);
  // Which of the characters the fallback fonts stand in for the uploaded font can draw.
  const customFontCoverage = shallowRef<ReadonlySet<number>>(new Set());

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

  // The family name is re-derived on load rather than stored, so a file that has gone
  // unreadable is dropped instead of naming a font libass can't find.
  persistBlobRef("settings.customFont", customFont).then(async () => {
    const file = customFont.value;
    if (!file || customFontFamily.value) {
      return;
    }
    try {
      const { family, coverage } = await readFont(file);
      customFontFamily.value = family;
      customFontCoverage.value = coverage;
      customFontUrl.value = URL.createObjectURL(file);
    } catch (e) {
      console.error("Could not read the saved custom font; ignoring it", e);
      customFont.value = null;
    }
  });

  // Per-voice uploaded fonts, kept out of `voiceStyles`, which settings.yaml describes and which holds no files.
  // Only the files are stored. The family names and URLs are re-derived, as for the base font.
  const voiceFontFiles = shallowRef<Record<VoiceId, File> | null>(null);
  const voiceFonts = shallowRef<Record<VoiceId, LoadedFont>>({});

  persistBlobRef("settings.voiceFonts", voiceFontFiles).then(async () => {
    const loaded: Record<VoiceId, LoadedFont> = {};
    const readable: Record<VoiceId, File> = {};
    for (const [voice, file] of Object.entries(voiceFontFiles.value ?? {})) {
      try {
        loaded[voice] = { ...(await readFont(file)), url: URL.createObjectURL(file) };
        readable[voice] = file;
      } catch (e) {
        console.error(`Could not read the saved font for ${voice}; ignoring it`, e);
      }
    }
    voiceFonts.value = { ...loaded, ...voiceFonts.value };
    if (Object.keys(readable).length !== Object.keys(voiceFontFiles.value ?? {}).length) {
      voiceFontFiles.value = readable;
    }
  });

  function getVoiceFont(voice: VoiceId): (LoadedFont & { file: File }) | undefined {
    const file = voiceFontFiles.value?.[voice];
    const font = voiceFonts.value[voice];
    return file && font ? { file, ...font } : undefined;
  }

  /**
   * Clears the voice's font when given null. Parses the family name before storing anything,
   * so on UnreadableFontError the font already in use still stands.
   */
  async function setVoiceFont(voice: VoiceId, file: File | null): Promise<void> {
    const { [voice]: _file, ...files } = voiceFontFiles.value ?? {};
    const { [voice]: _font, ...fonts } = voiceFonts.value;
    if (file) {
      const font = await readFont(file);
      files[voice] = file;
      fonts[voice] = { ...font, url: URL.createObjectURL(file) };
    }
    voiceFontFiles.value = Object.keys(files).length > 0 ? files : null;
    voiceFonts.value = fonts;
  }

  // The title's uploaded font, kept out of `videoOptions.titleStyle` like the voices' fonts.
  const titleFontFile = ref<File | null>(null);
  const titleFontLoaded = shallowRef<LoadedFont | null>(null);

  persistBlobRef("settings.titleFont", titleFontFile).then(async () => {
    const file = titleFontFile.value;
    if (!file || titleFontLoaded.value) {
      return;
    }
    try {
      titleFontLoaded.value = { ...(await readFont(file)), url: URL.createObjectURL(file) };
    } catch (e) {
      console.error("Could not read the saved title font; ignoring it", e);
      titleFontFile.value = null;
    }
  });

  const titleFont = computed((): (LoadedFont & { file: File }) | undefined =>
    titleFontFile.value && titleFontLoaded.value
      ? { file: titleFontFile.value, ...titleFontLoaded.value }
      : undefined,
  );

  /**
   * Clears the title's font when given null. Parses the family name before storing anything,
   * so on UnreadableFontError the font already in use still stands.
   */
  async function setTitleFont(file: File | null): Promise<void> {
    if (!file) {
      titleFontFile.value = null;
      titleFontLoaded.value = null;
      return;
    }
    const font = await readFont(file);
    titleFontFile.value = file;
    titleFontLoaded.value = { ...font, url: URL.createObjectURL(file) };
  }

  function setTitleStyleField<K extends keyof VoiceStyleOverride>(
    field: K,
    value: VoiceStyleOverride[K],
  ) {
    videoOptions.titleStyle = { ...videoOptions.titleStyle, [field]: value };
  }

  function clearTitleStyle() {
    videoOptions.titleStyle = {};
    void setTitleFont(null);
  }

  /**
   * The voice's override as the renderer should use it, with an uploaded font standing in for the picked one.
   */
  function renderVoiceStyle(voice: VoiceId): VoiceStyleOverride | undefined {
    const font = voiceFonts.value[voice];
    const style = voiceStyles.value[voice];
    return font ? { ...style, fontName: font.family } : style;
  }

  // Clears the font when given null. Parses the family name before storing anything, so
  // on UnreadableFontError the previously active font still stands.
  async function setCustomFont(file: File | null): Promise<void> {
    if (!file) {
      customFont.value = null;
      customFontFamily.value = null;
      customFontCoverage.value = new Set();
      customFontUrl.value = null;
      return;
    }
    const { family, coverage } = await readFont(file);
    customFont.value = file;
    customFontFamily.value = family;
    customFontCoverage.value = coverage;
    customFontUrl.value = URL.createObjectURL(file);
  }

  // Built from the picked font, not the uploaded one:
  // a settings file naming a font it can't carry would no longer load back.
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

  // What everything that renders lyrics should use: `videoOptions` is raw UI state, where
  // the font picker keeps its own value even while an uploaded font overrides it.
  const renderOptions = computed<VideoSettings>(() => {
    const titleFamily = titleFontLoaded.value?.family;
    if (!customFontFamily.value && !titleFamily) {
      return videoOptions;
    }
    return {
      ...videoOptions,
      font: { ...videoOptions.font, name: customFontFamily.value ?? videoOptions.font.name },
      titleStyle: titleFamily
        ? { ...videoOptions.titleStyle, fontName: titleFamily }
        : videoOptions.titleStyle,
    };
  });

  const glyphCoverage = computed<GlyphCoverage>(() => {
    const coverage: Record<string, ReadonlySet<number>> = {};
    for (const font of Object.values(voiceFonts.value)) {
      coverage[font.family] = font.coverage;
    }
    if (titleFontLoaded.value) {
      coverage[titleFontLoaded.value.family] = titleFontLoaded.value.coverage;
    }
    if (customFontFamily.value) {
      coverage[customFontFamily.value] = customFontCoverage.value;
    }
    return coverage;
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
    void setVoiceFont(voice, null);
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
    const file = voiceFontFiles.value?.[from];
    const font = voiceFonts.value[from];
    if (file && font && !voiceFontFiles.value?.[to]) {
      const { [from]: _file, ...files } = voiceFontFiles.value ?? {};
      const { [from]: _font, ...fonts } = voiceFonts.value;
      voiceFontFiles.value = { ...files, [to]: file };
      voiceFonts.value = { ...fonts, [to]: font };
    }
  }

  /**
   * Puts the base, title and voice fonts back to their defaults, and drops every uploaded font.
   */
  async function resetFonts(): Promise<void> {
    videoOptions.font = { ...DEFAULT_SETTINGS.font };
    const {
      fontName: _name,
      fontSize: _size,
      bold: _bold,
      italic: _italic,
      ...titleRest
    } = videoOptions.titleStyle;
    videoOptions.titleStyle = { ...titleRest, fontSize: DEFAULT_SETTINGS.titleStyle.fontSize };
    const styles: Record<VoiceId, VoiceStyleOverride> = {};
    for (const [voice, style] of Object.entries(voiceStyles.value)) {
      const { fontName: _n, fontSize: _s, bold: _b, italic: _i, ...rest } = style;
      if (Object.keys(rest).length > 0) styles[voice] = rest;
    }
    voiceStyles.value = styles;
    await setCustomFont(null);
    await setTitleFont(null);
    voiceFontFiles.value = null;
    voiceFonts.value = {};
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
    void resetFonts();
  }

  return {
    videoOptions,
    renderOptions,
    settingsYaml,
    subtitleSettings,
    voiceStyles,
    timingKeys,
    customFont,
    customFontFamily,
    customFontUrl,
    setCustomFont,
    getVoiceFont,
    setVoiceFont,
    renderVoiceStyle,
    titleFont,
    setTitleFont,
    setTitleStyleField,
    clearTitleStyle,
    glyphCoverage,
    resetFonts,
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
