from datetime import timedelta
from typing import Tuple, List, Dict, Union, Any, Optional
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
def run(lyricsfile, songfile, outfile: str, instrumental_path: str = None):
    songpath = Path(songfile)

    if not instrumental_path:
        click.echo("Creating instrumental track...")
        (instrumental_path, vocal_path) = split_song(songpath)
        print(instrumental_path, vocal_path)
        click.echo(f"Wrote instrumental track to {instrumental_path}")

    lyrics = lyricsfile.read()
    lyric_events = timing_data.gather_timing_data(lyrics, songpath)
    screens = compile_lyric_timings(lyrics, lyric_events)

    write_outfile(outfile, instrumental_path, screens)


class TimedeltaEncoder(json.JSONEncoder):
    """Adds ability to encode timedeltas to JSON """

    def default(self, obj):
        if isinstance(obj, timedelta):
            return str(obj)

        return super(TimedeltaEncoder, self).default(obj)


def write_outfile(
    outfile: str, instrumental_path: Union[str, Path], screens: List[List[Dict]]
):
    jsonout = {"song_file": str(instrumental_path), "screens": screens}

    with open(outfile, "w") as of:
        json.dump(jsonout, of, indent=2, cls=TimedeltaEncoder)


def compile_lyric_timings(
    lyrics: str, events: List[Tuple[timedelta, timing_data.LyricMarker]]
) -> List[List[Dict[str, Union[str, timedelta]]]]:
    """
    Read keyboard events in the order they were pressed and construct
    objects for screens and lines that include the given timing information.
    """
    lines = iter(lyrics.split("\n"))
    events = iter(events)
    screens: List[List[Dict[str, Any]]] = []
    prev_line_obj: Optional[Dict[str, Any]] = None
    screen: List[Dict[str, Any]] = []

    for event in events:
        ts = event[0]
        marker = event[1]
        if marker == timing_data.LyricMarker.SEGMENT_START:
            line = next(lines)
            if line == "":
                screens, screen = advance_screen(screens, screen)
                line = next(lines)
            line_obj = {"text": line, "ts": ts}
            screen.append(line_obj)
            prev_line_obj = line_obj
        elif marker == timing_data.LyricMarker.SEGMENT_END:
            if prev_line_obj is not None:
                prev_line_obj["end_ts"] = ts

    return screens


def advance_screen(screens, screen):
    """ Add screen to screens and return a new screen object """
    screens.append(screen)
    return screens, []


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


if __name__ == "__main__":
    run()
