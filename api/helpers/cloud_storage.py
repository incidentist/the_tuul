import hashlib
import json
import tempfile
import time
from pathlib import Path
from typing import Optional

import structlog
from google.cloud import storage
from google.cloud.exceptions import NotFound

from .. import settings

logger = structlog.get_logger(__name__)


def get_cache_hash(model_name: str, song_file_data: bytes) -> str:
    """
    Generate a hash from the model name and song file content.
    This hash is used as a key for caching separated tracks.
    """
    # Create a hash of the file content and model name
    hash_obj = hashlib.sha256()
    hash_obj.update(song_file_data)
    hash_obj.update(model_name.encode("utf-8"))
    return hash_obj.hexdigest()


def fetch_from_cache(
    cache_hash: str, bucket_name: Optional[str] = None, folder: str = "separated_tracks"
) -> Optional[str]:
    """
    Try to fetch a zip file from Google Cloud Storage based on the hash.
    Returns:
    - str with public URL if cache found (either placeholder or completed)
    - None if not found at all
    """
    if bucket_name is None:
        bucket_name = settings.SEPARATED_TRACKS_BUCKET
    if not bucket_name:
        return None

    blob_name = f"{folder}/{cache_hash}.zip"

    try:
        storage_client = storage.Client()
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(blob_name)

        # Check if the blob exists
        if not blob.exists():
            logger.info("cache_miss", cache_hash=cache_hash, blob_name=blob_name)
            return None

        # Check content type to determine if it's a placeholder or actual cache
        blob.reload()
        if blob.content_type == "application/json":
            logger.info(
                "cache_placeholder_found", cache_hash=cache_hash, blob_name=blob_name
            )
        else:
            logger.info("cache_hit", cache_hash=cache_hash, blob_name=blob_name)

        # Return public URL for both placeholder and completed cache
        return blob.public_url

    except NotFound:
        logger.info("cache_miss", cache_hash=cache_hash, blob_name=blob_name)
        return None
    except Exception as e:
        logger.error(
            "cache_fetch_error",
            cache_hash=cache_hash,
            blob_name=blob_name,
            error=str(e),
        )
        return None


def upload_to_cache(
    cache_hash: str,
    zip_path: Path,
    bucket_name: Optional[str] = None,
    folder: str = "separated_tracks",
) -> bool:
    """
    Upload the zip file to Google Cloud Storage using the hash as a key.
    Returns True if successful, False otherwise.
    """
    if bucket_name is None:
        bucket_name = settings.SEPARATED_TRACKS_BUCKET
    if not bucket_name:
        return False

    blob_name = f"{folder}/{cache_hash}.zip"

    try:
        # Upload the file to GCS
        storage_client = storage.Client()
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(blob_name)

        # Set cache control headers to prevent caching
        blob.cache_control = "no-cache, no-store, must-revalidate"
        blob.upload_from_filename(zip_path)
        logger.info(
            "cache_upload_success",
            cache_hash=cache_hash,
            blob_name=blob_name,
            path=zip_path,
        )
        return True

    except Exception as e:
        logger.error(
            "cache_upload_error",
            cache_hash=cache_hash,
            blob_name=blob_name,
            error=str(e),
        )
        return False


def create_cache_placeholder(
    cache_hash: str, bucket_name: Optional[str] = None, folder: str = "separated_tracks"
) -> Optional[str]:
    """
    Create a placeholder JSON file in GCS to indicate processing has started.
    Uses the same filename as the final cache file.
    Returns the blob's public URL if successful, None otherwise.
    """
    if bucket_name is None:
        bucket_name = settings.SEPARATED_TRACKS_BUCKET
    if not bucket_name:
        return None

    blob_name = f"{folder}/{cache_hash}.zip"
    placeholder_data = {"startTime": int(time.time()), "status": "processing"}

    try:
        storage_client = storage.Client()
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(blob_name)

        # Set cache control headers to prevent caching
        blob.cache_control = "no-cache, no-store, must-revalidate"
        blob.upload_from_string(
            json.dumps(placeholder_data), content_type="application/json"
        )
        logger.info(
            "cache_placeholder_created", cache_hash=cache_hash, blob_name=blob_name
        )
        return blob.public_url

    except Exception as e:
        logger.error(
            "cache_placeholder_error",
            cache_hash=cache_hash,
            blob_name=blob_name,
            error=str(e),
        )
        return None
