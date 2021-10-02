import logging
from enum import IntEnum
from typing import List

logging.getLogger().setLevel(logging.DEBUG)


class LyricMarker(IntEnum):
    SEGMENT_START = 1
    SEGMENT_END = 2


class LyricSegmentIterator:
    def __init__(self, lyrics_txt: str):
        self._segments = self.parse_segments(lyrics_txt)
        self._current_segment = None

    def __iter__(self):
        self._current_segment = 0
        return self

    def __next__(self):
        if self._current_segment >= len(self._segments):
            raise StopIteration
        val = self._segments[self._current_segment]
        self._current_segment += 1
        return val

    def __len__(self):
        return len(self._segments)

    def parse_segments(self, lyrics: str) -> List[str]:
        segments: List[str] = []
        current_segment = ""
        for i, char in enumerate(lyrics):
            finish_segment = False
            if char in ["\n", "/", "_"] or i == len(lyrics) - 1:
                finish_segment = True
                if char == "/":
                    char = ""
                elif char == "_":
                    char = " "
            if char == "\n" and current_segment == "":
                segments[-1] += char
                continue
            current_segment += char
            if finish_segment:
                segments.append(current_segment)
                current_segment = ""

        return segments
