// See webpack.common.js for process.env setup
export const API_HOSTNAME = import.meta.env.TUUL_API_HOSTNAME || "";
export const DONATE_URL = import.meta.env.TUUL_DONATE_URL || "";

export const KEY_CODES = {
  SPACEBAR: 32, // code: "Space"
  ENTER: 13, // code: "Enter"
};

export const LYRIC_MARKERS = {
  SEGMENT_START: 1,
  SEGMENT_END: 2,
};

export const VIDEO_SIZE = {
  width: 400,
  height: 320
};

export const TITLE_SCREEN_DURATION = 4.0
export const INSTRUMENTAL_SCREEN_THRESHOLD = 8.0

// Each key is written into the .ass file as the style's Fontname, so it MUST
// match the font's internal family name (name table ID 1). ffmpeg.wasm is built
// without fontconfig, so libass can only do exact-name matching and silently
// renders no text at all when the name doesn't match. See FONTS.spec.ts.
export const FONTS = {
  "Andale Mono": "/static/fonts/AndaleMono.ttf",
  Arial: "/static/fonts/Arial.ttf",
  "Arial Narrow": "/static/fonts/ArialNarrow.ttf",
  "Comic Sans MS": "/static/fonts/ComicSans.ttf",
  "Courier New": "/static/fonts/CourierNew.ttf",
  Georgia: "/static/fonts/Georgia.ttf",
  Impact: "/static/fonts/Impact.ttf",
  "Metal Mania": "/static/fonts/MetalMania.ttf",
  "Times New Roman": "/static/fonts/TimesNewRoman.ttf",
  "Trebuchet MS": "/static/fonts/Trebuchet.ttf",
  Verdana: "/static/fonts/Verdana.ttf",
  "Liberation Sans": "/static/fonts/LiberationSans.ttf",
};
