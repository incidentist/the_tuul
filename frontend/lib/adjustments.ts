import { adjustScreenTimestamps, LyricSegment, LyricsScreen, LyricsLine, Timestamp, denormalizeTimestamps } from "./timing";
import { LYRIC_MARKERS, VIDEO_SIZE, LINE_HEIGHT, TITLE_SCREEN_DURATION } from "../constants";
import * as _ from "lodash";

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

function getIntroLength(screens: LyricsScreen[]): number {
    // Get the length of the song intro
    return screens[0].lines[0].timestamp;
}

export function trimStart(screens: LyricsScreen[], adjustment: number): LyricsScreen[] {
    // Trim [adjustment] seconds from the start of the first screen, keeping other timestamps the same.
    let otherScreens = screens.slice(1);
    const trimmedScreen = screens[0].trimDisplayStart(adjustment);
    return _.concat([trimmedScreen], otherScreens);
}

export function addTitleScreen(screens: LyricsScreen[], title: string, artist: string): LyricsScreen[] {
    const introLength = getIntroLength(screens);
    // If the vocals start right at the beginning of the song, don't start the audio until the title screen is over.
    let audioDelay = 0.0;
    let adjustedLyricScreens;
    if (introLength > TITLE_SCREEN_DURATION + 1) {
        // Long intro, start audio during title screen
        adjustedLyricScreens = trimStart(screens, TITLE_SCREEN_DURATION);
    } else {
        // Short intro, delay audio until after title screen
        audioDelay = TITLE_SCREEN_DURATION;
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