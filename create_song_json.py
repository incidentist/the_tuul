import click
import json
from datetime import datetime
import pygame.mixer as mixer
import ass

END_LINE = "end_line"
END_PREV_LINE = "end_prev_line"


@click.command()
@click.option("--lyricsfile", type=click.File("r"), help="File containing lyrics text")
@click.option("--songfile", help="File of song")
@click.option(
    "--outfile", type=click.Path(exists=False), help="File to write JSON out to"
)
def run(lyricsfile, songfile, outfile):
    jsonout = {}
    screenlist = []

    lyrics = lyricsfile.read()
    screens = lyrics.split("\n\n")

    click.echo("Get ready to hit the spacebar when you hear the lyrics start!")
    click.echo()
    click.echo("***")

    mixer.init()
    mixer.music.load(songfile)
    mixer.music.play()
    starttime = datetime.now()

    prev_line = None
    for screen in screens:
        lines = screen.split("\n")
        screenobj = {}
        linelist = []
        for line in lines:
            display_line(line)
            line_ts = get_line_timestamp(line, starttime, prev_line)
            linelist.append(line_ts)
            prev_line = line_ts

        screenobj["lines"] = linelist
        screenlist.append(screenobj)

    jsonout["screens"] = screenlist

    with open(outfile, "w") as of:
        json.dump(jsonout, of)


def display_line(line):
    line = line.strip()
    click.echo(line)


def get_line_timestamp(line, starttime, prev_line):
    (ts, event) = record_timestamp(line, starttime)
    if event == END_PREV_LINE:
        prev_line["end_ts"] = str(ts)
        return get_line_timestamp(line, starttime, prev_line)

    click.echo()
    click.echo("***")
    click.echo()

    data = {"line": line, "ts": str(ts)}

    return data


def get_screen_timestamp(screen, starttime):
    screen = screen.strip()
    lines = screen.split("\n")

    ts = record_timestamp(screen, starttime)

    click.echo()
    click.echo("***")
    click.echo()

    data = {"lines": lines, "ts": str(ts)}

    return data


def record_timestamp(item, starttime):
    char = click.getchar()
    event = None
    if char == " ":
        event = END_LINE
    elif char in "\n\r":
        event = END_PREV_LINE
    print(f"char: {ord(char)}")
    ts = datetime.now() - starttime
    return ts, event


if __name__ == "__main__":
    run()
