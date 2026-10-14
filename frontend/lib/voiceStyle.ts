// Per-voice style overrides.
//
// Each voice can override a limited subset of the base karaoke style. An override
// is a partial set of fields. Resolving merges it field-by-field over the base `KaraokeOptions`,
// leaving everything else (count-ins, alignment, etc.) shared.

import { default as BuefyColor } from "buefy/src/utils/color";
import { KaraokeOptions } from "./timing";

export interface VoiceStyleOverride {
  fontName?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  primary?: BuefyColor;
  secondary?: BuefyColor;
  outline?: BuefyColor;
  shadow?: BuefyColor;
  outlineWidth?: number;
  shadowX?: number;
  shadowY?: number;
}

// The override fields holding colors, which serialize to hex strings.
export const VOICE_STYLE_COLOR_FIELDS = ["primary", "secondary", "outline", "shadow"] as const;

// Voice style overrides serialize colors as hex strings, like the base video options.
// Used both for localStorage persistence and for the exported settings.yaml.
export function serializeVoiceStyle(style: VoiceStyleOverride): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined) continue;
    out[key] = VOICE_STYLE_COLOR_FIELDS.includes(key as any)
      ? (value as BuefyColor).toString()
      : value;
  }
  return out;
}

export function deserializeVoiceStyle(stored: Record<string, unknown>): VoiceStyleOverride {
  const style: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (value === undefined || value === null) continue;
    style[key] = VOICE_STYLE_COLOR_FIELDS.includes(key as any)
      ? BuefyColor.parse(value as string)
      : value;
  }
  return style as VoiceStyleOverride;
}

/**
 * Whether the options draw an outline.
 */
export function outlineDrawn({ outlineWidth }: KaraokeOptions): boolean {
  return outlineWidth > 0;
}

/**
 * Whether the options draw a shadow.
 */
export function shadowDrawn({ shadowX, shadowY }: KaraokeOptions): boolean {
  return Boolean(shadowX || shadowY);
}

/**
 * The color an outline or shadow takes when it is turned on and no color was picked.
 */
export function defaultEffectColor(): BuefyColor {
  return BuefyColor.parse("black");
}

export function isEmptyOverride(override?: VoiceStyleOverride): boolean {
  return !override || Object.values(override).every((v) => v === undefined);
}

// Resolve a voice's effective options by merging its override over the base. Returns the
// base unchanged when there is no override, so un-styled voices render identically.
export function applyVoiceStyle(
  base: KaraokeOptions,
  override?: VoiceStyleOverride,
): KaraokeOptions {
  if (isEmptyOverride(override)) {
    return base;
  }
  const o = override as VoiceStyleOverride;
  const resolved: KaraokeOptions = {
    ...base,
    outlineWidth: o.outlineWidth ?? base.outlineWidth,
    shadowX: o.shadowX ?? base.shadowX,
    shadowY: o.shadowY ?? base.shadowY,
    font: {
      ...base.font,
      name: o.fontName ?? base.font.name,
      size: o.fontSize ?? base.font.size,
      bold: o.bold ?? base.font.bold,
      italic: o.italic ?? base.font.italic,
    },
    color: {
      ...base.color,
      primary: o.primary ?? base.color.primary,
      secondary: o.secondary ?? base.color.secondary,
      outline: o.outline ?? base.color.outline ?? defaultEffectColor(),
      shadow: o.shadow ?? base.color.shadow ?? defaultEffectColor(),
    },
  };
  if (!outlineDrawn(resolved)) resolved.color.outline = null;
  if (!shadowDrawn(resolved)) resolved.color.shadow = null;
  return resolved;
}
