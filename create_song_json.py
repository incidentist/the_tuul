from datetime import timedelta
from typing import Tuple, List
from pathlib import Path
import json
from datetime import datetime

import click

import timing_data

# import pygame.mixer as mixer

END_LINE = "end_line"
END_PREV_LINE = "end_prev_line"


@click.command()
@click.option("--lyricsfile", type=click.File("r"), help="File containing lyrics text")
@click.option(
    "--songfile", type=click.Path(exists=True, dir_okay=False), help="File of song"
)
@click.option(
    "--outfile", type=click.Path(exists=False), help="File to write JSON out to"
)
@click.option(
    "--instrumental_path", type=click.Path(exists=True, dir_okay=False), required=False
)
def run(lyricsfile, songfile, outfile, instrumental_path=None):
    songpath = Path(songfile)
    jsonout = {}
    screenlist = []

    if not instrumental_path:
        click.echo("Creating instrumental track...")
        (instrumental_path, vocal_path) = split_song(songpath)
        print(instrumental_path, vocal_path)
        click.echo(f"Wrote instrumental track to {instrumental_path}")
    jsonout["song_file"] = str(instrumental_path)

    lyrics = lyricsfile.read()
    lyric_events = timing_data.gather_timing_data(lyrics, songpath)
    compile_lyric_timings(lyrics, lyric_events)

    prev_line = None
    for screen in screens:
        lines = screen.split("\n")
        screenobj = {}
        linelist = []
        click.echo("\n")
        for line in lines:
            display_line(line)
            line_ts = get_line_timestamp(line, starttime, prev_line)
            linelist.append(line_ts)
            prev_line = line_ts

        screenobj["lines"] = linelist
        screenlist.append(screenobj)

    set_last_line_end(starttime, prev_line)

    jsonout["screens"] = screenlist

    stop_track()

    with open(outfile, "w") as of:
        json.dump(jsonout, of, indent=2)


def compile_lyric_timings(
    lyrics: str, events: List[Tuple[timedelta, timing_data.LyricMarker]]
):
    lines = iter(lyrics.split("\n"))
    screens = []
    prev_line = None
    screen = []
    events = iter(events)
    line = None
    while True:
        if line is None:
            line = next(lines)
        event = next(events)


def split_song(songfile: Path) -> Tuple[Path, Path]:
    """ Run spleeter to split song into instrumental and vocal tracks """
    from spleeter.separator import Separator

    song_dir = songfile.resolve().with_suffix("")
    print(song_dir)
    separator = Separator("spleeter:2stems")
    separator.separate_to_file(
        str(songfile), str(song_dir), filename_format="{instrument}.{codec}"
    )
    return song_dir.joinpath("accompaniment.wav"), song_dir.joinpath("vocals.wav")


def display_line(line):
    line = line.strip()
    click.echo(line)


def get_line_timestamp(line, starttime, prev_line):
    (ts, event) = record_timestamp(starttime)
    if event == END_PREV_LINE:
        prev_line["end_ts"] = str(ts)
        return get_line_timestamp(line, starttime, prev_line)

    data = {"line": line, "ts": str(ts)}

    return data


def get_screen_timestamp(screen, starttime):
    screen = screen.strip()
    lines = screen.split("\n")

    ts = record_timestamp(screen, starttime)
    data = {"lines": lines, "ts": str(ts)}

    return data


def record_timestamp(starttime):
    char = click.getchar()
    event = None
    if char == " ":
        event = END_LINE
    elif char in "\n\r":
        event = END_PREV_LINE
    else:
        event = char
    ts = datetime.now() - starttime
    return ts, event


def set_last_line_end(starttime, prev_line):
    click.echo("Press any key when the last line ends")
    ts, event = record_timestamp(starttime)
    prev_line["end_ts"] = str(ts)


if __name__ == "__main__":
    run()
