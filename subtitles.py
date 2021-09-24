from dataclasses import dataclass, field
from datetime import timedelta
from typing import Dict, List, Optional

import ass


"""
Functions for generating ASS subtitles from lyric data
"""

VIDEO_SIZE = (400, 320)
LINE_HEIGHT = 30


@dataclass
class LyricSegment:
    text: str
    ts: timedelta
    end_ts: Optional[timedelta] = None

    def adjust_timestamps(self, adjustment) -> "LyricSegment":
        ts = self.ts + adjustment
        end_ts = self.end_ts + adjustment if self.end_ts else None
        return LyricSegment(self.text, ts, end_ts)

    def to_ass(self) -> str:
        """Render this segment as part of an ASS event line"""
        duration = (self.end_ts - self.ts).total_seconds() * 100
        return f"{{\kf{duration}}}{self.text}"


@dataclass
class LyricsLine:
    segments: List[LyricSegment] = field(default_factory=list)

    @property
    def ts(self) -> Optional[timedelta]:
        return self.segments[0].ts if len(self.segments) else None

    @property
    def end_ts(self) -> Optional[timedelta]:
        return self.segments[-1].end_ts

    @ts.setter
    def ts(self, value):
        self.segments[0].ts = value

    @end_ts.setter
    def end_ts(self, value):
        self.segments[-1].end_ts = value

    def __str__(self):
        return "".join([f"{{{s.text}}}" for s in self.segments])

    def as_ass_event(
        self,
        screen_start: timedelta,
        screen_end: timedelta,
        style: ass.ASS.Style,
        top_margin: int,
    ):
        e = ass.ASS.Event()
        e.type = "Dialogue"
        e.Layer = 0
        e.Style = style
        e.Start = screen_start.total_seconds()
        e.End = screen_end.total_seconds()
        e.MarginV = top_margin
        e.Text = self.decorate_ass_line(self.segments, screen_start)
        return e

    def decorate_ass_line(self, segments, screen_start_ts: timedelta):
        """Decorate line with karaoke tags"""
        # Prefix the tag with centisecs prior to line in screen
        start_time = (self.ts - screen_start_ts).total_seconds() * 100
        ass_segments = "".join([s.to_ass() for s in self.segments])

        return f"{{\k{start_time}}}{ass_segments}"

    def adjust_timestamps(self, adjustment) -> "LyricsLine":
        new_segments = [s.adjust_timestamps(adjustment) for s in self.segments]
        start_ts = self.ts + adjustment if self.ts else None
        return LyricsLine(new_segments)


@dataclass
class LyricsScreen:
    lines: List[LyricsLine] = field(default_factory=list)
    start_ts: Optional[timedelta] = None

    @property
    def end_ts(self) -> timedelta:
        return self.lines[-1].end_ts

    def get_line_y(self, line_num: int) -> int:
        _, h = VIDEO_SIZE
        line_count = len(self.lines)
        line_height = LINE_HEIGHT
        return (h / 2) - (line_count * line_height / 2) + (line_num * line_height)

    def as_ass_events(self, style: ass.ASS.Style) -> List[ass.ASS.Event]:
        return [
            line.as_ass_event(self.start_ts, self.end_ts, style, self.get_line_y(i))
            for i, line in enumerate(self.lines)
        ]

    def __str__(self):
        lines = [f"{self.start_ts} - {self.end_ts}:"]
        for line in self.lines:
            lines.append(f"\t{line}")
        return "\n".join(lines)

    def adjust_timestamps(self, adjustment: timedelta) -> "LyricsScreen":
        new_lines = [l.adjust_timestamps(adjustment) for l in self.lines]
        start_ts = self.start_ts + adjustment if self.start_ts else None
        return LyricsScreen(new_lines, start_ts)


def create_subtitles(
    lyric_screens: List[LyricsScreen], display_params: Dict
) -> ass.ASS:
    a = ass.ASS()
    a.styles_format = [
        "Name",
        "Alignment",
        "Fontname",
        "Fontsize",
        "PrimaryColour",
        "SecondaryColour",
        "Bold",
        "ScaleX",
        "ScaleY",
        "Spacing",
        "MarginL",
        "MarginR",
        "Encoding",
    ]
    style = ass.ASS.Style()
    style.type = "Style"
    style.Name = "Default"
    style.Fontname = display_params["FontName"]
    style.Fontsize = display_params["FontSize"]
    style.Bold = True
    style.PrimaryColor = display_params["PrimaryColor"]
    style.SecondaryColor = display_params["SecondaryColor"]
    style.Alignment = ass.ASS.ALIGN_TOP_CENTER
    a.add_style(style)

    a.events_format = ["Layer", "Style", "Start", "End", "MarginV", "Text"]
    for screen in lyric_screens:
        [a.add(event) for event in screen.as_ass_events(style)]

    return a
