import { LYRIC_MARKERS, VIDEO_SIZE, LINE_HEIGHT, TITLE_SCREEN_DURATION } from "../constants";
import * as _ from "lodash";
import { isNumber } from "lodash";

interface Segment {
  text: string;
}

interface AssEvent {
  type: string,
  Layer: number,
  Style: string,
  Start: string,
  End: string,
  MarginV: number,
  Text: string
}

//
// ASS Formatting helpers
//

type Color = [number, number, number, number] // RGBA?

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

  [Symbol.iterator]() {
    let index = 0;
    return {
      next: () => {
        if (index < this.segments.length) {
          return { value: this.segments[index++], done: false };
        } else {
          return { done: true };
        }
      }
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

  get segments(): LyricSegment[] {
    return this.lines.flatMap(l => l.segments);
  }

  getLineY(lineInScreen: number): number {
    const screenMiddle = VIDEO_SIZE.height / 2;
    const lineCount = this.lines.length;
    return screenMiddle - (lineCount * LINE_HEIGHT / 2) + (lineInScreen * LINE_HEIGHT)
  }

  toAssEvents(formatParams: Object) {
    const styleName = "Default";
    const self = this;
    return this.lines.map((l, i) => l.toAssEvent(self.startTimestamp, self.endTimestamp, styleName, self.getLineY(i))).join("\n") + "\n";
  }

  adjustTimestamps(adjustment: number): LyricsScreen {
    const lines = _.map(this.lines, _.method('adjustTimestamps', adjustment));
    const screen = new LyricsScreen(lines);
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
      throw Error(`Cannot adjust screen display start by ${adjustment}s because its first line animates at ${this.lines[0].timestamp}`);
    }
    const trimmedScreen = new LyricsScreen(this.lines, this.audioDelay);
    trimmedScreen.startTimestamp = newStartTime;
    return trimmedScreen;
  }
}

class LyricsLine {
  segments: LyricSegment[];

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

  decorateAssLine(segments: LyricSegment[], screenStartTimestamp: Timestamp): string {
    // Decorate the line with karaoke tags
    // An ASS line starts with {k<digits>} which is centiseconds within the current
    // screen to start animating.
    // That is followed by {\kf<digits>} which is how long to animate the text
    // following the tag.
    const startTime = Math.floor((this.timestamp - screenStartTimestamp) * 100);
    if (startTime < 0) {
      throw Error(`Negative line startTime: ${self}: ${startTime}`);
    }
    let line = `{\\k${startTime}}`;
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
    return line;
  }

  toAssEvent(screenStart: Timestamp, screenEnd: Timestamp, style: string, topMargin: number): string {
    if (isNaN(this.timestamp) || isNaN(screenStart) || isNaN(screenEnd)) {
      throw Error("NaN value for timestamp");
    }
    const e: AssEvent = {
      type: "Dialogue",
      Layer: 0,
      Style: style,
      Start: floatToTimecode(screenStart),
      End: floatToTimecode(screenEnd),
      MarginV: topMargin,
      Text: this.decorateAssLine(this.segments, screenStart)
    }
    return `${e.type}: ` + ["Layer", "Style", "Start", "End", "MarginV", "Text"].map(k => e[k]).join(",");
  }

  adjustTimestamps(adjustment: number): LyricsLine {
    const segments = _.map(this.segments, _.method('adjustTimestamps', adjustment))
    return new LyricsLine(segments);
  }

}

type LyricEvent = [number, number]
type Timestamp = number

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

function getIntroLength(screens: LyricsScreen[]): number {
  // Get the length of the song intro
  return screens[0].lines[0].timestamp;
}

function trimStart(screens: LyricsScreen[], adjustment: number): LyricsScreen[] {
  // Trim [adjustment] seconds from the start of the first screen, keeping other timestamps the same.
  let otherScreens = screens.slice(1);
  const trimmedScreen = screens[0].trimDisplayStart(adjustment);
  return _.concat([trimmedScreen], otherScreens);
}

export function adjustScreenTimestamps(screens: LyricsScreen[], adjustment: number): LyricsScreen[] {
  // Adjust all timings in [screens] forward by [adjustment] seconds.
  return _.map(screens, _.method('adjustTimestamps', adjustment));
}

export function denormalizeTimestamps(screens: LyricsScreen[], songDuration: number): LyricsScreen[] {
  // Explicitly set various timestamps
  return setScreenStartTimes(setSegmentEndTimes(screens, songDuration));
}

export function addTitleScreen(screens: LyricsScreen[], title: string, artist: string): LyricsScreen[] {
  const introLength = getIntroLength(screens);
  // If the vocals start right at the beginning of the song, don't start the audio until the title screen is over.
  const audioDelay = introLength < TITLE_SCREEN_DURATION ? TITLE_SCREEN_DURATION : 0.0;
  let adjustedLyricScreens;
  if (introLength > TITLE_SCREEN_DURATION + 1) {
    // Long intro, start audio during title screen
    adjustedLyricScreens = trimStart(screens, TITLE_SCREEN_DURATION);
  } else {
    // Short intro, delay audio until after title screen
    adjustedLyricScreens = adjustScreenTimestamps(screens, TITLE_SCREEN_DURATION);
  }
  const titleScreen = new LyricsScreen(
    [
      new LyricsLine([new LyricSegment(title, 0.0, TITLE_SCREEN_DURATION / 2)]),
      new LyricsLine([new LyricSegment(artist, TITLE_SCREEN_DURATION / 2, TITLE_SCREEN_DURATION)])
    ],
    audioDelay
  );
  const denormalizedScreen = denormalizeTimestamps([titleScreen], TITLE_SCREEN_DURATION)[0];
  const screensWithTitle = adjustedLyricScreens.slice()
  screensWithTitle.unshift(denormalizedScreen);
  return screensWithTitle;
}

function createSubtitles(screens: LyricsScreen[], formatParams: Object): string {

  const displayParams = {
    Name: "Default",
    Alignment: 8,
    Fontname: "Arial Narrow",
    Fontsize: 20,
    PrimaryColour: [255, 0, 255, 255],
    SecondaryColour: [0, 255, 255, 255],
    Bold: -1,
    ScaleX: 100,
    ScaleY: 100,
    Spacing: 0,
    MarginL: 0,
    MarginR: 0,
    Encoding: 0,
    ...formatParams
  };

  for (const key of ["PrimaryColour", "SecondaryColour"]) {
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
Format: Layer, Style, Start, End, MarginV, Text
`
  for (const screen of screens) {
    assText += screen.toAssEvents(displayParams)
  }
  return assText;
}

export function createScreens(lyrics: string, lyricEvents: LyricEvent[], songDuration: number, title: string, artist: string): LyricsScreen[] {
  const initialScreens = compileLyricTimings(lyrics, lyricEvents);
  const screensWithStartTimes = denormalizeTimestamps(initialScreens, songDuration);
  return addTitleScreen(screensWithStartTimes, title, artist);
}

export function createAssFile(lyrics: string, lyricEvents: LyricEvent[], songDuration: number, title: string, artist: string) {
  const screensWithTitle = createScreens(lyrics, lyricEvents, songDuration, title, artist);

  return createSubtitles(screensWithTitle, {
    "Fontname": "Arial Narrow",
    "Fontsize": 20,
    "PrimaryColour": [255, 0, 255, 0],
    "SecondaryColour": [0, 255, 255, 0]
  });
}