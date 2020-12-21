import json

import click
from numpy.core.numeric import full

from moviepy.editor import (
    AudioFileClip,
    ColorClip,
    CompositeVideoClip,
    concatenate_videoclips,
    TextClip,
    VideoClip,
)

VIDEO_SIZE = (320, 400)
BACKGROUND_COLOR = (0, 0, 0)
TEXT_COLOR = "salmon"
TEXT_FONT = "fixed"


@click.command()
@click.option("--song-data", type=click.File("r"))
@click.option("--out_path", type=click.Path(exists=False))
def run(song_data, out_path):
    song_json = json.load(song_data)
    audio_path = song_json["song_file"]
    audio_clip = AudioFileClip(audio_path)
    lyric_clips = get_screens(song_json["screens"])
    write_video(out_path, audio_clip, set_durations(lyric_clips, audio_clip.duration))


def get_screens(screen_list):
    return [create_clip(s) for s in screen_list]


def create_clip(screen_info):
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
