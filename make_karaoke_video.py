import itertools
import json
from datetime import datetime, timedelta
import logging
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
@click.option("--timings", type=click.Path(exists=True, dir_okay=False), required=False)
def run(
    lyricsfile,
    songfile,
    timings: str = None,
):
    songpath = Path(songfile)
    song_name = songpath.stem
    song_files_dir = Path(SONG_ROOT_PATH).joinpath(song_name).resolve()
    song_files_dir.mkdir(parents=True, exist_ok=True)
    instrumental_path = song_files_dir.joinpath("accompaniment.wav")
    vocal_path = song_files_dir.joinpath("vocals.wav")

    if instrumental_path.exists() and vocal_path.exists():
        click.echo(f"Using existing instrumental track at {instrumental_path}")
    else:
        click.echo("Splitting song into instrumental and vocal tracks..")
        split_song(songpath, song_files_dir)
        click.echo(f"Wrote instrumental track to {instrumental_path}")

    lyrics = lyricsfile.read()
    if timings is not None:
        lyric_events = read_timings_file(timings)
    else:
        lyric_events = timing_data.gather_timing_data(lyrics, songpath)
        write_timings_file(song_files_dir.joinpath("timings.json"), lyric_events)
    intial_screens = compile_lyric_timings(lyrics, lyric_events)
    screens = set_line_end_times(intial_screens, instrumental_path)
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

    # Create the autocorrected video
    click.echo("Writing autocorrected video...")
    corrected_video_filename = "karaoke-corrected.mp4"
    screens = autocorrect_timings(intial_screens, vocal_path)
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
    create_video(
        instrumental_path,
        lyric_subtitles,
        output_dir=song_files_dir,
        filename=corrected_video_filename,
    )


def autocorrect_timings(
    screens: List[LyricsScreen], vocal_audio_path: Path
) -> List[LyricsScreen]:
    """
    Adjust timings by looking at the difference between the time of the first vocals in the song and the time of the first spacebar press. Adjust all song timings by that amount.
    """
    click.echo("Autocorrecting timings...")
    first_segment_start: timedelta = screens[0].lines[0].ts
    first_vocal_ts: timedelta = find_first_vocal_time(
        vocal_audio_path, first_segment_start
    )
    if first_vocal_ts is None:
        click.echo("No vocals found. Proceeding without autocorrect...")
        return screens
    click.echo(f"Found first vocal at {first_vocal_ts.total_seconds()}s")
    adjustment = first_vocal_ts - first_segment_start
    click.echo(f"Adjusting timings by {adjustment.total_seconds()}s...")
    return [s.adjust_timestamps(adjustment) for s in screens]


def find_first_vocal_time(
    vocal_audio_path: Path, first_space_tap_time: timedelta
) -> Optional[timedelta]:
    audio = pydub.AudioSegment.from_wav(str(vocal_audio_path))
    # Max decibels to consider silence
    silence_threshold = -60
    # silence tuples are in milliseconds
    non_silences: List[Tuple[int, int]] = pydub.silence.detect_nonsilent(
        audio, silence_thresh=silence_threshold
    )
    closest_nonsilent_start = None
    for nonsilent_span in non_silences:
        span_start = timedelta(milliseconds=nonsilent_span[0])
        if span_start > first_space_tap_time:
            break
        closest_nonsilent_start = span_start

    return closest_nonsilent_start


def set_line_end_times(
    screens: List[LyricsScreen], instrumental_path: Path
) -> List[LyricsScreen]:
    """
    Infer end times of lines for screens where they are not already set.
    """
    lines = list(itertools.chain.from_iterable([s.lines for s in screens]))
    for i, line in enumerate(lines):
        if not line.end_ts:
            if i == len(lines) - 1:
                audio = pydub.AudioSegment.from_wav(str(instrumental_path))
                duration = audio.duration_seconds
                line.end_ts = timedelta(seconds=duration)
            else:
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


class TimingsEncoder(json.JSONEncoder):
    """Adds ability to encode timedeltas to JSON """

    def default(self, obj):
        if isinstance(obj, timedelta):
            return obj.total_seconds()

        return super().default(obj)


def write_timings_file(
    outfile: Path, timings: List[Tuple[timedelta, timing_data.LyricMarker]]
):
    with outfile.open("w") as of:
        json.dump(timings, of, indent=2, cls=TimingsEncoder)


def parse_timing_float(t: str) -> timedelta:
    return timedelta(seconds=float(t))


def read_timings_file(
    timings_path: str,
) -> List[Tuple[timedelta, timing_data.LyricMarker]]:
    with open(timings_path, "r") as f:
        return json.load(f, parse_float=parse_timing_float)


def compile_lyric_timings(
    lyrics: str, events: List[Tuple[timedelta, timing_data.LyricMarker]]
) -> List[LyricsScreen]:
    """
    Read keyboard events in the order they were pressed and construct
    objects for screens and lines that include the given timing information.
    """
    segments = iter(timing_data.LyricSegmentIterator(lyrics_txt=lyrics))
    events = iter(events)
    screens: List[LyricsScreen] = []
    prev_line_obj: Optional[LyricsLine] = None
    screen: LyricsScreen = LyricsScreen()

    for event in events:
        ts = event[0]
        marker = event[1]
        if marker == timing_data.LyricMarker.SEGMENT_START:
            line = next(segments)
            if line == "":
                screens, screen = advance_screen(screens, screen)
                line = next(segments)
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


def create_video(
    audio_path: Path,
    subtitles: ass.ASS,
    output_dir: Path,
    filename: str = "karaoke.mp4",
):
    ass_path = str(output_dir.joinpath("subtitles.ass"))
    video_path = str(output_dir.joinpath(filename))
    subtitles.write(ass_path)
    ffmpeg_cmd = [
        "/usr/local/bin/ffmpeg",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=1280x720:r=20",
        "-i",
        str(audio_path),
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
