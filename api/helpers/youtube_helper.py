import json
from pathlib import Path
import structlog

import pytubefix as pytube

logger = structlog.get_logger(__name__)


def get_youtube_streams(
    youtube_url: str, song_files_dir: Path
) -> tuple[dict[str, str], Path, Path]:
    """Download audio and video streams from YouTube URL.
    Video has max resolution of 1080p.
    Return audio and video paths.
    """

    youtube = pytube.YouTube(youtube_url)
    audio_stream = youtube.streams.filter(only_audio=True).first()
    video_stream = youtube.streams.filter(only_video=True, res="1080p").first()
    if not video_stream:
        video_stream = youtube.streams.filter(only_video=True).first()
    audio_path = audio_stream.download(song_files_dir, "audio")
    video_path = video_stream.download(song_files_dir, "video")
    logger.info("video_stream", video_stream=video_stream)
    return assemble_metadata(youtube), Path(audio_path), Path(video_path)


def assemble_metadata(youtube: pytube.YouTube) -> dict[str, str]:
    metadata = {
        "title": youtube.title,
        "author": youtube.author,
        "length": youtube.length,
        "rating": youtube.rating,
        "views": youtube.views,
        "keywords": youtube.keywords,
        "description": youtube.description,
        # **youtube.metadata,
    }
    return metadata
