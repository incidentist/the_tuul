import hashlib
import json
import tempfile
import time
from pathlib import Path
from unittest import mock

import pytest

from api import settings
from api.helpers import cloud_storage


def test_get_cache_hash():
    # Create file content and model name
    file_content = b"test file content"
    model_name = "test_model"

    # Calculate expected hash
    expected_hash = hashlib.sha256()
    expected_hash.update(file_content)
    expected_hash.update(model_name.encode("utf-8"))

    # Get hash from the function
    result = cloud_storage.get_cache_hash(model_name, file_content)

    # Check if the hash matches
    assert result == expected_hash.hexdigest()


@pytest.mark.parametrize(
    "bucket_exists,blob_exists,content_type,expected_result",
    [
        (True, True, "application/zip", "https://example.com/url"),  # Completed cache - should return URL
        (True, True, "application/json", "https://example.com/url"),  # Placeholder - should return URL
        (True, False, None, None),  # Bucket exists but blob doesn't - should return None
        (False, False, None, None),  # Bucket doesn't exist - should return None
    ],
)
@mock.patch("api.helpers.cloud_storage.storage")
def test_fetch_from_cache(mock_storage, bucket_exists, blob_exists, content_type, expected_result):
    # Setup mocks
    mock_client = mock.MagicMock()
    mock_bucket = mock.MagicMock()
    mock_blob = mock.MagicMock()

    mock_storage.Client.return_value = mock_client
    mock_client.bucket.return_value = mock_bucket
    mock_bucket.blob.return_value = mock_blob

    if not bucket_exists:
        from google.cloud.exceptions import NotFound
        mock_client.bucket.side_effect = NotFound("Bucket not found")

    if not blob_exists:
        mock_blob.exists.return_value = False
    else:
        mock_blob.exists.return_value = True
        mock_blob.content_type = content_type
        mock_blob.public_url = "https://example.com/url"

    # Test fetch_from_cache
    result = cloud_storage.fetch_from_cache("test_hash", "test-bucket")

    if expected_result:
        assert result == expected_result
    else:
        assert result is None


@pytest.mark.parametrize(
    "bucket_exists,upload_succeeds,expected_result",
    [
        (True, True, True),  # Bucket exists and upload succeeds
        (True, False, False),  # Bucket exists but upload fails
        (False, False, False),  # Bucket doesn't exist
    ],
)
@mock.patch("api.helpers.cloud_storage.storage")
def test_upload_to_cache(mock_storage, bucket_exists, upload_succeeds, expected_result):
    # Create a temp file for testing
    with tempfile.NamedTemporaryFile() as temp_file:
        temp_path = Path(temp_file.name)

        # Setup mocks
        mock_client = mock.MagicMock()
        mock_bucket = mock.MagicMock()
        mock_blob = mock.MagicMock()

        mock_storage.Client.return_value = mock_client
        mock_client.bucket.return_value = mock_bucket
        mock_bucket.blob.return_value = mock_blob

        if not bucket_exists:
            from google.cloud.exceptions import NotFound

            mock_client.bucket.side_effect = NotFound("Bucket not found")

        if not upload_succeeds:
            mock_blob.upload_from_filename.side_effect = Exception("Upload failed")

        # Test upload_to_cache
        result = cloud_storage.upload_to_cache("test_hash", temp_path, "test-bucket")

        assert result is expected_result


def _mock_placeholder_blob(mock_storage, placeholder: dict) -> mock.MagicMock:
    """Point cloud_storage at a bucket holding one JSON placeholder."""
    mock_blob = mock.MagicMock()
    mock_storage.Client.return_value.bucket.return_value.blob.return_value = mock_blob
    mock_blob.exists.return_value = True
    mock_blob.content_type = "application/json"
    mock_blob.public_url = "https://example.com/url"
    mock_blob.download_as_text.return_value = json.dumps(placeholder)
    return mock_blob


@mock.patch("api.helpers.cloud_storage.storage")
def test_fetch_from_cache_returns_a_fresh_processing_placeholder(mock_storage):
    _mock_placeholder_blob(
        mock_storage, {"status": "processing", "startTime": int(time.time())}
    )

    assert cloud_storage.fetch_from_cache("test_hash", "test-bucket") == (
        "https://example.com/url"
    )


@mock.patch("api.helpers.cloud_storage.storage")
def test_fetch_from_cache_misses_on_a_failed_placeholder(mock_storage):
    _mock_placeholder_blob(mock_storage, {"status": "failed", "failedTime": 0})

    assert cloud_storage.fetch_from_cache("test_hash", "test-bucket") is None


@mock.patch("api.helpers.cloud_storage.storage")
def test_fetch_from_cache_misses_on_a_stale_processing_placeholder(mock_storage):
    started = time.time() - settings.SEPARATION_PLACEHOLDER_STALE_SECONDS - 60
    _mock_placeholder_blob(
        mock_storage, {"status": "processing", "startTime": int(started)}
    )

    assert cloud_storage.fetch_from_cache("test_hash", "test-bucket") is None


@mock.patch("api.helpers.cloud_storage.storage")
def test_mark_cache_failed_overwrites_the_placeholder(mock_storage):
    mock_blob = mock_storage.Client.return_value.bucket.return_value.blob.return_value

    assert cloud_storage.mark_cache_failed("test_hash", "test-bucket") is True

    mock_storage.Client.return_value.bucket.return_value.blob.assert_called_once_with(
        "separated_tracks/test_hash.zip"
    )
    data, = mock_blob.upload_from_string.call_args.args
    assert json.loads(data)["status"] == "failed"
    assert mock_blob.upload_from_string.call_args.kwargs == {
        "content_type": "application/json"
    }


@mock.patch("api.helpers.cloud_storage.storage")
def test_mark_cache_failed_reports_an_upload_error(mock_storage):
    mock_blob = mock_storage.Client.return_value.bucket.return_value.blob.return_value
    mock_blob.upload_from_string.side_effect = Exception("Upload failed")

    assert cloud_storage.mark_cache_failed("test_hash", "test-bucket") is False


def _mock_existing_blob(mock_storage, content_type) -> mock.MagicMock:
    blob = mock.MagicMock()
    blob.content_type = content_type
    blob.public_url = "https://example.com/abc.zip"
    mock_storage.Client.return_value.bucket.return_value.get_blob.return_value = blob
    return blob


@mock.patch("api.helpers.cloud_storage.storage")
def test_fetch_completed_or_clear_error_returns_a_finished_zip(mock_storage):
    blob = _mock_existing_blob(mock_storage, "application/zip")

    result = cloud_storage.fetch_completed_or_clear_error(
        "abc", "bucket", "downloaded_videos"
    )

    assert result == "https://example.com/abc.zip"
    mock_storage.Client.return_value.bucket.return_value.get_blob.assert_called_once_with(
        "downloaded_videos/abc.zip"
    )
    blob.delete.assert_not_called()


@mock.patch("api.helpers.cloud_storage.storage")
def test_fetch_completed_or_clear_error_deletes_an_error_file(mock_storage):
    blob = _mock_existing_blob(mock_storage, "application/json")

    result = cloud_storage.fetch_completed_or_clear_error(
        "abc", "bucket", "downloaded_videos"
    )

    assert result is None
    blob.delete.assert_called_once()


@mock.patch("api.helpers.cloud_storage.storage")
def test_fetch_completed_or_clear_error_with_nothing_cached(mock_storage):
    mock_storage.Client.return_value.bucket.return_value.get_blob.return_value = None

    assert (
        cloud_storage.fetch_completed_or_clear_error("abc", "bucket", "downloaded_videos")
        is None
    )


@mock.patch("api.helpers.cloud_storage.storage")
def test_fetch_completed_or_clear_error_swallows_storage_errors(mock_storage):
    mock_storage.Client.side_effect = Exception("boom")

    assert (
        cloud_storage.fetch_completed_or_clear_error("abc", "bucket", "downloaded_videos")
        is None
    )
