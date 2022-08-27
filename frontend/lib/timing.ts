import { LYRIC_MARKERS, VIDEO_SIZE, LINE_HEIGHT } from "../constants";
import _ from "lodash";

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

function toHex(n: number) { return n.toString(16).toUpperCase().padStart(2, "0")}

function colorToString(color: Color): string {
    return "&H" + color.map(toHex).join("");
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

  adjustTimestamp(adjustment) {
    const newTs = this.timestamp + adjustment;
    const newEndTs = this.endTimestamp === null ? null : this.endTimestamp + adjustment;
    return new LyricSegment(this.text, newTs, newEndTs); 
  }

  toAss() {
    // Render this segment as part of an ASS event line
    const durationInCentiseconds = Math.floor(this.endTimestamp - this.timestamp) * 100;
    return `{\\kf${durationInCentiseconds}}${this.text}`
  }
}

export class LyricsScreen {
    lines: LyricsLine[];
    startTimestamp?: Timestamp;
  constructor() {
    this.lines = [];
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
}

class LyricsLine {
    segments: LyricSegment[];

  constructor() {
    this.segments = [];
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
    const startTime = (this.timestamp - screenStartTimestamp) * 100;
    let line = `{\\k${startTime}}`;
    let previousEnd = null;
    for (const s of segments) {
        if (previousEnd  !== null && previousEnd < s.timestamp) {
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
            screen.startTimestamp = prevScreen.endTimestamp + 0.1;
        }
        prevScreen = screen;
    }
    return screens;
}

function createSubtitles(screens: LyricsScreen[], formatParams: Object): string {
    
    const displayParams = {
        Name: "Default",
        Alignment: 8,
        Fontname: "Arial Narrow",
        Fontsize: 20,
        PrimaryColor: [255, 0, 255, 255],
        SecondaryColor: [0, 255, 255, 255],
        Bold: -1,
        ScaleX: 100,
        ScaleY: 100,
        Spacing: 0,
        MarginL: 0,
        MarginR: 0,
        Encoding: 0,
        ...formatParams
    };
    
    for (const key of ["PrimaryColor", "SecondaryColor"]) {
        displayParams[key] = colorToString(displayParams[key]);
    }
    
    const styleKeys = Object.keys(displayParams).join(", ");
    const styleValues = Object.values(displayParams).join(",");
    
    let assText = `
[Script Info]
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

export function createAssFile(lyrics: string, lyricEvents: LyricEvent[], songDuration: number) {
  const initialScreens = compileLyricTimings(lyrics, lyricEvents);

  const screensWithEndTimes = setSegmentEndTimes(initialScreens, songDuration);

  const screensWithStartTimes = setScreenStartTimes(screensWithEndTimes);

  return createSubtitles(screensWithStartTimes, {
    "Fontname": "Arial Narrow",
    "Fontsize": 20,
    "PrimaryColor": [255, 0, 255, 255],
    "SecondaryColor": [0, 255, 255, 255]
  });
}