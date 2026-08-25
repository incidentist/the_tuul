import json
import tempfile
from pathlib import Path
import structlog
import urllib.error

import pytubefix as pytube
from pytubefix import extract
from .. import settings
from . import zip_helper, cloud_storage

logger = structlog.get_logger(__name__)


class YouTubeException(Exception):
    """Exception raised for YouTube-related errors."""

    pass


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

    try:
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

    except urllib.error.URLError as e:
        # Check if this is a "No route to host" error (errno 113)
        is_no_route_error = False
        if hasattr(e, "reason"):
            if hasattr(e.reason, "errno") and e.reason.errno == 113:
                is_no_route_error = True
            elif str(e.reason).find("No route to host") != -1:
                is_no_route_error = True

        if is_no_route_error:
            # Try to extract host information from the error
            host = "unknown host"
            error_str = str(e)

            # Extract from the original YouTube URL as fallback
            from urllib.parse import urlparse

            parsed_url = urlparse(youtube_url)
            host = parsed_url.netloc

            error_msg = f"No route to host - unable to reach: {host}"
            logger.error(
                "No route to host error",
                unreachable_host=host,
                using_proxy=bool(settings.YOUTUBE_PROXY),
                youtube_url=youtube_url,
                error=error_str,
            )
            raise YouTubeException(error_msg) from e
        else:
            raise YouTubeException(f"Network error accessing YouTube: {e}") from e

    except Exception as e:
        # pytubefix raises a wide variety of exceptions when YouTube changes its
        # internals (RegexMatchError, BotDetection, VideoUnavailable, HTTP 403...).
        # Funnel them all into YouTubeException so callers can report them.
        logger.exception(
            "youtube_stream_download_failed",
            youtube_url=youtube_url,
            error_type=type(e).__name__,
            error=str(e),
        )
        raise YouTubeException(
            f"Could not download from YouTube ({type(e).__name__}): {e}"
        ) from e


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


def write_async_error(error_message: str, filename: str):
    """Write an error JSON file and upload it to cache."""
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        error_file_path = temp_path / "error.json"

        error_data = {"success": False, "error": error_message}

        error_file_path.write_text(json.dumps(error_data))
        cloud_storage.upload_to_cache(
            filename, error_file_path, folder="downloaded_videos"
        )


def process_youtube_download_background(video_id: str, youtube_url: str):
    """Background task to process YouTube download and upload to storage."""
    try:
        with tempfile.TemporaryDirectory() as song_files_dir:
            song_files_dir_path = Path(song_files_dir)
            zip_path = download_and_zip_youtube(
                video_id, youtube_url, song_files_dir_path
            )

            # Upload to storage using the downloaded_videos folder
            cloud_storage.upload_to_cache(
                video_id, zip_path, folder="downloaded_videos"
            )
    except YouTubeException as e:
        logger.error(
            "youtube_download_failed",
            video_id=video_id,
            youtube_url=youtube_url,
            error=str(e),
        )
        _write_async_error_safely(str(e), video_id)
    except Exception as e:
        # Anything else (zip creation, metadata, GCS upload) must still produce an
        # error file, or the client polls the missing zip forever.
        logger.exception(
            "youtube_download_failed_unexpectedly",
            video_id=video_id,
            youtube_url=youtube_url,
            error_type=type(e).__name__,
            error=str(e),
        )
        _write_async_error_safely(
            f"Unexpected error downloading video ({type(e).__name__}): {e}", video_id
        )


def _write_async_error_safely(error_message: str, video_id: str):
    """Write the error file, logging (not raising) if that itself fails."""
    try:
        write_async_error(error_message, video_id)
    except Exception:
        logger.exception("youtube_error_upload_failed", video_id=video_id)
