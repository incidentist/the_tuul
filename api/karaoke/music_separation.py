import base64
import json
import logging
import subprocess
from enum import Enum
from pathlib import Path
from typing import Optional

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

3. **TCP Method** (_split_song_tcp): Communicates with external separation server via TCP
   - Enables GPU acceleration on remote/host machines
   - Useful for containerized deployments where GPU access is limited
   - Requires a running separator server on localhost

The main split_song() function automatically selects the appropriate method based on parameters.
"""

MODELS_DIR = Path(__file__).parent.parent / "pretrained_models"
DEFAULT_MODEL = "UVR_MDXNET_KARA_2.onnx"

AVAILABLE_MODELS = [
    "UVR_MDXNET_KARA_2.onnx",  # Keeps background vocals
    # "model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt",
    "UVR-MDX-NET-Inst_HQ_3.onnx",  # Removes background vocals
]


class SeparationMethod(Enum):
    API = "api"
    CLI = "cli"
    MODAL_API = "modal_api"


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


def _split_song_tcp(
    songfile: Path, song_dir: Path, model_name: str, host: str, port: int
) -> tuple[Path, Path]:
    """Split song using external separation server via TCP."""
    # Read and encode the input file
    audio_data = songfile.read_bytes()
    audio_base64 = base64.b64encode(audio_data).decode("utf-8")

    # Prepare request payload
    request_data = {
        "model_name": model_name,
        "audio_base64": audio_base64,
        "filename": songfile.name,
    }

    # Make request to separation server via TCP
    try:
        with httpx.Client() as client:
            response = client.post(
                f"http://{host}:{port}/separate", json=request_data, timeout=300
            )
            response.raise_for_status()

        result = response.json()

        if not result.get("success"):
            error_msg = result.get("error", "Unknown error")
            raise RuntimeError(f"Socket separation failed: {error_msg}")

        # Decode and write output files
        vocals_data = base64.b64decode(result["vocals_base64"])
        accompaniment_data = base64.b64decode(result["accompaniment_base64"])

        vocals_path = song_dir / "vocals.wav"
        accompaniment_path = song_dir / "accompaniment.wav"

        vocals_path.write_bytes(vocals_data)
        accompaniment_path.write_bytes(accompaniment_data)

        return accompaniment_path, vocals_path

    except httpx.RequestError as e:
        logging.warning(
            f"Separation server communication failed: {e}, falling back to API method"
        )
        return split_song(songfile, song_dir, model_name, method=SeparationMethod.API)
    except Exception as e:
        logging.warning(f"Separation server error: {e}, falling back to API method")
        return split_song(songfile, song_dir, model_name, method=SeparationMethod.API)


def _split_song_modal_api(
    songfile: Path, song_dir: Path, model_name: str, api_url: str
) -> tuple[Path, Path]:
    """Split song using the remote Modal API separation service with AudioSeparatorAPIClient."""
    try:
        from audio_separator.remote import AudioSeparatorAPIClient
    except ModuleNotFoundError as e:
        logging.error(f"AudioSeparatorAPIClient not available: {e}")
        logging.warning("Falling back to API method")
        return split_song(songfile, song_dir, model_name, method=SeparationMethod.API)

    try:
        # Initialize the API client
        logger = logging.getLogger(__name__)
        api_client = AudioSeparatorAPIClient(api_url, logger)

        # Set up custom output names to match our expected format
        custom_output_names = {
            "Vocals": "vocals",
            "Instrumental": "accompaniment",
        }

        # Separate audio and wait for completion
        result = api_client.separate_audio_and_wait(
            str(songfile),
            model=model_name,
            timeout=600,  # Wait up to 10 minutes
            poll_interval=5,  # Check status every 5 seconds
            download=True,  # Automatically download files
            output_dir=str(song_dir),  # Save files to song directory
            output_format="wav",
            custom_output_names=custom_output_names,
        )

        if result["status"] == "completed":
            logging.info("Modal API separation completed")

            # The files should be downloaded to the song_dir with our custom names
            vocals_path = song_dir / "vocals.wav"
            accompaniment_path = song_dir / "accompaniment.wav"

            # Verify the files exist
            if not vocals_path.exists() or not accompaniment_path.exists():
                raise RuntimeError("Expected output files not found after separation")

            return accompaniment_path, vocals_path
        else:
            error_msg = result.get("error", "Unknown error")
            raise RuntimeError(f"Modal API separation failed: {error_msg}")

    except Exception as e:
        logging.warning(f"Modal API error: {e}, falling back to API method")
        return split_song(songfile, song_dir, model_name, method=SeparationMethod.API)


def split_song(
    songfile: Path,
    song_dir: Path,
    model_name: str = DEFAULT_MODEL,
    method: SeparationMethod = SeparationMethod.API,
    host: Optional[str] = None,
    port: Optional[int] = None,
    modal_api_url: Optional[str] = None,
) -> tuple[Path, Path]:
    """
    Split song into instrumental and vocal tracks.
    Returns paths to accompaniment and vocal tracks.

    Args:
        songfile: Path to the input audio file
        song_dir: Directory to save the separated tracks
        model_name: Name of the separation model to use
        method: SeparationMethod enum value
        host: Host for external separation server
        port: TCP port for external separation server (host+port overrides method if provided)
        api_url: URL for Modal API separation (overrides method if provided)
    """
    _validate_model(model_name)

    # TCP host+port takes precedence over method
    if host and port:
        accompaniment_path, vocals_path = _split_song_tcp(
            songfile, song_dir, model_name, host, port
        )
    elif method == SeparationMethod.API:
        accompaniment_path, vocals_path = _split_song_api(
            songfile, song_dir, model_name
        )
    elif method == SeparationMethod.CLI:
        accompaniment_path, vocals_path = _split_song_cli(
            songfile, song_dir, model_name
        )
    elif method == SeparationMethod.MODAL_API:
        if not modal_api_url:
            raise ValueError(
                "API_URL must be configured in settings or provided as parameter for MODAL_API method"
            )
        accompaniment_path, vocals_path = _split_song_modal_api(
            songfile, song_dir, model_name, modal_api_url
        )
    else:
        raise ValueError(
            f"Invalid method '{method}'. Must be SeparationMethod.API, SeparationMethod.CLI, or SeparationMethod.MODAL_API"
        )

    logging.info(
        f"Got vocals: {vocals_path.name}, Accompaniment: {accompaniment_path.name}"
    )
    return accompaniment_path, vocals_path
