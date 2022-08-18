import { LyricSegmentIterator } from "./timing";

const testLyrics = "Be bop_a lu bop\nShe's my ba/by"

test('LyricSegmentIterator', () => {
    const iterator = new LyricSegmentIterator(testLyrics);
    expect(Array.from(iterator).length).toBe(4);
});
