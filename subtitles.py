from dataclasses import dataclass, field
from datetime import timedelta
from typing import Dict, List, Optional

from moviepy.tools import cvsecs as convert_to_seconds, subprocess_call

import ass


"""
Functions for generating ASS subtitles from lyric data
"""

VIDEO_SIZE = (400, 320)
LINE_HEIGHT = 80


@dataclass
class LyricsLine:
    text: str
    ts: timedelta
    end_ts: Optional[timedelta] = None

    def as_ass_event(
        self, screen_start: timedelta, screen_end: timedelta, style: ass.ASS.Style
    ):
        e = ass.ASS.Event()
        e.type = "Dialogue"
        e.Layer = 0
        e.Style = style
        e.Start = screen_start.total_seconds()
        e.End = screen_end.total_seconds()
        e.Text = self.decorate_ass_line(self.text, screen_start)
        return e

    def decorate_ass_line(self, text, screen_start_ts: timedelta):
        """Decorate line with karaoke tags"""
        # Prefix the tag with centisecs prior to line in screen

        start_time = (self.ts - screen_start_ts).total_seconds() * 100
        duration = (self.end_ts - self.ts).total_seconds() * 100

        return f"{{\k{start_time}}}{{\kf{duration}}}{text}"


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
            line.as_ass_event(self.start_ts, self.end_ts, style) for line in self.lines
        ]

    def __str__(self):
        lines = [f"{self.start_ts} - {self.end_ts}:"]
        for line in self.lines:
            lines.append(f"\t{line}")
        return "\n".join(lines)


def create_subtitles(lyric_screens, display_params: Dict) -> ass.ASS:
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
        "MarginV",
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
    style.MarginV = 20
    a.add_style(style)

    a.events_format = ["Layer", "Style", "Start", "End", "Text"]
    for screen in lyric_screens:
        [a.add(event) for event in screen.as_ass_events(style)]

    return a
