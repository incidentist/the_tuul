import { LyricSegmentIterator, LyricsScreen, compileLyricTimings, setScreenStartTimes, adjustScreenTimestamps, setSegmentEndTimes, createAssFile, floatToTimecode, LyricsLine, KaraokeOptions, LyricEvent, VerticalAlignment } from "./timing";
import { LYRIC_MARKERS } from "../constants";
import { LyricSegment } from "./timing";

const DEFAULT_OPTIONS: KaraokeOptions = {
    addCountIns: true,
    addInstrumentalScreens: true,
    addStaggeredLines: true,
    useBackgroundVideo: false,
    verticalAlignment: VerticalAlignment.Middle,
    font: {
        size: 20,
        name: "Arial Narrow"
    },
    color: {
        background: { red: 255, green: 255, blue: 0 },
        primary: { red: 255, green: 0, blue: 255 },
        secondary: { red: 0, green: 255, blue: 255 }
    }
}

const DEFAULT_FONT_SIZE = 22;

export const testLyrics = "Be bop_a lu bop\nShe's my ba/by\n\nAnd_here's_screen_two"
const testEvents: LyricEvent[] = [
    [1.0, LYRIC_MARKERS.SEGMENT_START],
    [2.0, LYRIC_MARKERS.SEGMENT_END],
    [3.0, LYRIC_MARKERS.SEGMENT_START],
    [4.0, LYRIC_MARKERS.SEGMENT_START],
    [5.0, LYRIC_MARKERS.SEGMENT_START],
    [6.0, LYRIC_MARKERS.SEGMENT_START],
    [7.0, LYRIC_MARKERS.SEGMENT_START],
    [8.0, LYRIC_MARKERS.SEGMENT_START],
    [9.0, LYRIC_MARKERS.SEGMENT_START]
]

export const shortIntroTestEvents = testEvents;
const longIntroTestEvents: LyricEvent[] = [
    [6.0, LYRIC_MARKERS.SEGMENT_START],
    [7.0, LYRIC_MARKERS.SEGMENT_END],
    [8.0, LYRIC_MARKERS.SEGMENT_START],
    [9.0, LYRIC_MARKERS.SEGMENT_START],
    [10.0, LYRIC_MARKERS.SEGMENT_START],
    [11.0, LYRIC_MARKERS.SEGMENT_START],
    [12.0, LYRIC_MARKERS.SEGMENT_START],
    [13.0, LYRIC_MARKERS.SEGMENT_START],
    [14.0, LYRIC_MARKERS.SEGMENT_START]
]

const testAssPreamble = `[Script Info]
; Script generated by The Tüül - https://the-tuul.com

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Narrow,20,&H00FF00FF,&H00FFFF00,&HFF000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,2,8,0,0,0,0

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:04.00,Default,Singer,0,0,130,,{\\k0}{\\kf200}It's Cøøl to Tüül
Dialogue: 0,0:00:00.00,0:00:04.00,Default,Singer,0,0,160,,{\\k200}{\\kf200}TÜ/ÜL
`

const testAss = testAssPreamble + `Dialogue: 0,0:00:04.00,0:00:11.00,Default,Singer,0,0,130,,{\\k0}{\\kf200}●●● {\\kf100}Be bop {\\kf100}{\\kf100}a lu bop

Dialogue: 0,0:00:04.00,0:00:11.00,Default,Singer,0,0,160,,{\\k500}{\\kf100}She's my ba{\\kf100}by


Dialogue: 0,0:00:11.00,0:01:05.00,Default,Singer,0,0,145,,{\\k0}{\\kf100}And {\\kf100}here's {\\kf100}screen {\\kf5100}two
`

const longIntroTestAss = testAssPreamble + `Dialogue: 0,Default,0:00:04.00,0:00:15.00,130,{\\k300}{\\kf300}■■■■{\\kf100}Be bop {\\kf100}{\\kf100}a lu bop

Dialogue: 0,Default,0:00:04.00,0:00:15.00,130,{\\k900}{\\kf100}She's my ba{\\kf100}by


Dialogue: 0,0:00:11.00,0:01:05.00,Default,Singer,0,0,145,,{\\k0}{\\kf100}And {\\kf100}here's {\\kf100}screen {\\kf5100}two
`

test('LyricSegmentIterator', () => {
    let iterator = new LyricSegmentIterator(testLyrics);
    const segmentsWithoutMarkup = Array.from(iterator);
    expect(segmentsWithoutMarkup.length).toBe(8);
    expect(segmentsWithoutMarkup[0].text).toBe("Be bop ");

    iterator = new LyricSegmentIterator(testLyrics, true);
    const segmentsWithMarkup = Array.from(iterator);
    expect(segmentsWithMarkup.length).toBe(8);
    expect(segmentsWithMarkup[0].text).toBe("Be bop_");
});

test('compileLyricTimings', () => {
    const screens = compileLyricTimings(testLyrics, testEvents);
    expect(screens.length).toBe(2);
    expect(screens[0].lines.length).toBe(2);
    expect(screens[0].lines[0].segments.length).toBe(2);
    expect(screens[1].lines[0].segments.length).toBe(4);
});

test('setSegmentEndTimes', () => {
    const initialScreens = compileLyricTimings(testLyrics, testEvents);
    const songDuration = 60;
    const screens = setSegmentEndTimes(initialScreens, songDuration);
    expect(screens[0].lines[0].segments[0].endTimestamp).toBe(2.0);
    expect(screens[0].lines[0].segments[1].endTimestamp).toBe(4.0);
    expect(screens[0].lines[1].segments[0].endTimestamp).toBe(5.0);
    expect(screens[0].lines[1].segments[1].endTimestamp).toBe(6.0);
    expect(screens[1].lines[0].segments[0].endTimestamp).toBe(7.0);

})

test('LyricSegment', () => {
    const segment = new LyricSegment("boop", 2.0, 3.0);
    expect(segment.toAss()).toBe("{\\kf100}boop")

    const underSecondSegment = new LyricSegment("baby", .5, .75);
    expect(underSecondSegment.toAss()).toBe("{\\kf25}baby");
});

// test('LyricScreen does ass', () => {
//     const screen = new LyricsScreen();
//     screen.toAss
// });

test('LyricScreen handles custom Y offset', () => {
    const screen = new LyricsScreen([
        new LyricsLine([new LyricSegment("one", 1.0)]),
        new LyricsLine([new LyricSegment("two", 2.0)])
    ])

    expect(screen.getLineY(0, DEFAULT_FONT_SIZE)).toBe(127);

    screen.customFirstLineTopMargin = 50;
    expect(screen.getLineY(0, DEFAULT_FONT_SIZE)).toBe(50);
    expect(screen.getLineY(1, DEFAULT_FONT_SIZE)).toBe(83);
})

test('LyricScreen respects vertical alignment', () => {
    const screen = new LyricsScreen([
        new LyricsLine([new LyricSegment("one", 1.0)]),
        new LyricsLine([new LyricSegment("two", 2.0)])
    ])

    expect(screen.getLineY(0, DEFAULT_FONT_SIZE)).toBe(127);
    expect(screen.getLineY(0, DEFAULT_FONT_SIZE, VerticalAlignment.Top)).toBe(33);
    expect(screen.getLineY(0, DEFAULT_FONT_SIZE, VerticalAlignment.Bottom)).toBe(320 - (33 * 3));

    expect(screen.getLineY(1, DEFAULT_FONT_SIZE)).toBe(127 + 33);
    expect(screen.getLineY(1, DEFAULT_FONT_SIZE, VerticalAlignment.Top)).toBe(33 * 2);
    expect(screen.getLineY(1, DEFAULT_FONT_SIZE, VerticalAlignment.Bottom)).toBe(320 - (33 * 2));
});

test('setScreenStartTimes', () => {
    const screens = compileLyricTimings(testLyrics, testEvents);
    const adjusted = setScreenStartTimes(screens);
    expect(adjusted[0].startTimestamp).toBe(0.0);
});

test('adjustTimestamps', () => {
    const screens = setScreenStartTimes(compileLyricTimings(testLyrics, testEvents));

    const adjusted = adjustScreenTimestamps(screens, 1.0);
    expect(adjusted[0].lines[0].timestamp).toBe(2.0);
    expect(adjusted[0].startTimestamp).toBe(1.0)
});

test('createAssFileForShortIntroSong', () => {
    const songDuration = 60.0;
    const options: KaraokeOptions = { ...DEFAULT_OPTIONS, addInstrumentalScreens: false, addStaggeredLines: false }
    const assFile = createAssFile(testLyrics, shortIntroTestEvents, songDuration, "It's Cøøl to Tüül", "TÜ/ÜL", options);
    expect(assFile).toBe(testAss);
});

test('addCountIn', () => {
    const songDuration = 60.0;
    const lyrics = "That was a long intro\nToo bad nothing rhymes with intro"
    const timings: LyricEvent[] = [[100.0, LYRIC_MARKERS.SEGMENT_START], [105.0, LYRIC_MARKERS.SEGMENT_START]]
    const options: KaraokeOptions = { ...DEFAULT_OPTIONS, addInstrumentalScreens: false, addStaggeredLines: false }
    let assFile = createAssFile(lyrics, timings, songDuration, "It's Cøøl to Tüül", "TÜ/ÜL", options);

    const expected = testAssPreamble + `Dialogue: 0,0:00:04.00,0:01:00.00,Default,Singer,0,0,130,,{\\k9400}{\\kf200}●●● {\\kf500}That was a long intro

Dialogue: 0,0:00:04.00,0:01:00.00,Default,Singer,0,0,160,,{\\k10100}{\\kf-4500}Too bad nothing rhymes with intro
`
    expect(assFile).toBe(expected);
});

test('addCountInToSevenSecondIntro', () => {
    // An intro between 7-8 seconds has a count-in that makes the intro between 4-5 seconds.
    // So we can't start playing audio until after the title screen.
    // So timings get moved up a little bit/
    const songDuration = 60.0;

    // a corner case when the first event is between 7 and 8 seconds
    const sevenSecondEvents: LyricEvent[] = [
        [7.5, LYRIC_MARKERS.SEGMENT_START],
        [8.5, LYRIC_MARKERS.SEGMENT_END],
        [9.0, LYRIC_MARKERS.SEGMENT_START],
        [10.0, LYRIC_MARKERS.SEGMENT_START],
        [11.0, LYRIC_MARKERS.SEGMENT_START],
        [12.0, LYRIC_MARKERS.SEGMENT_START],
        [13.0, LYRIC_MARKERS.SEGMENT_START],
        [14.0, LYRIC_MARKERS.SEGMENT_START],
        [15.0, LYRIC_MARKERS.SEGMENT_START],
    ]
    const sevenSecondAss = testAssPreamble + `Dialogue: 0,0:00:04.00,0:00:12.00,Default,Singer,0,0,130,,{\\k150}{\\kf200}●●● {\\kf100}Be bop {\\kf50}{\\kf100}a lu bop

Dialogue: 0,0:00:04.00,0:00:12.00,Default,Singer,0,0,160,,{\\k600}{\\kf100}She's my ba{\\kf100}by


Dialogue: 0,0:00:12.00,0:01:00.00,Default,Singer,0,0,145,,{\\k0}{\\kf100}And {\\kf100}here's {\\kf100}screen {\\kf4500}two
`
    const options: KaraokeOptions = { ...DEFAULT_OPTIONS, addInstrumentalScreens: false, addStaggeredLines: false }

    const assFile = createAssFile(testLyrics, sevenSecondEvents, songDuration, "It's Cøøl to Tüül", "TÜ/ÜL", options);
    expect(assFile).toBe(sevenSecondAss);

});

test('floatToTimecode', () => {
    expect(floatToTimecode(0)).toBe("0:00:00.00");
    expect(floatToTimecode(25.42)).toBe("0:00:25.42");
    expect(floatToTimecode(60)).toBe("0:01:00.00");
});