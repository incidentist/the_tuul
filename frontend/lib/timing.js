
export class LyricSegmentIterator {
    constructor(lyrics) {
        this.segments = this.parseLyrics(lyrics);
    }

    parseLyrics(lyricsText) {
        // Parse marked up lyrics into segments.
        // Line breaks separate segments.
        // Double line breaks separate screens.
        // Underscores separate segments on word boundaries between a line.
        // Sla/shes separate segments within a word.
        const segments = [];
        let currentSegment = "";
        for (let i = 0; i < lyricsText.length; i++) {
          let finishSegment = false;
          const char = lyricsText[i];
          if (["\n", "/", "_"].includes(char) || i == lyricsText.length - 1) {
            finishSegment = true;
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

// module.exports.LyricSegmentIterator = LyricSegmentIterator

// function compileLyricTimings(lyrics, events) {
//     // Read keyboard events in the order they were pressed and construct
//     // objects for screens and lines that include the given timing information.
//     const segments = LyricSegmentIterator(lyrics);


//     segments = iter(timing_data.LyricSegmentIterator(lyrics_txt=lyrics))
//     events = iter(events)
//     screens: List[LyricsScreen] = []
//     prev_segment: Optional[LyricSegment] = None
//     line: Optional[LyricsLine] = None
//     screen: Optional[LyricsScreen] = None

//     try:
//         for event in events:
//             ts = event[0]
//             marker = event[1]
//             if marker == timing_data.LyricMarker.SEGMENT_START:
//                 segment_text: str = next(segments)
//                 segment = LyricSegment(segment_text, ts)
//                 if screen is None:
//                     screen = LyricsScreen()
//                 if line is None:
//                     line = LyricsLine()
//                 line.segments.append(segment)
//                 if segment_text.endswith("\n"):
//                     screen.lines.append(line)
//                     line = None
//                 if segment_text.endswith("\n\n"):
//                     screens.append(screen)
//                     screen = None
//                 prev_segment = segment
//             elif marker == timing_data.LyricMarker.SEGMENT_END:
//                 if prev_segment is not None:
//                     prev_segment.end_ts = ts
//         if line is not None:
//             screen.lines.append(line)  # type: ignore[union-attr]
//         if screen is not None and len(screen.lines) > 0:
//             screens.append(screen)  # type: ignore[arg-type]
//     except StopIteration as si:
//         logging.error(
//             f"Reached end of segments before end of events. Events: {list(events)}, lyrics: {list(segments)}"
//         )
//     return screens
// }