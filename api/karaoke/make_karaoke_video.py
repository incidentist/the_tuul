import logging
from pathlib import Path
import subprocess as sp

import click

from django.conf import settings

from . import music_separation

SONG_ROOT_PATH = "songs/"


def run(
    lyricsfile: Path,
    songfile: Path,
    timingsfile: Path,
    lyric_subtitles: str,
    output_filename: str = "karaoke.mp4",
    audio_delay: float = 0.0,
    metadata: dict = {},
    background_color: str = "#000000",
):
    song_files_dir = songfile.parent
    instrumental_path = song_files_dir.joinpath("accompaniment.wav")
    vocal_path = song_files_dir.joinpath("vocals.wav")

    if instrumental_path.exists() and vocal_path.exists():
        click.echo(f"Using existing instrumental track at {instrumental_path}")
    else:
        click.echo("Splitting song into instrumental and vocal tracks..")
        instrumental_path, vocal_path = music_separation.split_song(
            songfile, song_files_dir
        )
        click.echo(f"Wrote instrumental track to {instrumental_path}")

    fonts_dir = settings.BASE_DIR / "assets" / "fonts"

    return create_video(
        instrumental_path,
        lyric_subtitles,
        output_dir=song_files_dir,
        fonts_dir=fonts_dir,
        filename=output_filename,
        audio_delay=audio_delay,
        metadata=metadata,
        background_color=background_color,
    )


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
    subtitles: str,
    output_dir: Path,
    fonts_dir: Path,
    filename: str = "karaoke.mp4",
    audio_delay: float = 0.0,
    metadata: dict = {},
    background_color: str = "#000000",
):
    """
    Run ffmpeg to create the karaoke video.
    """
    ass_path = output_dir.joinpath("subtitles.ass")
    ass_path.write_text(subtitles)

    video_path = str(output_dir.joinpath(filename))
    audio_delay_ms = int(audio_delay * 1000)  # milliseconds
    video_metadata = get_metadata_args(metadata)
    subtitle_arg = f"ass={ass_path}:fontsdir={str(fonts_dir)}"
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
        subtitle_arg,
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
