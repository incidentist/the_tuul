from pathlib import Path
from types import SimpleNamespace

import pytest

from api.helpers import youtube_helper


def test_get_youtube_streams():
    url = "https://www.youtube.com/watch?v=jVFIbpZA04I"
    song_files_dir = Path("tests/song_files")
    metadata, audio_path, video_path = youtube_helper.get_youtube_streams(
        url, song_files_dir
    )


def test_assemble_metadata():
    """assemble_metadata only maps fields, so it needs no live YouTube call."""
    youtube = SimpleNamespace(
        title="Tongue Tied",
        author="Grouplove",
        length=217,
        rating=4.8,
        views=12345,
        keywords=["indie", "rock"],
        description="A song.",
    )

    metadata = youtube_helper.assemble_metadata(youtube)

    assert metadata == {
        "title": "Tongue Tied",
        "author": "Grouplove",
        "length": 217,
        "rating": 4.8,
        "views": 12345,
        "keywords": ["indie", "rock"],
        "description": "A song.",
    }


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


class FakeStream:
    """Stands in for a pytubefix Stream, writing a file on download()."""

    def __init__(self, fail_on_download=None):
        self.fail_on_download = fail_on_download

    def download(self, output_path, filename, *args, **kwargs):
        if self.fail_on_download:
            raise self.fail_on_download
        path = Path(output_path) / filename
        path.write_bytes(b"fake media")
        return str(path)


class FakeStreamQuery:
    def __init__(self, stream):
        self.stream = stream

    def filter(self, **kwargs):
        return self

    def first(self):
        return self.stream


class FakeYouTube:
    """Minimal pytubefix.YouTube stand-in keyed by client."""

    def __init__(self, url, client=None, proxies=None, behavior=None, **kwargs):
        self.client = client
        behavior = behavior or {}
        outcome = behavior.get(client)
        if isinstance(outcome, Exception):
            raise outcome
        self.streams = FakeStreamQuery(FakeStream())
        self.title = "Fake Song"
        self.author = "Fake Artist"
        self.length = 100
        self.rating = None
        self.views = 5
        self.keywords = []
        self.description = "desc"


def _patch_youtube(monkeypatch, behavior, attempts):
    def factory(url, client=None, proxies=None, **kwargs):
        attempts.append(client)
        return FakeYouTube(url, client=client, proxies=proxies, behavior=behavior)

    monkeypatch.setattr(youtube_helper.pytube, "YouTube", factory)


def test_first_client_succeeds_without_trying_others(monkeypatch, tmp_path):
    """A working first client must short-circuit the rest of the chain."""
    attempts = []
    _patch_youtube(monkeypatch, {}, attempts)

    metadata, audio_path, video_path = youtube_helper.get_youtube_streams(
        "https://youtu.be/abc", tmp_path
    )

    assert attempts == ["WEB_MUSIC"]
    assert metadata["title"] == "Fake Song"
    assert audio_path.exists() and video_path.exists()


def test_falls_back_to_next_client(monkeypatch, tmp_path):
    """WEB_MUSIC returns VideoUnavailable for non-music videos; WEB must run."""
    attempts = []
    _patch_youtube(
        monkeypatch, {"WEB_MUSIC": ValueError("VideoUnavailable")}, attempts
    )

    metadata, audio_path, video_path = youtube_helper.get_youtube_streams(
        "https://youtu.be/abc", tmp_path
    )

    assert attempts == ["WEB_MUSIC", "WEB"]
    assert audio_path.exists()


def test_all_clients_failing_raises_with_each_error(monkeypatch, tmp_path):
    """The message must name every client tried, for diagnosis from logs."""
    attempts = []
    _patch_youtube(
        monkeypatch,
        {
            "WEB_MUSIC": ValueError("VideoUnavailable"),
            "WEB": RuntimeError("SABRError"),
            "MWEB": RuntimeError("HTTPError 403"),
        },
        attempts,
    )

    with pytest.raises(youtube_helper.YouTubeException) as excinfo:
        youtube_helper.get_youtube_streams("https://youtu.be/abc", tmp_path)

    message = str(excinfo.value)
    assert attempts == ["WEB_MUSIC", "WEB", "MWEB"]
    assert "WEB_MUSIC: ValueError" in message
    assert "WEB: RuntimeError" in message
    assert "MWEB: RuntimeError" in message


def test_network_error_stops_immediately(monkeypatch, tmp_path):
    """A dead network fails identically for every client, so don't retry."""
    import urllib.error

    attempts = []
    _patch_youtube(
        monkeypatch,
        {"WEB_MUSIC": urllib.error.URLError("No route to host")},
        attempts,
    )

    with pytest.raises(youtube_helper.YouTubeException) as excinfo:
        youtube_helper.get_youtube_streams("https://youtu.be/abc", tmp_path)

    assert attempts == ["WEB_MUSIC"]
    assert "No route to host" in str(excinfo.value)


def test_partial_files_cleared_between_attempts(monkeypatch, tmp_path):
    """A partial file from a failed client must not leak into the next attempt.

    pytubefix skips downloading when a matching file already exists, so a
    leftover would be zipped and served as if it were the real download.
    """
    attempts = []

    def factory(url, client=None, proxies=None, **kwargs):
        attempts.append(client)
        if client == "WEB_MUSIC":
            # Write a partial file, then fail after it lands on disk.
            (tmp_path / "audio").write_bytes(b"partial junk")
            raise RuntimeError("SABRError")
        return FakeYouTube(url, client=client, proxies=proxies, behavior={})

    monkeypatch.setattr(youtube_helper.pytube, "YouTube", factory)

    _, audio_path, _ = youtube_helper.get_youtube_streams(
        "https://youtu.be/abc", tmp_path
    )

    assert audio_path.read_bytes() == b"fake media"
