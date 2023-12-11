import { adjustScreenTimestamps, LyricSegment, LyricsScreen, LyricsLine, Timestamp, denormalizeTimestamps, KaraokeOptions } from "./timing";
import { TITLE_SCREEN_DURATION as TITLE_SCREEN_DURATION, INSTRUMENTAL_SCREEN_THRESHOLD } from "../constants";
import * as _ from "lodash";

const FIRST_SCREEN_QUICK_START_THRESHOLD: Timestamp = 1.0
const SCREEN_QUICK_START_THRESHOLD: Timestamp = 2.0
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

function createInstrumentalScreen(startTime: Timestamp, duration: number): LyricsScreen {
    // Create an INSTRUMENTAL screen lasting [duration] seconds
    const line = new LyricsLine([new LyricSegment("||||||||||||||||||||||||||||||||||", startTime, startTime + duration)])
    const screen = new LyricsScreen([line]);
    screen.startTimestamp = startTime;
    return screen;
}

export function addInstrumentalScreens(screens: LyricsScreen[]): LyricsScreen[] {
    // Add instrumental countdown screens between screens with a long gap
    if (screens.length < 2) {
        return screens;
    }
    // We need to use actual segment times, not calculated screen start/end times
    const currentScreen = screens[1];
    const prevScreenEnd = screens[0].endTimestamp;
    const screenStart = currentScreen.segments[0].timestamp;
    const screenGap = screenStart - prevScreenEnd;
    if (screenGap < INSTRUMENTAL_SCREEN_THRESHOLD) {
        return [screens[0]].concat(addInstrumentalScreens(screens.slice(1)));
    } else {
        const instrumentalScreen = createInstrumentalScreen(screens[0].endTimestamp, screenGap);
        const adjustedScreens = trimStart(screens.slice(1), screenGap);
        return [screens[0], instrumentalScreen].concat(addInstrumentalScreens(adjustedScreens))
    }

}

export function addTitleScreen(screens: LyricsScreen[], title: string, artist: string): LyricsScreen[] {
    const introLength = getIntroLength(screens);
    // If the vocals start right at the beginning of the song, don't start the audio until the title screen is over.
    let audioDelay = 0.0;
    let adjustedLyricScreens;
    if (introLength > TITLE_SCREEN_DURATION) {
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

export function displayQuickLinesEarly(screens: LyricsScreen[], displayOptions: KaraokeOptions): LyricsScreen[] {
    // If the lyrics on the next screen start right away, display the first few lines early
    // Skip the title screen and the last screen.
    for (let i = 1; i < screens.length - 1; i++) {
        const screen = screens[i];
        const nextScreen = screens[i + 1];
        if (nextScreen.singStart - screen.singEnd > SCREEN_QUICK_START_THRESHOLD) {
            continue;
        }
        if (screen.lines.length < 2) {
            continue;
        }

        const earlyRemovalLines = screen.lines.slice(0, Math.min(2, screen.lines.length - 1));
        const lineAfterEarlyRemovals = screen.lines[earlyRemovalLines.length];
        // Remove earlyRemovalLines when the line after them is halfway done singing
        const earlyRemovalTime = lineAfterEarlyRemovals.timestamp
            + ((lineAfterEarlyRemovals.endTimestamp - lineAfterEarlyRemovals.timestamp) * .5)
        const earlyDisplayTime = lineAfterEarlyRemovals.timestamp
            + ((lineAfterEarlyRemovals.endTimestamp - lineAfterEarlyRemovals.timestamp) * .75)
        earlyRemovalLines.forEach(line => { line.customDisplayEndTime = earlyRemovalTime; });

        // TODO what if nextScreen.length == 2 and screen.length == 3?
        const earlyDisplayLines = nextScreen.lines.slice(0, earlyRemovalLines.length);
        // Adjust y positions so they don't overwrite remaining lines
        if (screen.getLineY(0, displayOptions.font.size) < nextScreen.getLineY(0, displayOptions.font.size)) {
            nextScreen.customFirstLineTopMargin = screen.getLineY(0, displayOptions.font.size);
        }

        earlyDisplayLines.forEach((line, i) => { line.customDisplayStartTime = earlyDisplayTime })
    }
    return screens;
}