// functions to help with lyric markup tools

import { TAG_PATTERN } from "@/lib/voices";

function isBoundaryChar(char: string): boolean {
  return [" ", "\n", "_", "|"].includes(char);
}

/**
 * The lyric word around the cursor, without the voice tag it may touch.
 * It is empty when the cursor is inside a voice tag.
 */
export function getCurrentWord(body: string, cursorPosition: number): string {
  const lineStart = body.slice(0, cursorPosition).lastIndexOf("\n") + 1;
  const line = body.slice(lineStart).split("\n", 1)[0];
  const lyricStart = lineStart + voiceTagOf(line).length;
  if (cursorPosition < lyricStart) {
    return "";
  }
  let leftBound = cursorPosition,
    rightBound = cursorPosition;
  while (leftBound > lyricStart) {
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

export function convertSpacesToUnderscores(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const tag = voiceTagOf(line);
      return tag + line.slice(tag.length).replace(/ /g, "_");
    })
    .join("\n");
}

function voiceTagOf(line: string): string {
  return line.match(TAG_PATTERN)?.[0] ?? "";
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

function normalizeWord(word: string): string {
  return word.replace(/[/,!—]/g, "").toLowerCase();
}

function areWordsEquivalent(word1: string, word2: string): boolean {
  // Return true if word1 resembles word2 enough
  return normalizeWord(word1) == normalizeWord(word2);
}

export function slashifyAllOccurences(
  lyrics: string,
  word: string,
  slashedVersion: string,
): string {
  // Replace all instances of [word] in [text] with the current slashed version of the word.
  // For instance replace "alchemy" with "al/chem/y"
  // Preserve case and word separators.
  // A slash on an empty line would otherwise match every empty word.
  if (normalizeWord(word) == "") {
    return lyrics;
  }
  return lyrics
    .split(/(?<=\n)/)
    .map((line) => {
      const tag = voiceTagOf(line);
      return tag + slashifyLine(line.slice(tag.length), word, slashedVersion);
    })
    .join("");
}

function slashifyLine(lyrics: string, word: string, slashedVersion: string): string {
  let result = "";
  let currentWord = "";
  let state = "INWORD";

  function appendWord(
    text: string,
    currentWord: string,
    word: string,
    slashedVersion: string,
    next: string | undefined,
  ): string {
    if (!areWordsEquivalent(currentWord, word)) {
      return text + currentWord;
    }
    let slashed = addSlashes(currentWord, slashedVersion);
    if (next == "_" || next == "|" || next == "\n") {
      // The occurrence keeps its own slash here, so a slash typed before a line break survives.
      slashed = slashed.replace(/\/$/, "") + (currentWord.endsWith("/") ? "/" : "");
    }
    return text + slashed;
  }

  lyrics.split("").forEach((char) => {
    if (isBoundaryChar(char)) {
      state = "WORDEND";
    }
    if (state == "WORDEND") {
      result = appendWord(result, currentWord, word, slashedVersion, char);
      currentWord = "";
      result += char;
      state = "INWORD";
    } else if (state == "INWORD") {
      currentWord += char;
    }
  });
  result = appendWord(result, currentWord, word, slashedVersion, undefined);

  return result;
}
/**
 * Maps a position in [oldText] to the same place in [newText], where [newText] differs only by
 * slashes added or removed outside the word holding the position.
 */
export function slashifiedPosition(oldText: string, newText: string, position: number): number {
  let wordStart = position;
  while (wordStart > 0 && !isBoundaryChar(oldText[wordStart - 1])) {
    wordStart--;
  }
  let boundariesLeft = oldText.slice(0, wordStart).split("").filter(isBoundaryChar).length;
  let newWordStart = 0;
  while (boundariesLeft > 0) {
    if (isBoundaryChar(newText[newWordStart])) {
      boundariesLeft--;
    }
    newWordStart++;
  }
  return newWordStart + position - wordStart;
}
