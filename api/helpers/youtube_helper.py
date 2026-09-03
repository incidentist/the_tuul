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


# Clients are tried in order until one produces a complete download.
# YouTube rejects different clients for different videos: WEB_MUSIC serves the
# music catalog, WEB/MWEB serve everything else, and the pytubefix default
# (ANDROID_VR) currently fails bot detection on nearly all of them.
YOUTUBE_CLIENTS = ("WEB_MUSIC", "WEB", "MWEB")


def _proxy_options() -> dict[str, str] | None:
    if not settings.TUUL_YOUTUBE_PROXY:
        return None
    logger.info("Using proxy for YouTube download")
    return {
        "http": settings.TUUL_YOUTUBE_PROXY,
        "https": settings.TUUL_YOUTUBE_PROXY,
    }


def _clear_partial_downloads(song_files_dir: Path) -> None:
    """Remove files left behind by a failed attempt.

    pytubefix skips downloading when a file of matching size already exists, so
    a partial file from one client can silently corrupt the next client's run.
    """
    for name in ("audio", "video"):
        path = song_files_dir / name
        if path.exists():
            path.unlink()


def _download_with_client(
    youtube_url: str, song_files_dir: Path, client: str, proxy_options
) -> tuple[dict[str, str], Path, Path]:
    """Download audio and video using a single client.

    Succeeds completely or raises. Downloads happen here rather than in the
    caller because resolving stream metadata does not predict success -- some
    clients list streams fine and only fail once the bytes are requested.
    """
    youtube = pytube.YouTube(youtube_url, client=client, proxies=proxy_options)
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


def _raise_no_route_error(youtube_url: str, error: urllib.error.URLError):
    """Re-raise a URLError as a YouTubeException with host diagnostics."""
    is_no_route_error = False
    if hasattr(error, "reason"):
        if hasattr(error.reason, "errno") and error.reason.errno == 113:
            is_no_route_error = True
        elif str(error.reason).find("No route to host") != -1:
            is_no_route_error = True

    if is_no_route_error:
        from urllib.parse import urlparse

        host = urlparse(youtube_url).netloc
        error_msg = f"No route to host - unable to reach: {host}"
        logger.error(
            "No route to host error",
            unreachable_host=host,
            using_proxy=bool(settings.TUUL_YOUTUBE_PROXY),
            youtube_url=youtube_url,
            error=str(error),
        )
        raise YouTubeException(error_msg) from error

    raise YouTubeException(f"Network error accessing YouTube: {error}") from error


def get_youtube_streams(
    youtube_url: str, song_files_dir: Path
) -> tuple[dict[str, str], Path, Path]:
    """Download audio and video streams from YouTube URL.
    Video has max resolution of 1080p.
    Return audio and video paths.

    Tries each client in YOUTUBE_CLIENTS until one succeeds, since no single
    client works for every video.
    """
    proxy_options = _proxy_options()
    failures: list[str] = []
    last_error: Exception | None = None

    for client in YOUTUBE_CLIENTS:
        try:
            result = _download_with_client(
                youtube_url, song_files_dir, client, proxy_options
            )
            logger.info(
                "youtube_download_client_succeeded",
                client=client,
                youtube_url=youtube_url,
            )
            return result

        except urllib.error.HTTPError as e:
            # An HTTP-level rejection (403, etc.) is per-client, not a dead
            # network -- fall through like any other client failure below.
            logger.info(
                "youtube_download_client_failed",
                client=client,
                youtube_url=youtube_url,
                error_type=type(e).__name__,
                error=str(e),
            )
            failures.append(f"{client}: {type(e).__name__}")
            last_error = e
            _clear_partial_downloads(song_files_dir)

        except urllib.error.URLError as e:
            # A dead network will fail identically for every client, so stop
            # rather than burning the remaining attempts on it.
            _raise_no_route_error(youtube_url, e)

        except Exception as e:
            # pytubefix raises a wide variety of exceptions when YouTube rejects
            # a client (BotDetection, SABRError, HTTPError, VideoUnavailable...).
            # Record and try the next one.
            logger.info(
                "youtube_download_client_failed",
                client=client,
                youtube_url=youtube_url,
                error_type=type(e).__name__,
                error=str(e),
            )
            failures.append(f"{client}: {type(e).__name__}")
            last_error = e
            _clear_partial_downloads(song_files_dir)

    logger.exception(
        "youtube_stream_download_failed",
        youtube_url=youtube_url,
        error_type=type(last_error).__name__,
        error=str(last_error),
        clients_tried=failures,
    )
    raise YouTubeException(
        f"Could not download from YouTube ({type(last_error).__name__}): "
        f"{last_error} [tried {', '.join(failures)}]"
    ) from last_error


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
