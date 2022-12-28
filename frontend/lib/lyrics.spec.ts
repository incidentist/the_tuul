import { getCurrentWord, slashifyAllOccurences } from "./lyrics";

test('getCurrentWord', () => {
    const text = `The quick brown
fox jumps over the lazy_dog.`;
    expect(getCurrentWord(text, 0)).toBe("The");
    expect(getCurrentWord(text, 2)).toBe("The");
    expect(getCurrentWord(text, 10)).toBe("brown");
    expect(getCurrentWord(text, 43)).toBe("dog.");
});

test('slashifyAllOccurences', () => {
    expect(slashifyAllOccurences('ggg', 'ggg', 'ggg')).toBe('ggg');
    expect(slashifyAllOccurences('ggg ggg', 'ggg', 'gg/g')).toBe('gg/g gg/g');
    expect(slashifyAllOccurences('ggg_ggg', 'ggg', 'gg/g')).toBe('gg/g_gg/g');
    expect(slashifyAllOccurences('ggg\nggg', 'ggg', 'gg/g')).toBe('gg/g\ngg/g');
    expect(slashifyAllOccurences('Ggg ggg', 'ggg', 'gg/g')).toBe('Gg/g gg/g');
    expect(slashifyAllOccurences('Ggg ggg', 'ggg', 'ggg/')).toBe('Ggg/ ggg/');
    expect(slashifyAllOccurences('Ggg ggg,\nggg ggg!', 'ggg', 'gg/g')).toBe('Gg/g gg/g,\ngg/g gg/g!');
    expect(slashifyAllOccurences('Ggg end\nbegin ggg', 'Ggg', 'G/gg')).toBe("G/gg end\nbegin g/gg");

})