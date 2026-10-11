// Writing the `settings.yaml` file the app exports, and reading it back.
//
// The file is meant to be hand-editable as well as round-tripped, so parsing is deliberately lenient:
// an entry that is unknown or of the wrong type is skipped and reported as a warning rather than
// failing the whole load. Only a file that isn't a YAML mapping at all is rejected outright,
// since there is nothing to apply.

import yaml from "js-yaml";
import Color from "buefy/src/utils/color";
import { GAP_MAX_LEAD } from "@/constants";
import {
  CountInMode,
  COUNT_IN_MODES,
  FrameRate,
  FRAME_RATES,
  OutputFormat,
  OUTPUT_FORMATS,
  BackgroundFit,
  BACKGROUND_FITS,
  RenderQuality,
  RENDER_QUALITIES,
  Resolution,
  RESOLUTIONS,
  VerticalAlignment,
} from "@/lib/timing";
import {
  VoiceStyleOverride,
  VOICE_STYLE_COLOR_FIELDS,
  isEmptyOverride,
  serializeVoiceStyle,
} from "@/lib/voiceStyle";
import { VoiceId } from "@/lib/voices";
import { SeparationModel, TrackSource } from "@/types";
import { parseFileSource } from "@/lib/trackSources";
import { hintFrequency } from "@/lib/notes";
import { SEPARATION_MODELS } from "@/stores/media";
import type { VideoSettings } from "@/stores/settings";

export interface SettingsFileSong {
  title?: string;
  artist?: string;
  duration?: number;
  youtubeUrl?: string;
}

export interface ParsedSettingsFile {
  song: SettingsFileSong;
  separationModel?: SeparationModel;
  backingTrack?: TrackSource;
  backgroundVideoOffset?: number;
  hintNote?: string | null;
  videoOptions: Partial<VideoSettings>;
  // Absent when the file says nothing about voice styles, so a caller can tell
  // "no opinion" (leave the current overrides alone) from "explicitly empty".
  voiceStyles?: Record<VoiceId, VoiceStyleOverride>;
  warnings: string[];
}

export interface SettingsFileSource {
  song: {
    title: string | null;
    artist: string | null;
    duration: number | null;
    youtubeUrl: string | null;
  };
  separationModel: SeparationModel;
  // The source of the backing track the video renders with, or null while there is none.
  backingTrack: TrackSource | null;
  backgroundVideoOffset: number;
  hintNote: string | null;
  videoOptions: VideoSettings;
  voiceStyles: Record<VoiceId, VoiceStyleOverride>;
}

/**
 * The settings.yaml the project download carries, and the prompts offer before replacing settings.
 */
export function serializeSettingsYaml(source: SettingsFileSource): string {
  return yaml.dump(settingsDocument(source));
}

function settingsDocument({
  song,
  separationModel,
  backingTrack,
  backgroundVideoOffset,
  hintNote,
  videoOptions,
  voiceStyles,
}: SettingsFileSource): Record<string, unknown> {
  // The video options' own model gives way to `separationModel`, the one the user actually picked.
  const { vocalSeparationModel, color, titleStyle, ...rest } = videoOptions;
  const styledVoices = Object.entries(voiceStyles).filter(([, style]) => !isEmptyOverride(style));
  const document: Record<string, unknown> = {
    song,
    separationModel,
    ...(backingTrack ? { backingTrack } : {}),
    ...(backgroundVideoOffset ? { backgroundVideoOffset } : {}),
    ...(hintNote && hintFrequency(hintNote) ? { hintNote: hintNote.trim() } : {}),
    videoOptions: {
      ...rest,
      titleStyle: serializeVoiceStyle(titleStyle),
      color: Object.fromEntries(
        Object.entries(color).map(([field, value]) => [field, value.toString()]),
      ),
    },
  };
  if (styledVoices.length > 0) {
    document.voiceStyles = Object.fromEntries(
      styledVoices.map(([voice, style]) => [voice, serializeVoiceStyle(style)]),
    );
  }
  return document;
}

// The video options the subtitles have no trace of.
const VIDEO_OPTIONS_OUTSIDE_SUBTITLES = [
  "restoreGaps",
  "gapPreRoll",
  "gapPostRoll",
  "gapMinLength",
  "gapFade",
  "gapLevelBalance",
  "restorePausesInLines",
  "useBackground",
  "backgroundFit",
  "outputFormat",
  "resolution",
  "frameRate",
  "quality",
];

// The video options that shape the subtitles without always showing in them:
// a count-in, a staggered line or an instrumental screen only appears where a gap earns one,
// and the top margin only counts when the lyrics are aligned to the top.
// The ASS import keeps them only where they reproduce the file.
export const SUBTITLE_HINT_OPTIONS = [
  "addTitleScreen",
  "titleScreenDuration",
  "showTitle",
  "countInMode",
  "dynamicCountIns",
  "countInText",
  "countInThreshold",
  "countInDuration",
  "addStaggeredLines",
  "topMargin",
  "instrumentalThreshold",
] as const;

export type SubtitleHints = Partial<Pick<VideoSettings, (typeof SUBTITLE_HINT_OPTIONS)[number]>>;

/**
 * Copy of the value without its missing entries, or undefined when nothing is left.
 */
function compact(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(value).filter(
    ([, entry]) => entry !== undefined && entry !== null,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * The part of a settings document that a subtitles file can't show: the audio and video around
 * the subtitles, and the song's title and artist when no title screen draws them.
 * The ASS export carries it, and the ASS import applies it as it is.
 * The hints the export also carries go through the import's fit,
 * so the subtitles stay the only source of everything else.
 */
export function settingsOutsideSubtitles(
  document: Record<string, unknown>,
  titleScreen: boolean,
): Record<string, unknown> {
  const song = isMapping(document.song) ? document.song : {};
  const options = isMapping(document.videoOptions) ? document.videoOptions : {};
  const color = isMapping(options.color) ? options.color : {};
  return (
    compact({
      song: compact({
        ...(titleScreen ? {} : { title: song.title, artist: song.artist }),
        duration: song.duration,
        youtubeUrl: song.youtubeUrl,
      }),
      separationModel: document.separationModel,
      backingTrack: document.backingTrack,
      backgroundVideoOffset: document.backgroundVideoOffset,
      hintNote: document.hintNote,
      videoOptions: compact({
        ...Object.fromEntries(VIDEO_OPTIONS_OUTSIDE_SUBTITLES.map((key) => [key, options[key]])),
        color: compact({ background: color.background }),
      }),
    }) ?? {}
  );
}

/**
 * The settings outside the subtitles and the hints, as a single line of YAML for the ASS export.
 */
export function serializeSubtitleSettings(source: SettingsFileSource): string {
  const { addTitleScreen, showTitle } = source.videoOptions;
  const document = settingsOutsideSubtitles(settingsDocument(source), addTitleScreen && showTitle);
  const hints = compact(
    Object.fromEntries(SUBTITLE_HINT_OPTIONS.map((key) => [key, source.videoOptions[key]])),
  );
  const videoOptions = { ...(document.videoOptions as Record<string, unknown>), ...hints };
  return yaml.dump({ ...document, videoOptions }, { flowLevel: 0, lineWidth: -1 }).trim();
}

/**
 * The hints in a line the ASS export wrote. Throws when the line isn't a YAML mapping.
 */
export function readSubtitleHints(line: string): SubtitleHints {
  const { videoOptions } = parseSettingsYaml(line);
  return Object.fromEntries(
    SUBTITLE_HINT_OPTIONS.filter((key) => videoOptions[key] !== undefined).map((key) => [
      key,
      videoOptions[key],
    ]),
  );
}

const BOOLEAN_OPTIONS = [
  "addTitleScreen",
  "showTitle",
  "dynamicCountIns",
  "addStaggeredLines",
  "useStoredDisplayPeriods",
  "restoreGaps",
  "restorePausesInLines",
  "useBackground",
] as const;

const POSITIVE_NUMBER_OPTIONS = [
  "titleScreenDuration",
  "countInThreshold",
  "countInDuration",
] as const;

const GAP_SECONDS_OPTIONS = ["gapPostRoll", "gapMinLength", "gapFade"] as const;

const SHADOW_OFFSET_OPTIONS = ["shadowX", "shadowY"] as const;

// Files written before count-ins gained a "line" mode say addCountIns: true/false.
const LEGACY_COUNT_IN_KEY = "addCountIns";

// Files written before image backgrounds name the switch after the video.
const LEGACY_BACKGROUND_KEY = "useBackgroundVideo";

// The exporter writes the enum's numeric value, but a hand-written file is much clearer with a name,
// so accept either.
const ALIGNMENT_NAMES: Record<string, VerticalAlignment> = {
  top: VerticalAlignment.Top,
  middle: VerticalAlignment.Middle,
  bottom: VerticalAlignment.Bottom,
};

const KNOWN_VIDEO_OPTIONS = [
  ...BOOLEAN_OPTIONS,
  ...POSITIVE_NUMBER_OPTIONS,
  ...GAP_SECONDS_OPTIONS,
  ...SHADOW_OFFSET_OPTIONS,
  "gapPreRoll",
  "gapLevelBalance",
  "outlineWidth",
  "countInMode",
  LEGACY_COUNT_IN_KEY,
  LEGACY_BACKGROUND_KEY,
  "countInText",
  "instrumentalThreshold",
  "outputFormat",
  "backgroundFit",
  "resolution",
  "frameRate",
  "quality",
  "verticalAlignment",
  "lineSpacing",
  "topMargin",
  "font",
  "titleStyle",
  "color",
  "vocalSeparationModel",
];

const COLOR_FIELDS = ["background", "primary", "secondary", "outline", "shadow"] as const;

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, path: string, warnings: string[]): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    warnings.push(`${path}: expected text, ignoring ${JSON.stringify(value)}`);
    return undefined;
  }
  return value;
}

function readNumber(value: unknown, path: string, warnings: string[]): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    warnings.push(`${path}: expected a number, ignoring ${JSON.stringify(value)}`);
    return undefined;
  }
  return value;
}

function readPositiveNumber(value: unknown, path: string, warnings: string[]): number | undefined {
  const parsed = readNumber(value, path, warnings);
  if (parsed === undefined) return undefined;
  if (parsed <= 0) {
    warnings.push(
      `${path}: expected a number of seconds above zero, ignoring ${JSON.stringify(value)}`,
    );
    return undefined;
  }
  return parsed;
}

function readNumberBetween(
  value: unknown,
  path: string,
  warnings: string[],
  min: number,
  max = Infinity,
): number | undefined {
  const parsed = readNumber(value, path, warnings);
  if (parsed === undefined) return undefined;
  if (parsed < min || parsed > max) {
    const expected = max === Infinity ? `at least ${min}` : `from ${min} to ${max}`;
    warnings.push(`${path}: expected a number ${expected}, ignoring ${JSON.stringify(value)}`);
    return undefined;
  }
  return parsed;
}

function readSecondsOrZero(value: unknown, path: string, warnings: string[]): number | undefined {
  const parsed = readNumber(value, path, warnings);
  if (parsed === undefined) return undefined;
  if (parsed < 0) {
    warnings.push(
      `${path}: expected a number of seconds, or zero, ignoring ${JSON.stringify(value)}`,
    );
    return undefined;
  }
  return parsed;
}

function readOutlineWidth(value: unknown, path: string, warnings: string[]): number | undefined {
  const parsed = readNumber(value, path, warnings);
  if (parsed === undefined) return undefined;
  if (parsed < 0) {
    warnings.push(`${path}: expected a width of zero or more, ignoring ${JSON.stringify(value)}`);
    return undefined;
  }
  return parsed;
}

function readFontMultiple(
  value: unknown,
  path: string,
  warnings: string[],
  allowZero: boolean,
): number | undefined {
  const parsed = readNumber(value, path, warnings);
  if (parsed === undefined) return undefined;
  if (parsed < 0 || (parsed === 0 && !allowZero)) {
    const range = allowZero ? "of zero or more" : "above zero";
    warnings.push(
      `${path}: expected a multiple of the font size ${range}, ignoring ${JSON.stringify(value)}`,
    );
    return undefined;
  }
  return parsed;
}

function readBoolean(value: unknown, path: string, warnings: string[]): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    warnings.push(`${path}: expected true or false, ignoring ${JSON.stringify(value)}`);
    return undefined;
  }
  return value;
}

function readColor(value: unknown, path: string, warnings: string[]): Color | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    warnings.push(`${path}: expected a color like "#ff00ff", ignoring ${JSON.stringify(value)}`);
    return undefined;
  }
  try {
    return Color.parse(value);
  } catch (e) {
    warnings.push(`${path}: ${JSON.stringify(value)} is not a valid color, ignoring it`);
    return undefined;
  }
}

function readAlignment(
  value: unknown,
  path: string,
  warnings: string[],
): VerticalAlignment | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const named = ALIGNMENT_NAMES[value.trim().toLowerCase()];
    if (named === undefined) {
      warnings.push(`${path}: expected top, middle or bottom, ignoring ${JSON.stringify(value)}`);
      return undefined;
    }
    return named;
  }
  if (
    value === VerticalAlignment.Top ||
    value === VerticalAlignment.Middle ||
    value === VerticalAlignment.Bottom
  ) {
    return value as VerticalAlignment;
  }
  warnings.push(`${path}: expected top, middle or bottom, ignoring ${JSON.stringify(value)}`);
  return undefined;
}

function readCountInMode(
  value: unknown,
  path: string,
  warnings: string[],
): CountInMode | undefined {
  const name = readString(value, path, warnings);
  if (name === undefined) return undefined;
  const normalized = name.trim().toLowerCase();
  if (!COUNT_IN_MODES.some((mode) => mode === normalized)) {
    warnings.push(
      `${path}: expected ${COUNT_IN_MODES.join(", ")}, ignoring ${JSON.stringify(value)}`,
    );
    return undefined;
  }
  return normalized as CountInMode;
}

function readOutputFormat(
  value: unknown,
  path: string,
  warnings: string[],
): OutputFormat | undefined {
  const name = readString(value, path, warnings);
  if (name === undefined) return undefined;
  const normalized = name.trim().toLowerCase();
  if (!OUTPUT_FORMATS.some((format) => format === normalized)) {
    warnings.push(
      `${path}: expected ${OUTPUT_FORMATS.join(" or ")}, ignoring ${JSON.stringify(value)}`,
    );
    return undefined;
  }
  return normalized as OutputFormat;
}

function readBackgroundFit(
  value: unknown,
  path: string,
  warnings: string[],
): BackgroundFit | undefined {
  const name = readString(value, path, warnings);
  if (name === undefined) return undefined;
  const normalized = name.trim().toLowerCase();
  if (!BACKGROUND_FITS.some((fit) => fit === normalized)) {
    warnings.push(
      `${path}: expected ${BACKGROUND_FITS.join(" or ")}, ignoring ${JSON.stringify(value)}`,
    );
    return undefined;
  }
  return normalized as BackgroundFit;
}

// A hand-written file may well give the height alone, as in `resolution: 1080`.
function readResolution(value: unknown, path: string, warnings: string[]): Resolution | undefined {
  const name = typeof value === "number" ? `${value}p` : readString(value, path, warnings);
  if (name === undefined) return undefined;
  const normalized = name.trim().toLowerCase();
  if (!(normalized in RESOLUTIONS)) {
    warnings.push(
      `${path}: expected ${Object.keys(RESOLUTIONS).join(" or ")}, ignoring ${JSON.stringify(value)}`,
    );
    return undefined;
  }
  return normalized as Resolution;
}

function readFrameRate(value: unknown, path: string, warnings: string[]): FrameRate | undefined {
  const rate = readNumber(value, path, warnings);
  if (rate === undefined) return undefined;
  if (!FRAME_RATES.some((allowed) => allowed === rate)) {
    warnings.push(
      `${path}: expected ${FRAME_RATES.join(" or ")}, ignoring ${JSON.stringify(value)}`,
    );
    return undefined;
  }
  return rate as FrameRate;
}

function readRenderQuality(
  value: unknown,
  path: string,
  warnings: string[],
): RenderQuality | undefined {
  const name = readString(value, path, warnings);
  if (name === undefined) return undefined;
  const normalized = name.trim().toLowerCase();
  if (!RENDER_QUALITIES.some((quality) => quality === normalized)) {
    warnings.push(
      `${path}: expected ${RENDER_QUALITIES.join(" or ")}, ignoring ${JSON.stringify(value)}`,
    );
    return undefined;
  }
  return normalized as RenderQuality;
}

function readSeparationModel(
  value: unknown,
  path: string,
  warnings: string[],
): SeparationModel | undefined {
  const name = readString(value, path, warnings);
  if (name === undefined) return undefined;
  if (!SEPARATION_MODELS.includes(name)) {
    warnings.push(`${path}: unknown separation model ${JSON.stringify(name)}, ignoring it`);
    return undefined;
  }
  return name as SeparationModel;
}

function readTrackSource(
  value: unknown,
  path: string,
  warnings: string[],
): TrackSource | undefined {
  if (typeof value === "string" && parseFileSource(value as TrackSource)) {
    return value as TrackSource;
  }
  return readSeparationModel(value, path, warnings);
}

function warnUnknownKeys(
  source: Record<string, unknown>,
  known: readonly string[],
  path: string,
  warnings: string[],
) {
  for (const key of Object.keys(source)) {
    if (!known.includes(key)) {
      warnings.push(`${path ? `${path}.${key}` : key}: unknown setting, ignoring it`);
    }
  }
}

function parseSong(raw: unknown, warnings: string[]): SettingsFileSong {
  const song: SettingsFileSong = {};
  if (raw === undefined || raw === null) return song;
  if (!isMapping(raw)) {
    warnings.push("song: expected a mapping, ignoring it");
    return song;
  }
  warnUnknownKeys(raw, ["title", "artist", "duration", "youtubeUrl"], "song", warnings);

  const title = readString(raw.title, "song.title", warnings);
  const artist = readString(raw.artist, "song.artist", warnings);
  const duration = readNumber(raw.duration, "song.duration", warnings);
  const youtubeUrl = readString(raw.youtubeUrl, "song.youtubeUrl", warnings);

  if (title !== undefined) song.title = title;
  if (artist !== undefined) song.artist = artist;
  if (duration !== undefined) song.duration = duration;
  if (youtubeUrl !== undefined) song.youtubeUrl = youtubeUrl;
  return song;
}

function parseVideoOptions(raw: unknown, warnings: string[]): Partial<VideoSettings> {
  const options: Partial<VideoSettings> = {};
  if (raw === undefined || raw === null) return options;
  if (!isMapping(raw)) {
    warnings.push("videoOptions: expected a mapping, ignoring it");
    return options;
  }
  warnUnknownKeys(raw, KNOWN_VIDEO_OPTIONS, "videoOptions", warnings);

  for (const key of BOOLEAN_OPTIONS) {
    const value = readBoolean(raw[key], `videoOptions.${key}`, warnings);
    if (value !== undefined) options[key] = value;
  }
  if (options.useBackground === undefined) {
    const path = `videoOptions.${LEGACY_BACKGROUND_KEY}`;
    const legacy = readBoolean(raw[LEGACY_BACKGROUND_KEY], path, warnings);
    if (legacy !== undefined) options.useBackground = legacy;
  }

  for (const key of POSITIVE_NUMBER_OPTIONS) {
    const value = readPositiveNumber(raw[key], `videoOptions.${key}`, warnings);
    if (value !== undefined) options[key] = value;
  }

  const outlineWidth = readOutlineWidth(raw.outlineWidth, "videoOptions.outlineWidth", warnings);
  if (outlineWidth !== undefined) options.outlineWidth = outlineWidth;

  for (const key of SHADOW_OFFSET_OPTIONS) {
    const value = readNumber(raw[key], `videoOptions.${key}`, warnings);
    if (value !== undefined) options[key] = value;
  }

  const countInText = readString(raw.countInText, "videoOptions.countInText", warnings);
  if (countInText !== undefined) options.countInText = countInText;

  const legacyCountIns = raw[LEGACY_COUNT_IN_KEY];
  if (legacyCountIns !== undefined && legacyCountIns !== null) {
    const enabled = readBoolean(legacyCountIns, `videoOptions.${LEGACY_COUNT_IN_KEY}`, warnings);
    if (enabled !== undefined) options.countInMode = enabled ? "screen" : "none";
  }

  const instrumentalThreshold = readSecondsOrZero(
    raw.instrumentalThreshold,
    "videoOptions.instrumentalThreshold",
    warnings,
  );
  if (instrumentalThreshold !== undefined) options.instrumentalThreshold = instrumentalThreshold;

  for (const key of GAP_SECONDS_OPTIONS) {
    const value = readSecondsOrZero(raw[key], `videoOptions.${key}`, warnings);
    if (value !== undefined) options[key] = value;
  }
  const preRoll = readNumberBetween(
    raw.gapPreRoll,
    "videoOptions.gapPreRoll",
    warnings,
    -GAP_MAX_LEAD,
  );
  if (preRoll !== undefined) options.gapPreRoll = preRoll;
  const balance = readNumberBetween(
    raw.gapLevelBalance,
    "videoOptions.gapLevelBalance",
    warnings,
    0,
    1,
  );
  if (balance !== undefined) options.gapLevelBalance = balance;

  const countInMode = readCountInMode(raw.countInMode, "videoOptions.countInMode", warnings);
  if (countInMode !== undefined) options.countInMode = countInMode;

  const alignment = readAlignment(
    raw.verticalAlignment,
    "videoOptions.verticalAlignment",
    warnings,
  );
  if (alignment !== undefined) options.verticalAlignment = alignment;

  const lineSpacing = readFontMultiple(
    raw.lineSpacing,
    "videoOptions.lineSpacing",
    warnings,
    false,
  );
  if (lineSpacing !== undefined) options.lineSpacing = lineSpacing;
  const topMargin = readFontMultiple(raw.topMargin, "videoOptions.topMargin", warnings, true);
  if (topMargin !== undefined) options.topMargin = topMargin;

  const outputFormat = readOutputFormat(raw.outputFormat, "videoOptions.outputFormat", warnings);
  if (outputFormat !== undefined) options.outputFormat = outputFormat;

  const fit = readBackgroundFit(raw.backgroundFit, "videoOptions.backgroundFit", warnings);
  if (fit !== undefined) options.backgroundFit = fit;

  const resolution = readResolution(raw.resolution, "videoOptions.resolution", warnings);
  if (resolution !== undefined) options.resolution = resolution;
  const frameRate = readFrameRate(raw.frameRate, "videoOptions.frameRate", warnings);
  if (frameRate !== undefined) options.frameRate = frameRate;
  const quality = readRenderQuality(raw.quality, "videoOptions.quality", warnings);
  if (quality !== undefined) options.quality = quality;

  // The exporter writes the separation model at the top level, but accept the store's own field name too,
  // since that is what a settings dump from localStorage looks like.
  const model = readSeparationModel(
    raw.vocalSeparationModel,
    "videoOptions.vocalSeparationModel",
    warnings,
  );
  if (model !== undefined) options.vocalSeparationModel = model;

  if (raw.font !== undefined && raw.font !== null) {
    if (isMapping(raw.font)) {
      warnUnknownKeys(raw.font, ["name", "size", "bold", "italic"], "videoOptions.font", warnings);
      const name = readString(raw.font.name, "videoOptions.font.name", warnings);
      const size = readNumber(raw.font.size, "videoOptions.font.size", warnings);
      const bold = readBoolean(raw.font.bold, "videoOptions.font.bold", warnings);
      const italic = readBoolean(raw.font.italic, "videoOptions.font.italic", warnings);
      const font: Partial<VideoSettings["font"]> = {};
      if (name !== undefined) font.name = name;
      if (size !== undefined) font.size = size;
      if (bold !== undefined) font.bold = bold;
      if (italic !== undefined) font.italic = italic;
      if (Object.keys(font).length > 0) options.font = font as VideoSettings["font"];
    } else {
      warnings.push("videoOptions.font: expected a mapping, ignoring it");
    }
  }

  // An empty title style is a setting of its own: the title is drawn like the lyrics.
  if (raw.titleStyle !== undefined && raw.titleStyle !== null) {
    if (isMapping(raw.titleStyle)) {
      options.titleStyle = parseVoiceStyle(raw.titleStyle, "videoOptions.titleStyle", warnings);
    } else {
      warnings.push("videoOptions.titleStyle: expected a mapping, ignoring it");
    }
  }

  if (raw.color !== undefined && raw.color !== null) {
    if (isMapping(raw.color)) {
      warnUnknownKeys(raw.color, COLOR_FIELDS, "videoOptions.color", warnings);
      const color: Partial<VideoSettings["color"]> = {};
      for (const field of COLOR_FIELDS) {
        const parsed = readColor(raw.color[field], `videoOptions.color.${field}`, warnings);
        if (parsed !== undefined) color[field] = parsed;
      }
      if (Object.keys(color).length > 0) options.color = color as VideoSettings["color"];
    } else {
      warnings.push("videoOptions.color: expected a mapping, ignoring it");
    }
  }

  return options;
}

function parseVoiceStyle(
  raw: Record<string, unknown>,
  path: string,
  warnings: string[],
): VoiceStyleOverride {
  const style: VoiceStyleOverride = {};
  warnUnknownKeys(
    raw,
    [
      "fontName",
      "fontSize",
      "bold",
      "italic",
      "outlineWidth",
      ...SHADOW_OFFSET_OPTIONS,
      ...VOICE_STYLE_COLOR_FIELDS,
    ],
    path,
    warnings,
  );

  const fontName = readString(raw.fontName, `${path}.fontName`, warnings);
  const fontSize = readNumber(raw.fontSize, `${path}.fontSize`, warnings);
  const bold = readBoolean(raw.bold, `${path}.bold`, warnings);
  const italic = readBoolean(raw.italic, `${path}.italic`, warnings);

  if (fontName !== undefined) style.fontName = fontName;
  if (fontSize !== undefined) style.fontSize = fontSize;
  if (bold !== undefined) style.bold = bold;
  if (italic !== undefined) style.italic = italic;

  const outlineWidth = readOutlineWidth(raw.outlineWidth, `${path}.outlineWidth`, warnings);
  if (outlineWidth !== undefined) style.outlineWidth = outlineWidth;
  for (const key of SHADOW_OFFSET_OPTIONS) {
    const value = readNumber(raw[key], `${path}.${key}`, warnings);
    if (value !== undefined) style[key] = value;
  }

  for (const field of VOICE_STYLE_COLOR_FIELDS) {
    const parsed = readColor(raw[field], `${path}.${field}`, warnings);
    if (parsed !== undefined) style[field] = parsed;
  }

  return style;
}

function parseVoiceStyles(
  raw: unknown,
  warnings: string[],
): Record<VoiceId, VoiceStyleOverride> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isMapping(raw)) {
    warnings.push("voiceStyles: expected a mapping of voice names to styles, ignoring it");
    return undefined;
  }
  const styles: Record<VoiceId, VoiceStyleOverride> = {};
  for (const [voice, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue;
    if (!isMapping(value)) {
      warnings.push(`voiceStyles.${voice}: expected a mapping, ignoring it`);
      continue;
    }
    styles[voice] = parseVoiceStyle(value, `voiceStyles.${voice}`, warnings);
  }
  return styles;
}

// Parse the contents of a settings.yaml file. Throws only when the file cannot be
// understood as a settings mapping at all. Everything else surfaces in `warnings`.
export function parseSettingsYaml(text: string): ParsedSettingsFile {
  let document: unknown;
  try {
    document = yaml.load(text);
  } catch (e) {
    throw new Error(`Could not parse the settings file: ${(e as Error).message}`);
  }
  if (document === undefined || document === null || document === "") {
    throw new Error("The settings file is empty.");
  }
  if (!isMapping(document)) {
    throw new Error("The settings file must be a YAML mapping of settings.");
  }

  const warnings: string[] = [];
  warnUnknownKeys(
    document,
    [
      "song",
      "separationModel",
      "backingTrack",
      "backgroundVideoOffset",
      "hintNote",
      "videoOptions",
      "voiceStyles",
    ],
    "",
    warnings,
  );

  const videoOptions = parseVideoOptions(document.videoOptions, warnings);
  const parsed: ParsedSettingsFile = {
    song: parseSong(document.song, warnings),
    videoOptions,
    warnings,
  };

  const model =
    readSeparationModel(document.separationModel, "separationModel", warnings) ??
    videoOptions.vocalSeparationModel;
  if (model !== undefined) parsed.separationModel = model;

  const backingTrack = readTrackSource(document.backingTrack, "backingTrack", warnings);
  if (backingTrack !== undefined) parsed.backingTrack = backingTrack;

  const offset = readNumber(document.backgroundVideoOffset, "backgroundVideoOffset", warnings);
  if (offset !== undefined) parsed.backgroundVideoOffset = offset;

  if (document.hintNote !== undefined) {
    // An unquoted frequency loads as a number.
    const note =
      typeof document.hintNote === "number" ? String(document.hintNote) : document.hintNote;
    if (note === null || (typeof note === "string" && hintFrequency(note))) {
      parsed.hintNote = note;
    } else {
      warnings.push(
        `hintNote: expected a note from A1 to G6 or a frequency in Hz, ignoring ${JSON.stringify(document.hintNote)}`,
      );
    }
  }

  const voiceStyles = parseVoiceStyles(document.voiceStyles, warnings);
  if (voiceStyles !== undefined) parsed.voiceStyles = voiceStyles;

  return parsed;
}
