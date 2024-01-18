import logging
from pathlib import Path
from typing import Tuple

MODELS_DIR = Path.cwd() / "pretrained_models"


def split_song(songfile: Path, song_dir: Path) -> tuple[Path, Path]:
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
        return songfile.rename(
            song_dir.joinpath("accompaniment.wav")
        ), song_dir.joinpath("vocals.wav")

    separator = Separator(
        str(songfile),
        model_name="UVR_MDXNET_KARA_2",
        output_dir=str(song_dir),
        model_file_dir=MODELS_DIR,
    )
    accompaniment_filename, vocals_filename = separator.separate()
    accompaniment_path = song_dir / accompaniment_filename
    vocals_path = song_dir / vocals_filename
    return accompaniment_path, vocals_path
