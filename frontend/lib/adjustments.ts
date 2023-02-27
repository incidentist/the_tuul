import { LyricSegment, LyricsScreen, Timestamp } from "./timing";

const COUNT_IN_THRESHOLD: Timestamp = 5.0
const COUNT_IN_DURATION: Timestamp = 3.0

export function addScreenCountIns(screens: LyricsScreen[]): LyricsScreen[] {
    // Add a count-in segment to the start of a screen if there's a big gap
    let prevScreenEnd: Timestamp = 0.0
    screens.forEach(screen => {
        const firstSegment = screen.lines[0].segments[0];
        if (firstSegment.timestamp - prevScreenEnd > COUNT_IN_THRESHOLD) {
            const countInSegment = new LyricSegment("■■■■", firstSegment.timestamp - COUNT_IN_DURATION, firstSegment.timestamp);
            screen.lines[0].addSegmentToFront(countInSegment);
        }
        prevScreenEnd = screen.endTimestamp;
    });
    return screens;
}