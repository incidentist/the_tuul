import { addTitleScreen } from "./adjustments";
import { compileLyricTimings, denormalizeTimestamps } from "./timing";
import { testLyrics, shortIntroTestEvents } from "./timing.spec.js";

test('addTitleScreenToShortIntroSong', () => {
    const titleScreenAss = `Dialogue: 0,Default,0:00:00.00,0:00:04.00,130,{\\k0}{\\kf200}Tüülin' Around
Dialogue: 0,Default,0:00:00.00,0:00:04.00,160,{\\k200}{\\kf200}The Tüüls
`
    const screens = denormalizeTimestamps(compileLyricTimings(testLyrics, shortIntroTestEvents), 60.0);
    const screensWithTitle = addTitleScreen(screens, "Tüülin' Around", "The Tüüls");
    expect(screensWithTitle.length).toBe(3);
    expect(screensWithTitle[0].toAssEvents({})).toBe(titleScreenAss);
    expect(screensWithTitle[0].audioDelay).toBe(4);
});