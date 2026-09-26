"""Tests for the host separator server (api/separator_server.py).

split_song is replaced with a fake: the real one drives audio-separator and a
GPU. The fake blocks until the test releases it, so a test can look at the
server while a separation is in progress.
"""

import asyncio
import base64
import threading
from pathlib import Path

import httpx
import pytest

from api import separator_server
from api.karaoke.music_separation import DEFAULT_MODEL
from api.karaoke.separation_queue import SeparationQueue

# Upper bound on how long a broken server can hang a test.
WAIT = 5


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

    def __call__(self, input_file: Path, out_dir: Path, model_name: str, method=None):
        with self._lock:
            self.calls += 1
            self.running += 1
            self.max_running = max(self.max_running, self.running)
        self.started.set()
        if not self._release.wait(WAIT):
            self.timed_out = True
        (out_dir / "vocals.wav").write_bytes(b"vocals of " + input_file.read_bytes())
        (out_dir / "accompaniment.wav").write_bytes(b"backing")
        with self._lock:
            self.running -= 1
        return out_dir / "accompaniment.wav", out_dir / "vocals.wav"


@pytest.fixture
def fake_split(monkeypatch):
    fake = FakeSplitSong()
    monkeypatch.setattr(separator_server, "split_song", fake)
    # A fresh queue per test, so one test's jobs never wait behind another's.
    monkeypatch.setattr(
        separator_server, "separation_queue", SeparationQueue(max_pending=10)
    )
    yield fake
    fake.release()  # never leave the worker thread blocked


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=separator_server.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def separation_request(audio: bytes) -> dict:
    return {
        "model_name": DEFAULT_MODEL,
        "audio_base64": base64.b64encode(audio).decode(),
        "filename": "song.wav",
    }


async def wait_for_thread_event(event: threading.Event) -> None:
    assert await asyncio.to_thread(event.wait, WAIT), "separation never started"


@pytest.mark.anyio
async def test_separates_and_returns_both_stems(fake_split, client):
    fake_split.release()

    response = await client.post("/separate", json=separation_request(b"song"))

    body = response.json()
    assert body["success"] is True
    assert base64.b64decode(body["vocals_base64"]) == b"vocals of song"
    assert base64.b64decode(body["accompaniment_base64"]) == b"backing"


@pytest.mark.anyio
async def test_health_answers_while_a_separation_is_running(fake_split, client):
    separation = asyncio.create_task(
        client.post("/separate", json=separation_request(b"song"))
    )
    await wait_for_thread_event(fake_split.started)

    health = await client.get("/health")
    assert health.status_code == 200
    fake_split.release()

    assert (await separation).json()["success"] is True
    # A server separating on its event loop can't get to /health, or to this
    # release(), until the separation gives up waiting for it.
    assert not fake_split.timed_out


@pytest.mark.anyio
async def test_concurrent_requests_separate_one_at_a_time(fake_split, client):
    fake_split.release()

    responses = await asyncio.gather(
        *(
            client.post("/separate", json=separation_request(f"song {n}".encode()))
            for n in range(3)
        )
    )

    assert [r.json()["success"] for r in responses] == [True, True, True]
    assert fake_split.calls == 3
    assert fake_split.max_running == 1


@pytest.mark.anyio
async def test_returns_503_when_the_queue_is_full(fake_split, client, monkeypatch):
    monkeypatch.setattr(
        separator_server, "separation_queue", SeparationQueue(max_pending=1)
    )
    running = asyncio.create_task(
        client.post("/separate", json=separation_request(b"first"))
    )
    await wait_for_thread_event(fake_split.started)

    rejected = await client.post("/separate", json=separation_request(b"second"))

    assert rejected.status_code == 503
    fake_split.release()
    assert (await running).json()["success"] is True


@pytest.mark.anyio
async def test_rejects_an_unknown_model_without_queueing(fake_split, client):
    request = separation_request(b"song") | {"model_name": "nope.onnx"}

    response = await client.post("/separate", json=request)

    assert response.status_code == 400
    assert fake_split.calls == 0


@pytest.mark.anyio
async def test_reports_a_failed_separation(fake_split, client, monkeypatch):
    def explode(*args, **kwargs):
        raise RuntimeError("model exploded")

    monkeypatch.setattr(separator_server, "split_song", explode)

    response = await client.post("/separate", json=separation_request(b"song"))

    assert response.json() == {
        "success": False,
        "error": "model exploded",
        "vocals_base64": None,
        "accompaniment_base64": None,
        "vocals_filename": None,
        "accompaniment_filename": None,
    }
