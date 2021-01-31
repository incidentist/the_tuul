import itertools
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional, Tuple, Union, Dict, Any

import click
import pydub
from moviepy.tools import subprocess_call
import ass

import timing_data
from subtitles import LyricsLine, LyricsScreen, create_subtitles

SONG_ROOT_PATH = "songs/"


@click.command()
@click.option("--lyricsfile", type=click.File("r"), help="File containing lyrics text")
@click.option(
    "--songfile", type=click.Path(exists=True, dir_okay=False), help="File of song"
)
@click.option(
    "--instrumental_path", type=click.Path(exists=True, dir_okay=False), required=False
)
def run(lyricsfile, songfile, instrumental_path: str = None):
    songpath = Path(songfile)
    song_name = songpath.stem
    song_files_dir = Path(SONG_ROOT_PATH).joinpath(song_name).resolve()
    song_files_dir.mkdir(parents=True, exist_ok=True)

    if not instrumental_path:
        click.echo("Creating instrumental track...")
        (instrumental_path, vocal_path) = split_song(songpath, song_files_dir)
        print(instrumental_path, vocal_path)
        click.echo(f"Wrote instrumental track to {instrumental_path}")

    lyrics = lyricsfile.read()
    lyric_events = timing_data.gather_timing_data(lyrics, songpath)
    screens = compile_lyric_timings(lyrics, lyric_events)
    screens = set_line_end_times(screens, instrumental_path)
    screens = set_screen_start_times(screens)

    lyric_subtitles = create_subtitles(
        screens,
        {
            "FontName": "Arial Narrow",
            "FontSize": 20,
            "PrimaryColor": (255, 0, 255, 255),
            "SecondaryColor": (0, 255, 255, 255),
        },
    )
    create_video(instrumental_path, lyric_subtitles, output_dir=song_files_dir)


def set_line_end_times(
    screens: List[LyricsScreen], instrumental_path: str
) -> List[LyricsScreen]:
    """
    Infer end times of lines for screens where they are not already set.
    """
    lines = list(itertools.chain.from_iterable([s.lines for s in screens]))
    for i, line in enumerate(lines):
        if not line.end_ts:
            if i == len(lines) - 1:
                audio = pydub.AudioSegment(instrumental_path)
                duration = audio.duration_seconds
                line.end_ts = timedelta(seconds=duration)
            next_line = lines[i + 1]
            line.end_ts = next_line.ts
    return screens


def set_screen_start_times(screens: List[LyricsScreen]) -> List[LyricsScreen]:
    """
    Set start times for screens to the end times of the previous screen.
    """
    prev_screen = None
    for screen in screens:
        if prev_screen is None:
            screen.start_ts = timedelta()
        else:
            screen.start_ts = prev_screen.end_ts + timedelta(seconds=0.1)
        prev_screen = screen
    return screens


class TimedeltaEncoder(json.JSONEncoder):
    """Adds ability to encode timedeltas to JSON """

    def default(self, obj):
        if isinstance(obj, timedelta):
            return str(obj)

        return super(TimedeltaEncoder, self).default(obj)


def write_outfile(
    outfile: str, instrumental_path: Union[str, Path], screens: List[LyricsScreen]
):
    jsonout = {"song_file": str(instrumental_path), "screens": screens}

    with open(outfile, "w") as of:
        json.dump(jsonout, of, indent=2, cls=TimedeltaEncoder)


def compile_lyric_timings(
    lyrics: str, events: List[Tuple[timedelta, timing_data.LyricMarker]]
) -> List[LyricsScreen]:
    """
    Read keyboard events in the order they were pressed and construct
    objects for screens and lines that include the given timing information.
    """
    lines = iter(lyrics.split("\n"))
    events = iter(events)
    screens: List[LyricsScreen] = []
    prev_line_obj: Optional[LyricsLine] = None
    screen: LyricsScreen = LyricsScreen()

    for event in events:
        ts = event[0]
        marker = event[1]
        if marker == timing_data.LyricMarker.SEGMENT_START:
            line = next(lines)
            if line == "":
                screens, screen = advance_screen(screens, screen)
                line = next(lines)
            line_obj = LyricsLine(line, ts)
            screen.lines.append(line_obj)
            prev_line_obj = line_obj
        elif marker == timing_data.LyricMarker.SEGMENT_END:
            if prev_line_obj is not None:
                prev_line_obj.end_ts = ts
    screens, _ = advance_screen(screens, screen)

    return screens


def advance_screen(screens, screen):
    """ Add screen to screens and return a new screen object """
    screens.append(screen)
    return screens, LyricsScreen()


def split_song(songfile: Path, song_dir: Path) -> Tuple[str, str]:
    """ Run spleeter to split song into instrumental and vocal tracks """
    from spleeter.separator import Separator

    separator = Separator("spleeter:2stems")
    separator.separate_to_file(
        str(songfile), str(song_dir), filename_format="{instrument}.{codec}"
    )
    return str(song_dir.joinpath("accompaniment.wav")), str(
        song_dir.joinpath("vocals.wav")
    )


def create_video(audio_path: str, subtitles: ass.ASS, output_dir: Path):
    ass_path = str(output_dir.joinpath("subtitles.ass"))
    video_path = str(output_dir.joinpath("karoake.mp4"))
    subtitles.write(ass_path)
    ffmpeg_cmd = [
        "/usr/local/bin/ffmpeg",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=1280x720:r=20",
        "-i",
        audio_path,
        "-c:a",
        "libmp3lame",
        "-vf",
        "ass=" + ass_path,
        "-shortest",
        "-y",
        video_path,
    ]
    subprocess_call(ffmpeg_cmd)


if __name__ == "__main__":
    run()
