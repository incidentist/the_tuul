import json

import click
from numpy.core.numeric import full
from moviepy.video.tools.drawing import color_split
from moviepy.tools import cvsecs as convert_to_seconds


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
FONT_SIZE = 30


class LyricsLine:
    def __init__(self, line_data):
        self.text = line_data["line"]
        self.start_ts = convert_to_seconds(line_data["ts"])
        self.end_ts = convert_to_seconds(line_data.get("end_ts", 10.0))

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


class LyricsScreen:
    def __init__(self, screen_data):
        self.lines = self.create_lines(screen_data["lines"])
        self.prev_screen = None
        self.next_screen = None

    def get_clip(self):
        line_clips = [self.get_line_clip(i) for i in range(0, len(self.lines))]
        return (
            CompositeVideoClip(
                line_clips, size=self.clip_size, bg_color=BACKGROUND_COLOR
            )
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
        # Create a layout manager
        # layout manager creates LyricsLines
        lines = []
        for i, line in enumerate(line_data):
            line = LyricsLine(line)

        lines = [LyricsLine(line) for i, line in enumerate(line_data)]
        return lines

    def get_line_y(self, line_num: int) -> int:
        _, h = VIDEO_SIZE
        line_count = len(self.lines)
        line_height = LINE_HEIGHT
        return (h / 2) - (line_count * line_height / 2) + (line_num * line_height)

    @property
    def start_ts(self):
        if self.prev_screen:
            return self.prev_screen.end_ts
        else:
            return 0.0

    @property
    def end_ts(self):
        return 10.0
        if len(self.lines):
            return self.lines[-1].end_ts
        else:
            return 5.0


@click.command()
@click.option("--song-data", type=click.File("r"))
@click.option("--out_path", type=click.Path(exists=False))
def run(song_data, out_path):
    song_json = json.load(song_data)
    audio_path = song_json["song_file"]
    audio_clip = AudioFileClip(audio_path)
    lyric_clips = get_screens(song_json["screens"])
    lyric_clips[0].get_clip().write_videofile(out_path)
    return
    write_video(out_path, audio_clip, set_durations(lyric_clips, audio_clip.duration))


def get_screens(screen_list):
    return [create_clip(s) for s in screen_list]


def create_clip(screen_info):
    return LyricsScreen(screen_info)
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
