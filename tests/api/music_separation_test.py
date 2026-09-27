import base64
import tempfile
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

import httpx2 as httpx
import pytest

from api import settings
from karaoke.music_separation import (
    split_song,
    DEFAULT_MODEL,
    SeparationError,
    SeparationMethod,
)


@pytest.fixture
def audio_file():
    """Fixture providing a test audio file."""
    return Path(__file__).parent.parent.parent / "api/staticroot/understand/audio.m4a"


@pytest.fixture
def temp_output_dir():
    """Fixture providing a temporary output directory."""
    with tempfile.TemporaryDirectory() as temp_dir:
        yield Path(temp_dir)


def test_split_song_api_method(audio_file, temp_output_dir):
    """Test split_song with SeparationMethod.API."""
    with mock.patch("audio_separator.separator.Separator") as mock_separator:
        mock_instance = mock_separator.return_value
        mock_instance.separate.return_value = None

        # Create expected output files
        (temp_output_dir / "vocals.wav").write_text("mock vocals")
        (temp_output_dir / "accompaniment.wav").write_text("mock accompaniment")

        accompaniment_path, vocals_path = split_song(
            audio_file, temp_output_dir, DEFAULT_MODEL, method=SeparationMethod.API
        )

        # Verify paths are correct
        assert accompaniment_path == temp_output_dir / "accompaniment.wav"
        assert vocals_path == temp_output_dir / "vocals.wav"
        assert accompaniment_path.exists()
        assert vocals_path.exists()

        # Verify separator was called correctly
        mock_separator.assert_called_once_with(
            output_dir=str(temp_output_dir),
            model_file_dir=mock.ANY,
        )
        mock_instance.load_model.assert_called_once_with(DEFAULT_MODEL)
        mock_instance.separate.assert_called_once_with(
            str(audio_file), {"Vocals": "vocals", "Instrumental": "accompaniment"}
        )


def test_split_song_subprocess_method(audio_file, temp_output_dir):
    """Test split_song with subprocess method."""
    with mock.patch("subprocess.run") as mock_run:
        mock_run.return_value.stdout = "separation complete"

        # Create expected output files
        (temp_output_dir / "vocals.wav").write_text("mock vocals")
        (temp_output_dir / "accompaniment.wav").write_text("mock accompaniment")

        accompaniment_path, vocals_path = split_song(
            audio_file, temp_output_dir, DEFAULT_MODEL, method=SeparationMethod.CLI
        )

        # Verify paths are correct
        assert accompaniment_path == temp_output_dir / "accompaniment.wav"
        assert vocals_path == temp_output_dir / "vocals.wav"
        assert accompaniment_path.exists()
        assert vocals_path.exists()

        # Verify subprocess was called correctly
        mock_run.assert_called_once()
        call_args = mock_run.call_args[0][0]
        assert call_args[0] == "audio-separator"
        assert str(audio_file) in call_args
        assert "--output_dir" in call_args
        assert str(temp_output_dir) in call_args
        assert "--model_filename" in call_args
        assert DEFAULT_MODEL in call_args
        assert "--custom_output_names" in call_args


def test_split_song_invalid_method(audio_file, temp_output_dir):
    """Test split_song with invalid method raises ValueError."""
    with pytest.raises(ValueError, match="Invalid method 'invalid'"):
        split_song(audio_file, temp_output_dir, DEFAULT_MODEL, method="invalid")


def test_split_song_invalid_model(audio_file, temp_output_dir):
    """Test split_song with invalid model raises ValueError."""
    with pytest.raises(ValueError, match="Model invalid_model not found"):
        split_song(audio_file, temp_output_dir, "invalid_model")


def test_split_song_both_methods_same_output(audio_file, temp_output_dir):
    """Test that both methods produce the same output structure."""
    with mock.patch("audio_separator.separator.Separator") as mock_separator:
        mock_instance = mock_separator.return_value
        mock_instance.separate.return_value = None

        with mock.patch("subprocess.run") as mock_run:
            mock_run.return_value.stdout = "separation complete"

            # Create output files for both tests
            (temp_output_dir / "vocals.wav").write_text("mock vocals")
            (temp_output_dir / "accompaniment.wav").write_text("mock accompaniment")

            # Test library method
            lib_accompaniment, lib_vocals = split_song(
                audio_file, temp_output_dir, DEFAULT_MODEL, method=SeparationMethod.API
            )

            # Clean up files for second test
            (temp_output_dir / "vocals.wav").unlink()
            (temp_output_dir / "accompaniment.wav").unlink()
            (temp_output_dir / "vocals.wav").write_text("mock vocals")
            (temp_output_dir / "accompaniment.wav").write_text("mock accompaniment")

            # Test subprocess method
            sub_accompaniment, sub_vocals = split_song(
                audio_file, temp_output_dir, DEFAULT_MODEL, method=SeparationMethod.CLI
            )

            # Verify both methods return the same paths
            assert lib_accompaniment == sub_accompaniment
            assert lib_vocals == sub_vocals
            assert lib_accompaniment.name == "accompaniment.wav"
            assert lib_vocals.name == "vocals.wav"


def test_split_song_subprocess_command_not_found(audio_file, temp_output_dir):
    """Test subprocess method when audio-separator command is not found."""
    with mock.patch("subprocess.run", side_effect=FileNotFoundError()):
        with pytest.raises(FileNotFoundError):
            split_song(
                audio_file, temp_output_dir, DEFAULT_MODEL, method=SeparationMethod.CLI
            )


def test_split_song_subprocess_command_fails(audio_file, temp_output_dir):
    """Test subprocess method when audio-separator command fails."""
    import subprocess

    with mock.patch("subprocess.run") as mock_run:
        mock_run.side_effect = subprocess.CalledProcessError(
            1, "audio-separator", stderr="Error"
        )

        with pytest.raises(subprocess.CalledProcessError):
            split_song(
                audio_file, temp_output_dir, DEFAULT_MODEL, method=SeparationMethod.CLI
            )


def _separator_response(vocals: bytes, accompaniment: bytes) -> mock.Mock:
    """Build a mock httpx response mimicking a successful separator server reply."""
    response = mock.Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "success": True,
        "vocals_base64": base64.b64encode(vocals).decode("utf-8"),
        "accompaniment_base64": base64.b64encode(accompaniment).decode("utf-8"),
    }
    return response


@contextmanager
def _mock_separator_post(response=None, side_effect=None):
    """Patch the httpx client's post, the one call that leaves the process."""
    with mock.patch("karaoke.music_separation.httpx.Client") as mock_client:
        post = mock_client.return_value.__enter__.return_value.post
        if side_effect is not None:
            post.side_effect = side_effect
        else:
            post.return_value = response
        yield post


def test_split_song_compose_provider_writes_returned_audio(audio_file, temp_output_dir):
    """COMPOSE_PROVIDER decodes the server's response into vocals/accompaniment."""
    with mock.patch.object(
        settings, "SEPARATOR_URL", "http://host.docker.internal:8001"
    ):
        with _mock_separator_post(
            _separator_response(b"vocal-audio", b"accompaniment-audio")
        ) as post:
            accompaniment_path, vocals_path = split_song(
                audio_file,
                temp_output_dir,
                DEFAULT_MODEL,
                method=SeparationMethod.COMPOSE_PROVIDER,
            )

    assert vocals_path.read_bytes() == b"vocal-audio"
    assert accompaniment_path.read_bytes() == b"accompaniment-audio"
    assert post.call_args.args[0] == "http://host.docker.internal:8001/separate"
    assert post.call_args.kwargs["json"]["model_name"] == DEFAULT_MODEL


def test_split_song_compose_provider_requires_separator_url(
    audio_file, temp_output_dir
):
    """Without SEPARATOR_URL the provider clearly wasn't wired up; say so."""
    with mock.patch.object(settings, "SEPARATOR_URL", ""):
        with pytest.raises(SeparationError, match="SEPARATOR_URL is not set"):
            split_song(
                audio_file,
                temp_output_dir,
                DEFAULT_MODEL,
                method=SeparationMethod.COMPOSE_PROVIDER,
            )


def test_split_song_compose_provider_raises_when_unreachable(
    audio_file, temp_output_dir
):
    """An unreachable separator raises rather than silently falling back to CPU."""
    with mock.patch.object(
        settings, "SEPARATOR_URL", "http://host.docker.internal:8001"
    ):
        with _mock_separator_post(side_effect=httpx.ConnectError("refused")):
            with pytest.raises(SeparationError, match="unreachable"):
                split_song(
                    audio_file,
                    temp_output_dir,
                    DEFAULT_MODEL,
                    method=SeparationMethod.COMPOSE_PROVIDER,
                )


def test_split_song_compose_provider_raises_on_server_error(
    audio_file, temp_output_dir
):
    """A server-reported failure surfaces the server's own error message."""
    response = mock.Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"success": False, "error": "model exploded"}

    with mock.patch.object(
        settings, "SEPARATOR_URL", "http://host.docker.internal:8001"
    ):
        with _mock_separator_post(response):
            with pytest.raises(SeparationError, match="model exploded"):
                split_song(
                    audio_file,
                    temp_output_dir,
                    DEFAULT_MODEL,
                    method=SeparationMethod.COMPOSE_PROVIDER,
                )


def test_split_song_compose_provider_waits_hours_but_connects_fast(
    audio_file, temp_output_dir
):
    """The separator queues requests, so the answer can take hours to arrive;
    but a server that is up accepts the connection right away."""
    with mock.patch.object(
        settings, "SEPARATOR_URL", "http://host.docker.internal:8001"
    ):
        with _mock_separator_post(_separator_response(b"v", b"a")) as post:
            split_song(
                audio_file,
                temp_output_dir,
                DEFAULT_MODEL,
                method=SeparationMethod.COMPOSE_PROVIDER,
            )

    timeout = post.call_args.kwargs["timeout"]
    assert timeout.read == settings.SEPARATOR_TIMEOUT_SECONDS
    assert timeout.connect < 60


def test_split_song_compose_provider_raises_when_the_queue_is_full(
    audio_file, temp_output_dir
):
    """A full separator queue is reported as such, not as a generic HTTP error."""
    response = mock.Mock()
    response.status_code = 503

    with mock.patch.object(
        settings, "SEPARATOR_URL", "http://host.docker.internal:8001"
    ):
        with _mock_separator_post(response):
            with pytest.raises(SeparationError, match="queue is full"):
                split_song(
                    audio_file,
                    temp_output_dir,
                    DEFAULT_MODEL,
                    method=SeparationMethod.COMPOSE_PROVIDER,
                )


@pytest.mark.parametrize(
    "method,in_process",
    [
        (SeparationMethod.API, True),
        (SeparationMethod.CLI, True),
        (SeparationMethod.COMPOSE_PROVIDER, False),
    ],
)
def test_runs_in_process(method, in_process):
    assert method.runs_in_process is in_process
