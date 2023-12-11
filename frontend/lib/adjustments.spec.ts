import { addTitleScreen, addInstrumentalScreens } from "./adjustments";
import { compileLyricTimings, createAssFile, denormalizeTimestamps, LyricEvent, LyricSegment, LyricsLine, LyricsScreen, KaraokeOptions } from "./timing";
import { testLyrics, shortIntroTestEvents } from "./timing.spec";
import { LYRIC_MARKERS } from "../constants";

const DEFAULT_ASS_OPTIONS = {
    "Fontsize": 20,
    "Fontname": "Arial Narrow"
}

test('addTitleScreenToShortIntroSong', () => {
    const titleScreenAss = `Dialogue: 0,Default,0:00:00.00,0:00:04.00,130,{\\k0}{\\kf200}Tüülin' Around
Dialogue: 0,Default,0:00:00.00,0:00:04.00,160,{\\k200}{\\kf200}The Tüüls
`
    const screens = denormalizeTimestamps(compileLyricTimings(testLyrics, shortIntroTestEvents), 60.0);
    const screensWithTitle = addTitleScreen(screens, "Tüülin' Around", "The Tüüls");
    expect(screensWithTitle.length).toBe(3);
    expect(screensWithTitle[0].toAssEvents(DEFAULT_ASS_OPTIONS)).toBe(titleScreenAss);
    expect(screensWithTitle[0].audioDelay).toBe(4);
});

test('addInstrumentalScreen', () => {
    const lyrics = "screen one\n\nscreen two"
    const timings: LyricEvent[] = [
        [1.0, LYRIC_MARKERS.SEGMENT_START],
        [2.0, LYRIC_MARKERS.SEGMENT_END],
        [20.0, LYRIC_MARKERS.SEGMENT_START],
        [21.0, LYRIC_MARKERS.SEGMENT_END]
    ]
    let screens = compileLyricTimings(lyrics, timings);

    screens = denormalizeTimestamps(addInstrumentalScreens(screens), 60.0);
    expect(screens.length).toBe(3)

    const ass = `Dialogue: 0,Default,0:00:00.00,0:00:02.00,145,{\\k100}{\\kf100}screen one


Dialogue: 0,Default,0:00:02.00,0:00:20.00,145,{\\k0}{\\kf1800}||||||||||||||||||||||||||||||||||
Dialogue: 0,Default,0:00:20.00,0:00:21.00,145,{\\k0}{\\kf100}screen two
`
    expect(screens.map((s) => s.toAssEvents(DEFAULT_ASS_OPTIONS)).join("")).toBe(ass);
    const instrumentalScreen: LyricsScreen = screens[1];
    expect(instrumentalScreen.startTimestamp).toBeTruthy();

});

test('addInstrumentalScreenFor3ScreenSong', () => {
    const lyrics = "screen one\n\nscreen two\n\nscreen three"
    const timings: LyricEvent[] = [
        [1.0, LYRIC_MARKERS.SEGMENT_START],
        [2.0, LYRIC_MARKERS.SEGMENT_END],
        [20.0, LYRIC_MARKERS.SEGMENT_START],
        [21.0, LYRIC_MARKERS.SEGMENT_END],
        [30.0, LYRIC_MARKERS.SEGMENT_START],
        [31.0, LYRIC_MARKERS.SEGMENT_END],
    ]
    let screens = compileLyricTimings(lyrics, timings)
        ;
    screens = denormalizeTimestamps(addInstrumentalScreens(screens), 60.0);
    expect(screens.length).toBe(5)

    const ass = `Dialogue: 0,Default,0:00:00.00,0:00:02.00,145,{\\k100}{\\kf100}screen one


Dialogue: 0,Default,0:00:02.00,0:00:20.00,145,{\\k0}{\\kf1800}||||||||||||||||||||||||||||||||||
Dialogue: 0,Default,0:00:20.00,0:00:21.00,145,{\\k0}{\\kf100}screen two


Dialogue: 0,Default,0:00:21.00,0:00:30.00,145,{\\k0}{\\kf900}||||||||||||||||||||||||||||||||||
Dialogue: 0,Default,0:00:30.00,0:00:31.00,145,{\\k0}{\\kf100}screen three
`
    expect(screens.map((s) => s.toAssEvents(DEFAULT_ASS_OPTIONS)).join("")).toBe(ass);

});