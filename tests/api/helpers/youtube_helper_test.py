from pathlib import Path

import pytest
import pytubefix

from helpers import youtube_helper


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
