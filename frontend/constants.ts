// See webpack.common.js for process.env setup
export const API_HOSTNAME = process.env.API_HOSTNAME;
// export const API_HOSTNAME = import.meta.env.API_HOSTNAME
export const DONATE_URL = process.env.DONATE_URL;

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