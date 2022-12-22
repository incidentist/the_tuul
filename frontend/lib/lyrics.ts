// functions to help with lyric markup tools

function isBoundaryChar(char: string): boolean {
    return [" ", "\n", "_"].includes(char);
}

export function getCurrentWord(body: string, cursorPosition: number): string {
    let leftBound = cursorPosition, rightBound = cursorPosition;
    while (leftBound > 0) {
        if (isBoundaryChar(body[leftBound - 1])) {
            break;
        }
        leftBound--;
    }
    while (rightBound < body.length) {
        if (isBoundaryChar(body[rightBound])) {
            break;
        }
        rightBound++;
    }

    return body.slice(leftBound, rightBound);
}

function replaceSpacesWithUnderscores(text: string): string {
    return text.replace(" ", "_");
}

function addSlashes(word: string, template: string): string {
    // Add slashes to [word] in the same positions as in [template]
    let result = word.replace(/\//g, "");
    template.split("").forEach((char, index) => {
        if (char == "/") {
            result = result.substring(0, index) + char + result.substring(index);
        }
    });
    return result;
}

function areWordsEquivalent(word1: string, word2: string): boolean {
    // Return true if word1 resembles word2 enough
    return word1.toLowerCase().replace(/[/,!—]/g, '') == word2.replace(/[/,!—]/g, '').toLowerCase();
}

export function slashifyAllOccurences(lyrics: string, word: string, slashedVersion: string): string {
    // Replace all instances of [word] in [text] with the current slashed version of the word.
    // For instance replace "alchemy" with "al/chem/y"
    // Preserve case and word separators.
    let result = "";
    let currentWord = "";
    let state = 'INWORD';

    function appendWord(text: string, currentWord: string, word: string, slashedVersion: string): string {
        if (areWordsEquivalent(currentWord, word)) {
            return text + addSlashes(currentWord, slashedVersion);
        } else {
            return text + currentWord;
        }
    }

    lyrics.split("").forEach((char) => {
        if (isBoundaryChar(char)) {
            state = 'WORDEND';
        }
        if (state == 'WORDEND') {
            result = appendWord(result, currentWord, word, slashedVersion);
            currentWord = "";
            result += char;
            state = 'INWORD';
        } else if (state == 'INWORD') {
            currentWord += char;
        }
    });
    result = appendWord(result, currentWord, word, slashedVersion);

    return result;
}
