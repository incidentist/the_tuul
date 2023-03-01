import { adjustScreenTimestamps, LyricSegment, LyricsScreen, Timestamp } from "./timing";

const FIRST_SCREEN_QUICK_START_THRESHOLD: Timestamp = 1.0
const COUNT_IN_THRESHOLD: Timestamp = 5.0
const COUNT_IN_DURATION: Timestamp = 2.0

const COUNT_IN_SEGMENT_TEXT = "●●● "

export function addQuickStartCountIn(screens: LyricsScreen[]): LyricsScreen[] {
    const firstSegment = screens[0].lines[0].segments[0];
    if (firstSegment.timestamp > FIRST_SCREEN_QUICK_START_THRESHOLD) {
        return screens;
    }
    /*
    This is the first screen and the lyrics start right away.
    Add a count-in and adjust all other timings accordingly
    */

    // This is how much time we need to add to the beginning:
    const addedTime: Timestamp = COUNT_IN_DURATION - firstSegment.timestamp;
    // Move every timestamp forward by that much
    const adjustedScreens = adjustScreenTimestamps(screens, addedTime)
    // Reset the first screen start time to the non-adjusted value
    adjustedScreens[0].startTimestamp = screens[0].startTimestamp;
    // Delay the audio on the first screen by the amount we moved forward.
    adjustedScreens[0].audioDelay += addedTime;
    // Add the count-in segment to the beginning
    const newFirstSegment = adjustedScreens[0].lines[0].segments[0];
    const countInSegment = new LyricSegment(COUNT_IN_SEGMENT_TEXT, 0.0, newFirstSegment.timestamp);
    adjustedScreens[0].lines[0].addSegmentToFront(countInSegment);

    return adjustedScreens;
}

export function addScreenCountIns(screens: LyricsScreen[]): LyricsScreen[] {
    // Add a count-in to the start of a screen if there's awhile before the
    // singing starts

    let prevScreenEnd: Timestamp = 0.0
    screens.forEach((screen, index) => {
        const firstSegment = screen.lines[0].segments[0];
        if (firstSegment.timestamp - prevScreenEnd > COUNT_IN_THRESHOLD) {
            const countInSegment = new LyricSegment(COUNT_IN_SEGMENT_TEXT, firstSegment.timestamp - COUNT_IN_DURATION, firstSegment.timestamp);
            screen.lines[0].addSegmentToFront(countInSegment);
        }
        prevScreenEnd = screen.endTimestamp;
    });
    return screens;
}