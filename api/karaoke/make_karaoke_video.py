import itertools
import json
from datetime import datetime, timedelta
import logging
from pathlib import Path
import subprocess as sp
from typing import List, Optional, Tuple, Union, Dict, Any

import click
import pydub

from . import ass, timing_data, music_separation

from .subtitles import LyricSegment, LyricsLine, LyricsScreen, create_subtitles

SONG_ROOT_PATH = "songs/"


def run(
    lyricsfile: Path,
    songfile: Path,
    timingsfile: Path = None,
    lyric_subtitles: str = None,
    output_filename: str = "karaoke.mp4",
    audio_delay: float = 0.0,
    metadata: dict = {},
    background_color: str = "#000000",
):
    song_files_dir = songfile.parent
    instrumental_path = song_files_dir.joinpath("accompaniment.wav")
    vocal_path = song_files_dir.joinpath("vocals.wav")

    lyrics = lyricsfile.read_text()
    if timingsfile is not None:
        lyric_events = read_timings_file(timingsfile)
    else:
        lyric_events = timing_data.gather_timing_data(lyrics, songfile)
        write_timings_file(song_files_dir.joinpath("timings.json"), lyric_events)

    if instrumental_path.exists() and vocal_path.exists():
        click.echo(f"Using existing instrumental track at {instrumental_path}")
    else:
        click.echo("Splitting song into instrumental and vocal tracks..")
        instrumental_path, vocals_path = music_separation.split_song(
            songfile, song_files_dir
        )
        click.echo(f"Wrote instrumental track to {instrumental_path}")

    if lyric_subtitles == None:
        intial_screens = compile_lyric_timings(lyrics, lyric_events)
        screens = set_segment_end_times(intial_screens, instrumental_path)
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
    return create_video(
        instrumental_path,
        lyric_subtitles,
        output_dir=song_files_dir,
        filename=output_filename,
        audio_delay=audio_delay,
        metadata=metadata,
        background_color=background_color,
    )


def autocorrect_timings(
    screens: List[LyricsScreen], vocal_audio_path: Path
) -> List[LyricsScreen]:
    """
    Not currently used.
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


def get_file_duration(media_path: Path) -> timedelta:
    audio = pydub.AudioSegment.from_wav(str(media_path))
    duration = audio.duration_seconds
    return timedelta(seconds=duration)


def set_segment_end_times(
    screens: List[LyricsScreen], instrumental_path: Path
) -> List[LyricsScreen]:
    """
    Infer end times of lines for screens where they are not already set.
    """
    segments = list(
        itertools.chain.from_iterable([l.segments for s in screens for l in s.lines])
    )
    for i, segment in enumerate(segments):
        if not segment.end_ts:
            if i == len(segments) - 1:
                segment.end_ts = get_file_duration(instrumental_path)
            else:
                next_segment = segments[i + 1]
                segment.end_ts = next_segment.ts
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
    """Adds ability to encode timedeltas to JSON"""

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
    timings_path: Path,
) -> List[Tuple[timedelta, timing_data.LyricMarker]]:
    with timings_path.open("r") as f:
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
    prev_segment: Optional[LyricSegment] = None
    line: Optional[LyricsLine] = None
    screen: Optional[LyricsScreen] = None

    try:
        for event in events:
            ts = event[0]
            marker = event[1]
            if marker == timing_data.LyricMarker.SEGMENT_START:
                segment_text: str = next(segments)
                segment = LyricSegment(segment_text, ts)
                if screen is None:
                    screen = LyricsScreen()
                if line is None:
                    line = LyricsLine()
                line.segments.append(segment)
                if segment_text.endswith("\n"):
                    screen.lines.append(line)
                    line = None
                if segment_text.endswith("\n\n"):
                    screens.append(screen)
                    screen = None
                prev_segment = segment
            elif marker == timing_data.LyricMarker.SEGMENT_END:
                if prev_segment is not None:
                    prev_segment.end_ts = ts
        if line is not None:
            screen.lines.append(line)  # type: ignore[union-attr]
        if screen is not None and len(screen.lines) > 0:
            screens.append(screen)  # type: ignore[arg-type]
    except StopIteration as si:
        logging.error(
            f"Reached end of segments before end of events. Events: {list(events)}, lyrics: {list(segments)}"
        )
    return screens


def advance_screen(screens, screen):
    """Add screen to screens and return a new screen object"""
    screens.append(screen)
    return screens, LyricsScreen()


def subprocess_call(cmd):
    """Executes the given subprocess command."""
    logger = logging.getLogger("shell")
    logger.info("Running:\n>>> " + " ".join(cmd))

    popen_params = {"stdout": sp.DEVNULL, "stderr": sp.PIPE, "stdin": sp.DEVNULL}

    proc = sp.Popen(cmd, **popen_params)

    out, err = proc.communicate()  # proc.wait()
    proc.stderr.close()

    if proc.returncode:
        logger.info("Command returned an error")
        raise IOError(err.decode("utf8"))
    else:
        logger.info("Command successful")

    del proc


def get_metadata_args(metadata: dict) -> list[str]:
    """Get ffmpeg arguments for setting video metadata"""
    result = []
    if metadata.get("artist"):
        result.append("-metadata")
        result.append(f"artist={metadata.get('artist')}")
    if metadata.get("title"):
        result.append("-metadata")
        result.append(f"title={metadata.get('title')}")
    result.append("-metadata")
    result.append("description=Karaoke version created by the-tuul.com")

    return result


def create_video(
    audio_path: Path,
    subtitles: Union[str, ass.ASS],
    output_dir: Path,
    filename: str = "karaoke.mp4",
    audio_delay: float = 0.0,
    metadata: dict = {},
    background_color: str = "#000000",
):
    """
    Run ffmpeg to create the karaoke video.
    """
    ass_path = str(output_dir.joinpath("subtitles.ass"))
    if type(subtitles) == str:
        Path(ass_path).write_text(subtitles)
    else:
        subtitles.write(ass_path)
    video_path = str(output_dir.joinpath(filename))
    audio_delay_ms = int(audio_delay * 1000)  # milliseconds
    video_metadata = get_metadata_args(metadata)
    ffmpeg_cmd = [
        "ffmpeg",
        # Describe a video stream that is a black background
        "-f",
        "lavfi",
        "-i",
        f"color=c=0x{background_color[1:]}:s=1280x720:r=20",
        # Use accompaniment track as audio
        "-i",
        str(audio_path),
        # Set audio delay if needed
        # https://ffmpeg.org/ffmpeg-filters.html#adelay
        "-af",
        f"adelay=delays={audio_delay_ms}:all=1",
        # Re-encode audio as mp3
        "-c:a",
        "libmp3lame",
        # Add subtitles
        "-vf",
        "ass=" + ass_path,
        # End encoding after the shortest stream
        "-shortest",
        # Overwrite files without asking
        "-y",
        *video_metadata,
        # Output path of video
        video_path,
    ]
    subprocess_call(ffmpeg_cmd)
    return True


if __name__ == "__main__":
    run()
