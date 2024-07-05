import logging
from pathlib import Path
from typing import Tuple

MODELS_DIR = Path.cwd() / "pretrained_models"
# Use this one to remove vocals completely
# MODEL_NAME = "UVR-MDX-NET-Inst_HQ_3.onnx"
DEFAULT_MODEL = "UVR_MDXNET_KARA_2.onnx"

AVAILABLE_MODELS = [
    "UVR_MDXNET_KARA_2.onnx",  # Keeps background vocals
    "UVR-MDX-NET-Inst_HQ_3.onnx",  # Removes background vocals
]


def split_song(
    songfile: Path, song_dir: Path, model_name: str = DEFAULT_MODEL
) -> tuple[Path, Path]:
    """
    Split song into instrumental and vocal tracks.
    Returns paths to accompaniment and vocal tracks.
    """
    try:
        from audio_separator.separator import Separator
    except ModuleNotFoundError as e:
        logging.error(e)
        logging.warning(
            "audio_separator not found. I assume we're testing. Gonna use the original song."
        )
        return songfile.rename(
            song_dir.joinpath("accompaniment.wav")
        ), song_dir.joinpath("vocals.wav")

    if model_name not in AVAILABLE_MODELS:
        raise ValueError(
            f"Model {model_name} not found. Available models: {AVAILABLE_MODELS}"
        )

    separator = Separator(
        output_dir=str(song_dir),
        model_file_dir=MODELS_DIR,
    )

    separator.load_model(model_name)

    vocals_filename, accompaniment_filename = separator.separate(str(songfile))
    accompaniment_path = song_dir / accompaniment_filename
    vocals_path = song_dir / vocals_filename
    return accompaniment_path, vocals_path
