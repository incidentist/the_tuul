import base64
import json
import logging
import subprocess
from enum import Enum
from pathlib import Path

import httpx2 as httpx

from api import settings

"""
Music Separation Module

This module provides multiple methods for separating audio tracks into vocals and accompaniment:

1. **API Method** (_split_song_api): Uses the audio-separator Python library directly
   - Fastest for development and testing
   - Limited to available system memory
   - Runs in the current Python process

2. **CLI Method** (_split_song_cli): Uses the audio-separator command-line tool
   - Better memory management through subprocess isolation
   - Consistent with production deployment patterns
   - Requires audio-separator CLI to be installed

3. **Compose Provider Method** (_split_song_compose_provider): Calls a separator
   server that a Docker Compose provider runs as a *host* process
   - The separator runs outside the container, so it can reach the host GPU
     (on macOS, onnxruntime's CoreML execution provider). Linux containers
     cannot reach Metal at all, so in-container separation is always CPU-bound.
   - The provider in infra/compose-separation-provider/ starts the host process and emits
     a `setenv` message; Compose injects the result as SEPARATOR_URL into any
     service that `depends_on` it.
   - See infra/compose.selfhosted.host-gpu.yaml.

The main split_song() function selects the method based on the `method` parameter.
"""

MODELS_DIR = Path(__file__).parent.parent / "pretrained_models"
DEFAULT_MODEL = "UVR_MDXNET_KARA_2.onnx"

AVAILABLE_MODELS = [
    "UVR_MDXNET_KARA_2.onnx",  # Keeps background vocals
    # "model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt",
    "UVR-MDX-NET-Inst_HQ_3.onnx",  # Removes background vocals
]

# How long to wait to connect to the separator server. Separation itself can
# take hours to come back (see settings.SEPARATOR_TIMEOUT_SECONDS), but a
# server that is up accepts the connection immediately.
SEPARATOR_CONNECT_TIMEOUT_SECONDS = 10


class SeparationMethod(Enum):
    API = "api"
    CLI = "cli"
    COMPOSE_PROVIDER = "compose_provider"

    @property
    def runs_in_process(self) -> bool:
        """Whether this method separates in the calling process, as opposed to
        handing the work to a separator server that queues it itself."""
        return self in (SeparationMethod.API, SeparationMethod.CLI)


class SeparationError(RuntimeError):
    """Raised when separation fails and there is no usable result."""


def _validate_model(model_name: str) -> None:
    """Validate that the model name is in the list of available models."""
    if model_name not in AVAILABLE_MODELS:
        raise ValueError(
            f"Model {model_name} not found. Available models: {AVAILABLE_MODELS}"
        )


def _get_output_paths(song_dir: Path) -> tuple[Path, Path]:
    """Get the expected output file paths for vocals and accompaniment."""
    vocals_path = song_dir / "vocals.wav"
    accompaniment_path = song_dir / "accompaniment.wav"
    return accompaniment_path, vocals_path


def _split_song_api(
    songfile: Path, song_dir: Path, model_name: str
) -> tuple[Path, Path]:
    """Split song using the audio_separator Python API."""
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

    separator = Separator(
        output_dir=str(song_dir),
        model_file_dir=str(MODELS_DIR),
    )

    separator.load_model(model_name)

    output_names = {
        "Vocals": "vocals",
        "Instrumental": "accompaniment",
    }

    separator.separate(str(songfile), output_names)

    return _get_output_paths(song_dir)


def _split_song_cli(
    songfile: Path, song_dir: Path, model_name: str
) -> tuple[Path, Path]:
    """Split song using the audio-separator command-line tool."""
    output_names = {
        "Vocals": "vocals",
        "Instrumental": "accompaniment",
    }

    cmd = [
        "audio-separator",
        str(songfile),
        "--output_dir",
        str(song_dir),
        "--model_file_dir",
        str(MODELS_DIR),
        "--model_filename",
        model_name,
        "--custom_output_names",
        json.dumps(output_names),
    ]

    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        logging.info(f"audio-separator output: {result.stdout}")
    except subprocess.CalledProcessError as e:
        logging.error(f"audio-separator failed: {e.stderr}")
        raise
    except FileNotFoundError:
        logging.error(
            "audio-separator command not found. Please install audio-separator CLI tool."
        )
        raise

    return _get_output_paths(song_dir)


def _split_song_http(
    songfile: Path, song_dir: Path, model_name: str, base_url: str
) -> tuple[Path, Path]:
    """Split song by POSTing it to a separator server at `base_url`.

    The server runs separations one at a time, so this can wait behind a long
    queue before the response comes back.

    Raises SeparationError if the server is unreachable, its queue is full, or
    it reports failure.
    """
    audio_base64 = base64.b64encode(songfile.read_bytes()).decode("utf-8")

    request_data = {
        "model_name": model_name,
        "audio_base64": audio_base64,
        "filename": songfile.name,
    }

    try:
        with httpx.Client() as client:
            response = client.post(
                f"{base_url.rstrip('/')}/separate",
                json=request_data,
                timeout=httpx.Timeout(
                    settings.SEPARATOR_TIMEOUT_SECONDS,
                    connect=SEPARATOR_CONNECT_TIMEOUT_SECONDS,
                ),
            )
            if response.status_code == 503:
                raise SeparationError(
                    f"Separator server at {base_url} is busy: its queue is full"
                )
            response.raise_for_status()
    except httpx.HTTPError as e:
        raise SeparationError(
            f"Separator server at {base_url} is unreachable: {e}"
        ) from e

    result = response.json()

    if not result.get("success"):
        raise SeparationError(
            f"Separator server reported failure: {result.get('error', 'Unknown error')}"
        )

    accompaniment_path, vocals_path = _get_output_paths(song_dir)
    vocals_path.write_bytes(base64.b64decode(result["vocals_base64"]))
    accompaniment_path.write_bytes(base64.b64decode(result["accompaniment_base64"]))

    return accompaniment_path, vocals_path


def _split_song_compose_provider(
    songfile: Path, song_dir: Path, model_name: str
) -> tuple[Path, Path]:
    """Split song using the separator host process started by the Compose provider.

    Compose injects SEPARATOR_URL into this service because it declares
    `depends_on` the provider service. There is deliberately no fallback to
    in-process separation: the point of the provider is host GPU access, and
    quietly separating on the container's CPU instead would hide a broken
    provider behind a much slower result.
    """
    if not settings.SEPARATOR_URL:
        raise SeparationError(
            "SEPARATOR_URL is not set. The separator is started by the Compose "
            "provider in infra/compose-separation-provider/; make sure this "
            "service declares "
            "`depends_on: [separator]` and that you are running with "
            "infra/compose.selfhosted.host-gpu.yaml layered on "
            "infra/compose.selfhosted.yaml."
        )

    return _split_song_http(songfile, song_dir, model_name, settings.SEPARATOR_URL)


def split_song(
    songfile: Path,
    song_dir: Path,
    model_name: str = DEFAULT_MODEL,
    method: SeparationMethod = SeparationMethod.API,
) -> tuple[Path, Path]:
    """
    Split song into instrumental and vocal tracks.
    Returns paths to accompaniment and vocal tracks.

    Args:
        songfile: Path to the input audio file
        song_dir: Directory to save the separated tracks
        model_name: Name of the separation model to use
        method: SeparationMethod enum value
    """
    _validate_model(model_name)

    if method == SeparationMethod.API:
        accompaniment_path, vocals_path = _split_song_api(
            songfile, song_dir, model_name
        )
    elif method == SeparationMethod.CLI:
        accompaniment_path, vocals_path = _split_song_cli(
            songfile, song_dir, model_name
        )
    elif method == SeparationMethod.COMPOSE_PROVIDER:
        accompaniment_path, vocals_path = _split_song_compose_provider(
            songfile, song_dir, model_name
        )
    else:
        raise ValueError(
            f"Invalid method '{method}'. Must be one of: "
            f"{', '.join(m.name for m in SeparationMethod)}"
        )

    logging.info(
        f"Got vocals: {vocals_path.name}, Accompaniment: {accompaniment_path.name}"
    )
    return accompaniment_path, vocals_path
