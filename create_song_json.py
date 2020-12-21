import click
import json
from datetime import datetime
import pygame.mixer as mixer

@click.command()
@click.option('--lyricsfile', type=click.File("r"), help = 'File containing lyrics text')
@click.option('--songfile', help = 'File of song')
@click.option('--outfile', type=click.Path(exists=False), help = 'File to write JSON out to')
def run(lyricsfile, songfile, outfile):
    jsonout = {}
    screenlist = []
    
    lyrics = lyricsfile.read()
    screens = lyrics.split('\n\n')

    click.echo("Get ready to hit the spacebar when you hear the lyrics start!")
    click.echo()
    click.echo("***")

    mixer.init()
    mixer.music.load(songfile)
    mixer.music.play()
    starttime = datetime.now()
    
    for screen in screens:
        lines = screen.split("\n")
        screenobj = {}
        linelist = []
        for line in lines:

            line_ts = get_line_timestamp(line, starttime)
            linelist.append(line_ts)
        
        screenobj["lines"] = linelist
        screenlist.append(screenobj)
        
    jsonout["screens"] = screenlist

    with open(outfile, 'w') as of:
        json.dump(jsonout, of)

def get_line_timestamp(line, starttime):

    line = line.strip()
    ts = record_timestamp(line, starttime)

    click.echo()
    click.echo("***")
    click.echo()

    data = {"line":line, "ts":str(ts)}
    
    return data

def get_screen_timestamp(screen, starttime):
    screen = screen.strip()
    lines = screen.split("\n")

    ts = record_timestamp(screen, starttime)

    click.echo()
    click.echo("***")
    click.echo()

    data = {"lines":lines, "ts":str(ts)}
    
    return data

def record_timestamp(item, starttime):
    click.echo(item)
    click.pause(info=False) 
    ts = datetime.now() - starttime
    return ts

if __name__ == '__main__':
    run()
