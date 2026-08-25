from pathlib import Path

import pytest
import pytubefix

from api.helpers import youtube_helper


def test_get_youtube_streams():
    url = "https://www.youtube.com/watch?v=jVFIbpZA04I"
    song_files_dir = Path("tests/song_files")
    metadata, audio_path, video_path = youtube_helper.get_youtube_streams(
        url, song_files_dir
    )


def test_assemble_metadata():
    url = "https://www.youtube.com/watch?v=jVFIbpZA04I"
    youtube = pytubefix.YouTube(url)
    metadata = youtube_helper.assemble_metadata(youtube)
    assert "title" in metadata
    assert metadata["title"] == youtube.title


def test_get_video_id():
    """Test extracting video ID from various YouTube URL formats."""
    test_cases = [
        ("https://www.youtube.com/watch?v=jVFIbpZA04I", "jVFIbpZA04I"),
        ("https://youtu.be/jVFIbpZA04I", "jVFIbpZA04I"),
        ("https://www.youtube.com/embed/jVFIbpZA04I", "jVFIbpZA04I"),
        ("https://www.youtube.com/watch?v=jVFIbpZA04I&t=30s", "jVFIbpZA04I"),
    ]

    for url, expected_id in test_cases:
        video_id = youtube_helper.get_video_id(url)
        assert video_id == expected_id

    with pytest.raises(ValueError, match="Invalid YouTube URL"):
        youtube_helper.get_video_id("https://youtube.com/watch?v=invalid")

    with pytest.raises(ValueError, match="Invalid YouTube URL"):
        youtube_helper.get_video_id("invalid-url")


def test_get_youtube_streams_wraps_arbitrary_errors(monkeypatch):
    """Non-URLError failures (e.g. pytubefix internals breaking when YouTube
    changes) must surface as YouTubeException, not escape uncaught."""

    class BotDetection(Exception):
        pass

    def boom(*args, **kwargs):
        raise BotDetection("Sign in to confirm you're not a bot")

    monkeypatch.setattr(youtube_helper.pytube, "YouTube", boom)

    with pytest.raises(youtube_helper.YouTubeException) as excinfo:
        youtube_helper.get_youtube_streams(
            "https://www.youtube.com/watch?v=jVFIbpZA04I", Path("tests/song_files")
        )

    assert "BotDetection" in str(excinfo.value)
    assert "not a bot" in str(excinfo.value)


def test_background_download_writes_error_file_on_youtube_exception(monkeypatch):
    """A failed download must upload an error file so the polling client stops."""
    written = {}

    def fake_write_async_error(message, filename):
        written["message"] = message
        written["filename"] = filename

    def fail(*args, **kwargs):
        raise youtube_helper.YouTubeException("yt-dlp is out of date")

    monkeypatch.setattr(youtube_helper, "write_async_error", fake_write_async_error)
    monkeypatch.setattr(youtube_helper, "download_and_zip_youtube", fail)

    youtube_helper.process_youtube_download_background("vid123", "https://yt/vid123")

    assert written["filename"] == "vid123"
    assert "out of date" in written["message"]


def test_background_download_writes_error_file_on_unexpected_error(monkeypatch):
    """Errors outside get_youtube_streams (zip, upload) must also write an error
    file rather than leaving the client polling forever."""
    written = {}

    def fake_write_async_error(message, filename):
        written["message"] = message
        written["filename"] = filename

    def fail(*args, **kwargs):
        raise RuntimeError("GCS upload exploded")

    monkeypatch.setattr(youtube_helper, "write_async_error", fake_write_async_error)
    monkeypatch.setattr(youtube_helper, "download_and_zip_youtube", fail)

    youtube_helper.process_youtube_download_background("vid456", "https://yt/vid456")

    assert written["filename"] == "vid456"
    assert "RuntimeError" in written["message"]
    assert "GCS upload exploded" in written["message"]


def test_background_download_survives_error_upload_failure(monkeypatch):
    """If writing the error file itself fails, the task must not raise."""

    def fail_download(*args, **kwargs):
        raise youtube_helper.YouTubeException("download failed")

    def fail_write(*args, **kwargs):
        raise RuntimeError("bucket unreachable")

    monkeypatch.setattr(youtube_helper, "download_and_zip_youtube", fail_download)
    monkeypatch.setattr(youtube_helper, "write_async_error", fail_write)

    youtube_helper.process_youtube_download_background("vid789", "https://yt/vid789")
