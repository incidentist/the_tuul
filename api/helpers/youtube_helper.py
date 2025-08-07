import json
import tempfile
from pathlib import Path
import structlog

import pytubefix as pytube
from pytubefix import extract
from .. import settings
from . import zip_helper, cloud_storage

logger = structlog.get_logger(__name__)


def get_youtube_streams(
    youtube_url: str, song_files_dir: Path
) -> tuple[dict[str, str], Path, Path]:
    """Download audio and video streams from YouTube URL.
    Video has max resolution of 1080p.
    Return audio and video paths.
    """

    proxy_options = None
    if settings.YOUTUBE_PROXY:
        proxy_options = {
            "http": settings.YOUTUBE_PROXY,
            "https": settings.YOUTUBE_PROXY,
        }
        logger.info("Using proxy for YouTube download")

    youtube = pytube.YouTube(youtube_url, proxies=proxy_options)
    audio_stream = youtube.streams.filter(only_audio=True).first()
    video_stream = youtube.streams.filter(only_video=True, res="1080p").first()
    if not video_stream:
        video_stream = youtube.streams.filter(only_video=True).first()

    if not audio_stream:
        raise ValueError("No audio stream found")
    if not video_stream:
        raise ValueError("No video stream found")

    audio_path = audio_stream.download(str(song_files_dir), "audio")
    video_path = video_stream.download(str(song_files_dir), "video")
    logger.info("video_stream", video_stream=video_stream)

    if not audio_path or not video_path:
        raise ValueError("Failed to download streams")

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


def get_video_id(youtube_url: str) -> str:
    """Extract video ID from YouTube URL using pytubefix.
    Raises:
        ValueError: If URL is invalid or video ID cannot be extracted
    """
    try:
        return extract.video_id(youtube_url)
    except Exception as e:
        raise ValueError(f"Invalid YouTube URL: {youtube_url}") from e


def download_and_zip_youtube(
    video_id: str, youtube_url: str, song_files_dir_path: Path
) -> Path:
    """Download YouTube video/audio and create zip file."""
    metadata, audio_path, video_path = get_youtube_streams(
        youtube_url, song_files_dir_path
    )
    logger.info("youtube_metadata", metadata=metadata, video_id=video_id)
    (song_files_dir_path / "metadata.json").write_text(json.dumps(metadata))
    zip_path = zip_helper.create_zip_file(
        song_files_dir_path / "youtube_video.zip",
        [
            (audio_path, "audio.mp4"),
            (video_path, "video.mp4"),
            (song_files_dir_path / "metadata.json", "metadata.json"),
        ],
    )
    logger.info("youtube_zip_complete", path=zip_path, video_id=video_id)
    return zip_path


def process_youtube_download_background(video_id: str, youtube_url: str):
    """Background task to process YouTube download and upload to storage."""
    with tempfile.TemporaryDirectory() as song_files_dir:
        song_files_dir_path = Path(song_files_dir)
        zip_path = download_and_zip_youtube(video_id, youtube_url, song_files_dir_path)

        # Upload to storage using the downloaded_videos folder
        cloud_storage.upload_to_cache(video_id, zip_path, folder="downloaded_videos")
