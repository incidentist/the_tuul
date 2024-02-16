import { LYRIC_MARKERS, VIDEO_SIZE, TITLE_SCREEN_DURATION } from "../constants";
import { addQuickStartCountIn, addScreenCountIns, addTitleScreen, addInstrumentalScreens, displayQuickLinesEarly } from "./adjustments";
import * as _ from "lodash";
import { isNumber } from "lodash";
import { Color as BuefyColor } from "buefy/src/utils/color";


export interface KaraokeOptions {
  addCountIns: boolean,
  addInstrumentalScreens: boolean,
  addStaggeredLines: boolean,
  useBackgroundVideo: boolean,
  verticalAlignment: VerticalAlignment,
  font: {
    size: number,
    name: string
  }
  color: {
    background: BuefyColor,
    primary: BuefyColor,
    secondary: BuefyColor
  }
}

export enum VerticalAlignment {
  Top, Middle, Bottom
}

interface Segment {
  text: string;
}

interface AssEvent {
  type: string,
  Layer: number,
  Start: string,
  End: string,
  Style: string,
  Name: string,
  MarginL: number,
  MarginR: number,
  MarginV: number,
  Effect: string,
  Text: string
}

//
// ASS Formatting helpers
//

type Color = [number, number, number, number] // RGBA?
type Seconds = number;

function toHex(n: number) { return n.toString(16).toUpperCase().padStart(2, "0") }

function colorToString(color: Color): string {
  // ASS color format is AABBGGRR for some reason, and alpha 0 is opaque
  return "&H" + color.map(toHex).reverse().join("");
}

export function floatToTimecode(t: number): string {
  // Format t (seconds) as HH:MM:SS.ms
  const timecodeParts = [
    Math.floor(t / 3600).toString(),
    Math.floor(t / 60 % 60).toString().padStart(2, "0"),
    [
      Math.floor(t % 60).toString().padStart(2, "0"),
      (t - Math.floor(t)).toFixed(2).slice(2, 4)
    ].join(".")
  ];
  return timecodeParts.join(":")
}

//
// Lyric classes
//

export class LyricSegmentIterator {
  segments: Segment[];
  includeMarkup: boolean;
  constructor(lyrics: string, includeMarkup: boolean = false) {
    this.includeMarkup = includeMarkup;
    this.segments = this.parseLyrics(lyrics);
  }

  parseLyrics(lyricsText: string): Segment[] {
    // Parse marked up lyrics into segments.
    // Line breaks separate segments.
    // Double line breaks separate screens.
    // Underscores separate segments on word boundaries between a line.
    // Sla/shes separate segments within a word.
    const segments = [];
    let currentSegment = "";
    for (let i = 0; i < lyricsText.length; i++) {
      let finishSegment = false;
      let char = lyricsText[i];
      if (["\n", "/", "_"].includes(char) || i == lyricsText.length - 1) {
        finishSegment = true;
        if (!this.includeMarkup) {
          if (char == "/") {
            char = "";
          } else if (char == "_") {
            char = " "
          }
        }
      }
      if (char == "\n" && currentSegment == "") {
        segments[segments.length - 1].text += char;
        continue;
      }
      currentSegment += char;
      if (finishSegment) {
        segments.push({
          text: currentSegment,
        });
        currentSegment = "";
      }
    }
    return segments;
  }

  *[Symbol.iterator](): IterableIterator<Segment> {
    for (let s of this.segments) {
      yield s;
    }
  }
}

export class LyricSegment {
  text: string;
  timestamp: number;
  endTimestamp?: number;

  constructor(text: string, timestamp: number, endTimestamp: number = null) {
    this.text = text;
    this.timestamp = timestamp;
    this.endTimestamp = endTimestamp;
  }

  adjustTimestamps(adjustment: number): LyricSegment {
    const newTs = this.timestamp + adjustment;
    const newEndTs = this.endTimestamp === null ? null : this.endTimestamp + adjustment;
    return new LyricSegment(this.text, newTs, newEndTs);
  }

  toAss() {
    // Render this segment as part of an ASS event line
    const durationInCentiseconds = Math.floor((this.endTimestamp - this.timestamp) * 100);
    return `{\\kf${durationInCentiseconds}}${this.text}`
  }
}

export class LyricsScreen {
  lines: LyricsLine[];
  startTimestamp?: Timestamp;
  // Seconds to delay the start of the audio. Only valid on the title screen and first lyrics screen.
  audioDelay: number = 0.0;
  // For staggered timings, we might need to adjust the top margin of the first line
  customFirstLineTopMargin?: number = null;

  constructor(lines: LyricsLine[] = [], audioDelay = 0.0) {
    this.lines = lines;
    this.audioDelay = audioDelay;
  }

  get endTimestamp(): Timestamp {
    if (this.lines.length == 0) {
      return this.startTimestamp;
    }
    return this.lines[this.lines.length - 1].endTimestamp;
  }

  get singStart(): Timestamp {
    return this.lines[0].timestamp;
  }

  get singEnd(): Timestamp {
    return this.lines[this.lines.length - 1].endTimestamp;
  }

  get segments(): LyricSegment[] {
    return this.lines.flatMap(l => l.segments);
  }

  getLineY(lineInScreen: number, fontSize: number, alignment: VerticalAlignment = VerticalAlignment.Middle): number {
    // Get the Y coordinate of the top of the given line in the screen
    // Pad screen with 1 line height
    const lineCount = this.lines.length;
    const lineHeight = fontSize * 1.5;
    let firstLineTopMargin = this.customFirstLineTopMargin;
    if (firstLineTopMargin === null) {
      switch (alignment) {
        case VerticalAlignment.Top:
          firstLineTopMargin = lineHeight;
          break;
        case VerticalAlignment.Middle:
          const screenMiddle = VIDEO_SIZE.height / 2;
          firstLineTopMargin = screenMiddle - (lineCount * lineHeight / 2)
          break;
        case VerticalAlignment.Bottom:
          firstLineTopMargin = VIDEO_SIZE.height - ((lineCount + 1) * lineHeight);
          break;
      }
    }
    return Math.round(firstLineTopMargin + (lineInScreen * lineHeight))
  }

  toAssEvents(formatParams: Object, videoOptions: KaraokeOptions) {
    const styleName = "Default";
    const self = this;
    return this.lines.map((l, i) => l.toAssEvent(self.startTimestamp, self.endTimestamp, styleName, self.getLineY(i, formatParams["Fontsize"], videoOptions.verticalAlignment))).join("\n") + "\n";
  }

  adjustTimestamps(adjustment: number): LyricsScreen {
    const lines = _.map(this.lines, _.method('adjustTimestamps', adjustment));
    const screen = new LyricsScreen(lines, this.audioDelay);
    screen.startTimestamp = this.startTimestamp;
    if (isNumber(screen.startTimestamp)) {
      screen.startTimestamp = this.startTimestamp + adjustment;
    }
    // else {
    //   screen.startTimestamp = adjustment;
    // }
    return screen;
  }

  trimDisplayStart(adjustment: number): LyricsScreen {
    // Adjust the start of this screen's display by [adjustment]
    const newStartTime = this.startTimestamp ? this.startTimestamp + adjustment : adjustment;
    if (newStartTime > this.lines[0].timestamp) {
      throw Error(`Cannot adjust screen display start by ${adjustment}s: display start is ${this.startTimestamp}, first line animates at ${this.lines[0].timestamp}`);
    }
    const trimmedScreen = new LyricsScreen(this.lines, this.audioDelay);
    trimmedScreen.startTimestamp = newStartTime;
    return trimmedScreen;
  }
}

export class LyricsLine {

  segments: LyricSegment[];

  // Times to start/end display of the line, as opposed to animation.
  // If none, screen start/end times will be used.
  customDisplayStartTime?: Timestamp = null;
  customDisplayEndTime?: Timestamp = null;
  fadeInDuration: Seconds = 0.0;
  fadeOutDuration: Seconds = 0.0;

  constructor(segments: LyricSegment[] = []) {
    this.segments = segments;
  }

  get timestamp(): Timestamp {
    if (this.segments.length == 0) {
      return 0.0;
    }
    return this.segments[0].timestamp;
  }

  set timestamp(ts: Timestamp) {
    this.segments[0].timestamp = ts;
  }

  get endTimestamp(): Timestamp {
    if (this.segments.length == 0) {
      return this.timestamp;
    }
    return this.segments[this.segments.length - 1].endTimestamp;
  }

  addSegmentToFront(newSegment: LyricSegment) {
    this.segments.unshift(newSegment);
  }

  decorateAssLine(segments: LyricSegment[], displayStartTime: Timestamp): string {
    // Decorate the line with karaoke tags
    // An ASS line starts with {k<digits>} which is centiseconds within the current
    // line to start animating.
    // That is followed by {\kf<digits>} which is how long to animate the text
    // following the tag.

    // Delay between line display and start of line animation
    let singStartDelay = Math.floor((this.timestamp - displayStartTime) * 100);
    if (singStartDelay < 0) {
      console.error(`Negative line startTime: ${this}: ${singStartDelay}`);
      singStartDelay = 0;
    }
    let line = `{\\k${singStartDelay}}`;
    let previousEnd = null;
    for (const s of segments) {
      if (previousEnd !== null && previousEnd < s.timestamp) {
        // Insert a blank segment to represent a gap between segments
        const blankSegment = new LyricSegment("", previousEnd, s.timestamp)
        line += blankSegment.toAss()
      }
      line += s.toAss()
      previousEnd = s.endTimestamp;
    }
    return this.addAssFades(line);
  }

  toAssEvent(screenStart: Timestamp, screenEnd: Timestamp, style: string, topMargin: number): string {
    if (isNaN(this.timestamp) || isNaN(screenStart) || isNaN(screenEnd)) {
      console.error("NaN value for line", this, screenStart, screenEnd);
      throw Error("NaN value for timestamp");
    }
    const displayStart = this.customDisplayStartTime || screenStart;
    const displayEnd = this.customDisplayEndTime || screenEnd;
    const e: AssEvent = {
      type: "Dialogue",
      Layer: 0,
      Start: floatToTimecode(displayStart),
      End: floatToTimecode(displayEnd),
      Style: style,
      Name: "Singer",
      MarginL: 0,
      MarginR: 0,
      MarginV: topMargin,
      Effect: "",
      Text: this.decorateAssLine(this.segments, displayStart)
    }
    return `${e.type}: ` + ["Layer", "Start", "End", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text"].map(k => e[k]).join(",");
  }

  addAssFades(assLine: string): string {
    if (this.fadeInDuration == 0 && this.fadeOutDuration == 0) {
      return assLine;
    }
    return `{\\fad(${Math.floor(this.fadeInDuration * 1000)},${Math.floor(this.fadeOutDuration * 1000)})}` + assLine
  }

  adjustTimestamps(adjustment: number): LyricsLine {
    const segments = _.map(this.segments, _.method('adjustTimestamps', adjustment))
    return new LyricsLine(segments);
  }

}

export type LyricEvent = [number, number]
export type Timestamp = number

export function compileLyricTimings(lyrics: string, events: LyricEvent[]) {
  // Read keyboard events in the order they were pressed and construct
  // objects for screens and lines that include the given timing information.
  const segments = (new LyricSegmentIterator(lyrics))[Symbol.iterator]();
  const screens = [];
  let previousSegment = null;
  let line = null;
  let screen = null;

  try {
    for (const e of events) {
      const timestamp = e[0];
      const marker = e[1];
      if (marker == LYRIC_MARKERS.SEGMENT_START) {
        const segmentText = segments.next().value.text;
        const segment = new LyricSegment(segmentText, timestamp);
        if (!screen) {
          screen = new LyricsScreen();
        }
        if (!line) {
          line = new LyricsLine();
        }
        line.segments.push(segment);
        if (segmentText.endsWith("\n")) {
          screen.lines.push(line);
          line = null;
        }
        if (segmentText.endsWith("\n\n")) {
          screens.push(screen);
          screen = null;
        }
        previousSegment = segment;
      } else if (marker == LYRIC_MARKERS.SEGMENT_END) {
        if (previousSegment !== null) {
          previousSegment.endTimestamp = timestamp;
        }
      }
    }

    if (line !== null) {
      screen.lines.push(line);
    }
    if (screen !== null && screen.lines.length > 0) {
      screens.push(screen);
    }
  } catch (e) {
    console.error(e);
  }
  return screens;
}

export function setSegmentEndTimes(screens: LyricsScreen[], songDuration: number): LyricsScreen[] {
  // Infer end times of segments if they are not already set
  const segments: LyricSegment[] = screens.flatMap(s => s.lines.flatMap(l => l.segments));
  segments.forEach((segment, i) => {
    if (!segment.endTimestamp) {
      if (i == segments.length - 1) {
        segment.endTimestamp = songDuration;
      } else {
        segment.endTimestamp = segments[i + 1].timestamp;
      }
    }
  });
  return screens;
}

export function setScreenStartTimes(screens: LyricsScreen[]): LyricsScreen[] {
  // Set start times for screens to the end times of the previous screen
  let prevScreen = null;
  for (const screen of screens) {
    if (!prevScreen) {
      screen.startTimestamp = 0.0;
    } else {
      screen.startTimestamp = prevScreen.endTimestamp;
    }
    prevScreen = screen;
  }
  return screens;
}

export function adjustScreenTimestamps(screens: LyricsScreen[], adjustment: number): LyricsScreen[] {
  // Adjust all timings in [screens] forward by [adjustment] seconds.
  return _.map(screens, _.method('adjustTimestamps', adjustment));
}

export function denormalizeTimestamps(screens: LyricsScreen[], songDuration: number): LyricsScreen[] {
  // Explicitly set various timestamps
  return setScreenStartTimes(setSegmentEndTimes(screens, songDuration));
}

function createSubtitles(screens: LyricsScreen[], options: KaraokeOptions, formatParams: Object): string {

  const displayParams = {
    Name: "Default",
    Fontname: "Arial Narrow",
    Fontsize: 20,
    PrimaryColour: [255, 0, 255, 255],
    SecondaryColour: [0, 255, 255, 255],
    OutlineColour: [0, 0, 0, 255],
    BackColour: [0, 0, 0, 0],
    Bold: -1,
    Italic: 0,
    Underline: 0,
    StrikeOut: 0,
    ScaleX: 100,
    ScaleY: 100,
    Spacing: 0,
    Angle: 0,
    BorderStyle: 1,
    Outline: 0,
    Shadow: 0,
    Alignment: 8,
    MarginL: 0,
    MarginR: 0,
    MarginV: 0,
    Encoding: 0,
    ...formatParams
  };

  for (const key of ["PrimaryColour", "SecondaryColour", "OutlineColour", "BackColour"]) {
    displayParams[key] = colorToString(displayParams[key]);
  }

  const styleKeys = Object.keys(displayParams).join(", ");
  const styleValues = Object.values(displayParams).join(",");

  let assText = `[Script Info]
; Script generated by The Tüül - https://the-tuul.com

[V4+ Styles]
Format: ${styleKeys}
Style: ${styleValues}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  for (const screen of screens) {
    assText += screen.toAssEvents(displayParams, options)
  }
  return assText;
}

export function createScreens(lyrics: string, lyricEvents: LyricEvent[], songDuration: number, title: string, artist: string, options: KaraokeOptions): LyricsScreen[] {
  let screens = compileLyricTimings(lyrics, lyricEvents);
  screens = denormalizeTimestamps(screens, songDuration);
  if (options.addCountIns) {
    screens = addQuickStartCountIn(screens);
    screens = addScreenCountIns(screens);
  }
  screens = addTitleScreen(screens, title, artist);
  if (options.addStaggeredLines) {
    screens = displayQuickLinesEarly(screens, options);
  }
  if (options.addInstrumentalScreens) {
    screens = addInstrumentalScreens(screens);
  }
  return screens
}

export function createAssFile(lyrics: string, lyricEvents: LyricEvent[], songDuration: number, title: string, artist: string, options: KaraokeOptions) {
  // Entry point to subtitles. Creates an .ass file from the given info.
  const screensWithTitle = createScreens(lyrics, lyricEvents, songDuration, title, artist, options);
  const primaryColor = options.color.primary;
  const secondaryColor = options.color.secondary;
  const outlineColor = options.color.background;

  return createSubtitles(screensWithTitle, options, {
    "Fontname": options.font.name,
    "Fontsize": options.font.size,
    "PrimaryColour": [primaryColor.red, primaryColor.green, primaryColor.blue, 0],
    "SecondaryColour": [secondaryColor.red, secondaryColor.green, secondaryColor.blue, 0],
    "OutlineColour": [outlineColor.red, outlineColor.green, outlineColor.blue, 0],
    "BorderStyle": 1,
    "Outline": 1,
    "Shadow": 0,
  });
}