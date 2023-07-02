import logging
from pathlib import Path
from typing import Tuple

MODELS_DIR = Path.cwd() / "pretrained_models"


def split_song(songfile: Path, song_dir: Path) -> Tuple[str, str]:
    """
    Split song into instrumental and vocal tracks.
    Returns paths to accompaniment and vocal tracks.
    """
    try:
        from audio_separator import Separator
    except ModuleNotFoundError:
        logging.warning(
            "Spleeter not found. I assume we're testing. Gonna use the original song."
        )
        return str(songfile.rename(song_dir.joinpath("accompaniment.wav")))

    separator = Separator(
        str(songfile),
        model_name="UVR_MDXNET_KARA_2",
        output_dir=str(song_dir),
        model_file_dir=MODELS_DIR,
    )
    accompaniment_filename, vocals_filename = separator.separate()
    return song_dir / accompaniment_filename, song_dir / vocals_filename
