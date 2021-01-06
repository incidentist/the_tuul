import json
from collections import deque

import click
from numpy.core.numeric import full
from moviepy.video.tools.drawing import color_split
from moviepy.tools import cvsecs as convert_to_seconds, subprocess_call

import ass


from moviepy.editor import (
    AudioFileClip,
    ColorClip,
    CompositeVideoClip,
    concatenate_videoclips,
    TextClip,
    VideoClip,
)

VIDEO_SIZE = (400, 320)
LINE_HEIGHT = 80
BACKGROUND_COLOR = (0, 0, 0)
TEXT_COLOR = "salmon"
TEXT_COLOR_AFTER = "green"
TEXT_FONT = "fixed"
FONT_SIZE = 20


class LyricsLine:
    def __init__(self, line_data):
        self.text = line_data["line"]
        self.start_ts = convert_to_seconds(line_data["ts"])
        self.end_ts = convert_to_seconds(line_data.get("end_ts", 0))

    def get_clip(self):
        return CompositeVideoClip(
            size=self.clip_size, clips=[self.background_clip, self.foreground_clip]
        )

    @property
    def clip_size(self):
        return (VIDEO_SIZE[0], LINE_HEIGHT)

    @property
    def clip_width(self):
        return self.clip_size[0]

    @property
    def foreground_clip(self):
        clip = TextClip(
            txt=self.text, color=TEXT_COLOR, fontsize=FONT_SIZE, size=self.clip_size
        )
        clip.mask.get_frame = self.mask_frame
        return clip

    @property
    def background_clip(self):
        return TextClip(
            txt=self.text,
            color=TEXT_COLOR_AFTER,
            fontsize=FONT_SIZE,
            size=self.clip_size,
        )

    def mask_frame(self, t):
        # print("t: " + str(t))
        normalized_t = min(max(self.start_ts, t), self.end_ts) - self.start_ts
        pct = (
            normalized_t
            if normalized_t == 0
            else normalized_t / (self.end_ts - self.start_ts)
        )

        return color_split(
            size=self.clip_size, x=int(pct * self.clip_width), col1=1, col2=0
        )

    def __str__(self):
        return f"[{self.start_ts} - {self.end_ts}] {self.text}"

    def as_ass_event(self, screen_start, screen_end, style):
        e = ass.ASS.Event()
        e.type = "Dialogue"
        e.Layer = 0
        e.Style = style
        e.Start = screen_start
        e.End = screen_end
        e.Text = self.decorate_ass_line(self.text, screen_start)
        return e

    def decorate_ass_line(self, text, screen_start_ts):
        """Decorate line with karaoke tags"""
        # Prefix the tag with centisecs prior to line in screen
        start_time = (
            convert_to_seconds(self.start_ts) - convert_to_seconds(screen_start_ts)
        ) * 100
        duration = (
            convert_to_seconds(self.end_ts) - convert_to_seconds(self.start_ts)
        ) * 100

        return f"{{\k{start_time}}}{{\kf{duration}}}{text}"


class LyricsScreen:
    def __init__(self, screen_data):
        self._start_ts = (
            convert_to_seconds(screen_data.get("ts")) if "ts" in screen_data else None
        )
        self._end_ts = (
            convert_to_seconds(screen_data.get("end_ts"))
            if "end_ts" in screen_data
            else None
        )
        self.lines = self.create_lines(screen_data["lines"])

    def get_clip(self):
        line_clips = [self.get_line_clip(i) for i in range(0, len(self.lines))]
        return (
            CompositeVideoClip(line_clips, size=self.clip_size)
            # .set_start(self.start_ts)
            # .set_end(self.end_ts)
            # .set_duration(self.end_ts - self.start_ts)
        )

    @property
    def clip_size(self):
        return VIDEO_SIZE

    def get_line_clip(self, i):
        line = self.lines[i]
        return (
            line.get_clip()
            .set_pos((0, self.get_line_y(i)))
            .set_start(self.start_ts)
            .set_end(self.end_ts)
        )

    def create_lines(self, line_data):
        lines = deque()
        # Create lines in reverse order so we can infer end timestamps
        for line in reversed(line_data):
            if not "end_ts" in line:
                if len(lines) > 0:
                    line["end_ts"] = lines[0].start_ts
                else:
                    line["end_ts"] = self.end_ts
            line = LyricsLine(line)
            lines.appendleft(line)

        return lines

    def get_line_y(self, line_num: int) -> int:
        _, h = VIDEO_SIZE
        line_count = len(self.lines)
        line_height = LINE_HEIGHT
        return (h / 2) - (line_count * line_height / 2) + (line_num * line_height)

    @property
    def start_ts(self):
        if self._start_ts is None:
            return self.lines[0].start_ts
        else:
            return self._start_ts

    @property
    def end_ts(self):
        if self._end_ts is None:
            return self.lines[-1].end_ts
        else:
            return self._end_ts

    def get_ass_lines(self, style):
        events = []
        for line in self.lines:
            events.append(line.as_ass_event(self.start_ts, self.end_ts, style))

        return events

    def __str__(self):
        lines = [f"{self.start_ts} - {self.end_ts}:"]
        for line in self.lines:
            lines.append(f"\t{line}")
        return "\n".join(lines)


class LyricVideo:
    def __init__(self, video_data):
        self.song_file = video_data["song_file"]
        self.audio_clip = AudioFileClip(self.song_file)
        self.screens = self.get_screens(video_data["screens"])

    @property
    def ass_filepath(self):
        return "./out.ass"

    def get_screens(self, screen_data):
        screens = deque()
        for data in reversed(screen_data):
            if not "end_ts" in data:
                if len(screens) > 0:
                    data["end_ts"] = screens[0].start_ts
                else:
                    data["end_ts"] = self.end_ts
            screen = LyricsScreen(data)
            screens.appendleft(screen)
        return screens

    def get_screen_clip(self, i):
        return self.screens[i].get_clip()

    def get_clip(self):
        audio = self.audio_clip
        screen_clips = [self.get_screen_clip(i) for i in range(0, len(self.screens))]
        video = CompositeVideoClip(clips=screen_clips)
        video.fps = 24
        video.audio = audio
        return video

    def write_ass_file(self):
        outfile = self.ass_filepath
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
        style.Fontname = "Arial Narrow"
        style.Fontsize = 20
        style.Bold = True
        style.PrimaryColor = (255, 0, 255, 255)
        style.SecondaryColor = (0, 255, 255, 255)
        style.Alignment = ass.ASS.ALIGN_TOP_CENTER
        style.MarginV = 20
        a.add_style(style)

        a.events_format = ["Layer", "Style", "Start", "End", "Text"]
        for screen in self.screens:
            [a.add(event) for event in screen.get_ass_lines(style)]
        print(a.events)
        a.write(outfile)

    @property
    def start_ts(self):
        return 0.0

    @property
    def end_ts(self):
        return self.audio_clip.duration

    def __str__(self):
        lines = [f"Song File: {self.song_file}", f"Duration: {self.end_ts}"]
        for screen in self.screens:
            lines.append(str(screen))
        return "\n".join(lines)


@click.command()
@click.option("--song-data", type=click.File("r"))
@click.option("--out_path", type=click.Path(exists=False))
def run(song_data, out_path):
    song_json = json.load(song_data)
    video = LyricVideo(song_json)
    print(video)
    video.write_ass_file()
    ffmpeg_cmd = [
        "/usr/local/bin/ffmpeg",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=1280x720:r=20",
        "-i",
        video.song_file,
        "-c:a",
        "libmp3lame",
        "-vf",
        "ass=" + video.ass_filepath,
        "-shortest",
        "-y",
        "out.mp4",
    ]
    subprocess_call(ffmpeg_cmd)
    # video.get_clip().write_videofile(out_path)
    return
    write_video(out_path, audio_clip, set_durations(lyric_clips, audio_clip.duration))


def get_screens(screen_list):
    return [create_clip(s) for s in screen_list]


def create_clip(screen_info):
    return LyricsScreen(screen_info, None)
    lines = "\n".join(screen_info["lines"])
    timestamp = screen_info.get("ts", "00:00:00")
    return TextClip(txt=lines, color=TEXT_COLOR, size=VIDEO_SIZE).set_start(timestamp)


def set_durations(lyric_clips, full_duration):
    """ Explicitly set the durations of lyric_clips """
    new_clips = []
    for i, clip in enumerate(lyric_clips):
        if i != len(lyric_clips) - 1:
            next_clip = lyric_clips[i + 1]
            new_clips.append(clip.set_duration(next_clip.start - clip.start))
        else:
            new_clips.append(clip.set_duration(full_duration - clip.start))

    return new_clips


def write_video(out_path, audio_clip, lyric_clips):
    [print(c.duration) for c in lyric_clips]
    print(audio_clip.duration)
    full_text_clip = concatenate_videoclips(lyric_clips)
    video = CompositeVideoClip(
        clips=[
            ColorClip(
                size=VIDEO_SIZE, color=BACKGROUND_COLOR, duration=audio_clip.duration
            ),
            full_text_clip,
        ],
    )
    video.fps = 24
    video.audio = audio_clip
    video.write_videofile(out_path)


if __name__ == "__main__":
    run()
