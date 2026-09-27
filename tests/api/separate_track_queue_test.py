"""/separate_track under concurrent load, and failures of GCS-mode separations.

split_song is replaced with a fake that blocks until the test releases it (the
real one drives audio-separator); cloud_storage is mocked because it talks to
GCS. Everything else -- queue, zipping, the endpoint -- is real.
"""

import asyncio
import threading
from pathlib import Path
from unittest import mock

import httpx
import pytest

from api import main
from api.helpers import cloud_storage
from api.karaoke import music_separation
from api.karaoke.separation_queue import SeparationQueue

# Upper bound on how long a broken server can hang a test.
WAIT = 5

MODEL = music_separation.DEFAULT_MODEL


@pytest.fixture
def anyio_backend():
    return "asyncio"


class FakeSplitSong:
    """Stands in for split_song. Each call blocks until release() and records
    how many ran at once."""

    def __init__(self) -> None:
        self.started = threading.Event()
        self._release = threading.Event()
        self._lock = threading.Lock()
        self.running = 0
        self.max_running = 0
        self.calls = 0
        # Set if a call gave up waiting for release(): nothing released it
        # while it ran, so nothing else ran while it did.
        self.timed_out = False

    def release(self) -> None:
        self._release.set()

    def __call__(self, songfile: Path, song_dir: Path, model_name: str, method=None):
        with self._lock:
            self.calls += 1
            self.running += 1
            self.max_running = max(self.max_running, self.running)
        self.started.set()
        if not self._release.wait(WAIT):
            self.timed_out = True
        (song_dir / "vocals.wav").write_bytes(b"vocals")
        (song_dir / "accompaniment.wav").write_bytes(b"backing")
        with self._lock:
            self.running -= 1
        return song_dir / "accompaniment.wav", song_dir / "vocals.wav"


@pytest.fixture
def fake_split(monkeypatch):
    fake = FakeSplitSong()
    monkeypatch.setattr(music_separation, "split_song", fake)
    # A fresh queue per test, so one test's jobs never wait behind another's.
    monkeypatch.setattr(main, "separation_queue", SeparationQueue(max_pending=10))
    yield fake
    fake.release()  # never leave the worker thread blocked


@pytest.fixture
def no_bucket():
    with mock.patch("api.settings.SEPARATED_TRACKS_BUCKET", ""):
        yield


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def post_song(client: httpx.AsyncClient, content: bytes = b"song"):
    return client.post(
        "/separate_track",
        data={"modelName": MODEL},
        files={"songFile": ("song.mp3", content, "audio/mpeg")},
    )


async def wait_for_thread_event(event: threading.Event) -> None:
    assert await asyncio.to_thread(event.wait, WAIT), "separation never started"


# --- Without GCS: the response waits for the separation ----------------------


@pytest.mark.anyio
async def test_health_answers_while_a_separation_is_running(
    fake_split, no_bucket, client
):
    separation = asyncio.create_task(post_song(client))
    await wait_for_thread_event(fake_split.started)

    health = await client.get("/health")
    assert health.status_code == 200
    fake_split.release()

    response = await separation
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    # An app separating on its event loop can't get to /health, or to this
    # release(), until the separation gives up waiting for it.
    assert not fake_split.timed_out


@pytest.mark.anyio
async def test_concurrent_requests_all_succeed_one_separation_at_a_time(
    fake_split, no_bucket, client
):
    fake_split.release()

    responses = await asyncio.gather(
        *(post_song(client, f"song {n}".encode()) for n in range(3))
    )

    assert [r.status_code for r in responses] == [200, 200, 200]
    assert fake_split.calls == 3
    assert fake_split.max_running == 1


@pytest.mark.anyio
async def test_returns_503_when_the_queue_is_full(
    fake_split, no_bucket, client, monkeypatch
):
    monkeypatch.setattr(main, "separation_queue", SeparationQueue(max_pending=1))
    running = asyncio.create_task(post_song(client, b"first"))
    await wait_for_thread_event(fake_split.started)

    rejected = await post_song(client, b"second")

    assert rejected.status_code == 503
    fake_split.release()
    assert (await running).status_code == 200


@pytest.mark.anyio
async def test_compose_provider_leaves_queueing_to_the_separator(
    fake_split, no_bucket, client, monkeypatch
):
    # A local queue that can't take anything: using it would be a 503.
    monkeypatch.setattr(main, "separation_queue", SeparationQueue(max_pending=0))
    fake_split.release()

    with mock.patch("api.settings.SEPARATION_METHOD", "compose_provider"):
        response = await post_song(client)

    assert response.status_code == 200
    assert fake_split.calls == 1


# --- With GCS: the client polls a placeholder --------------------------------


@pytest.fixture
def gcs():
    """cloud_storage with its GCS-facing functions mocked."""
    with mock.patch.multiple(
        cloud_storage,
        upload_to_cache=mock.DEFAULT,
        mark_cache_failed=mock.DEFAULT,
    ) as mocks:
        mocks["upload_to_cache"].return_value = True
        yield mocks


def test_background_separation_uploads_the_result(fake_split, gcs):
    fake_split.release()

    main.process_track_separation_background("hash", MODEL, b"song", "song.mp3")

    gcs["upload_to_cache"].assert_called_once_with("hash", mock.ANY)
    gcs["mark_cache_failed"].assert_not_called()


def test_background_separation_failure_marks_the_placeholder_failed(
    gcs, monkeypatch
):
    def explode(*args, **kwargs):
        raise music_separation.SeparationError("separator unreachable")

    monkeypatch.setattr(music_separation, "split_song", explode)

    main.process_track_separation_background("hash", MODEL, b"song", "song.mp3")

    gcs["upload_to_cache"].assert_not_called()
    gcs["mark_cache_failed"].assert_called_once_with("hash")


def test_background_upload_failure_marks_the_placeholder_failed(fake_split, gcs):
    fake_split.release()
    gcs["upload_to_cache"].return_value = False

    main.process_track_separation_background("hash", MODEL, b"song", "song.mp3")

    gcs["mark_cache_failed"].assert_called_once_with("hash")
