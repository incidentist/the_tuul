import { parseYouTubeTitle } from './video';

test('parseYouTubeTitle', () => {
    expect(parseYouTubeTitle({ title: 'The Bolks singing Squibble Doo Dah' })).toEqual(['', 'The Bolks singing Squibble Doo Dah']);

    const expected = ['The Bolks', 'Squibble Doo Dah'];
    expect(parseYouTubeTitle({ author: 'The Bolks', title: 'Squibble Doo Dah' })).toEqual(expected);
});