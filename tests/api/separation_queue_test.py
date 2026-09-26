import threading
import time

import pytest

from api.karaoke.separation_queue import SeparationQueue, SeparationQueueFullError

# Generous: these only bound how long a broken queue can hang a test.
WAIT = 5


class ConcurrencyTracker:
    """A job that records how many copies of itself ran at once."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.running = 0
        self.max_running = 0
        self.order: list[int] = []

    def job(self, n: int, duration: float = 0.05) -> int:
        with self.lock:
            self.running += 1
            self.max_running = max(self.max_running, self.running)
        time.sleep(duration)
        with self.lock:
            self.running -= 1
            self.order.append(n)
        return n * 10


def test_runs_jobs_one_at_a_time_in_submission_order():
    q = SeparationQueue(max_pending=10)
    tracker = ConcurrencyTracker()

    futures = [q.submit(tracker.job, n) for n in range(5)]

    assert [f.result(timeout=WAIT) for f in futures] == [0, 10, 20, 30, 40]
    assert tracker.max_running == 1
    assert tracker.order == [0, 1, 2, 3, 4]


def test_run_blocks_callers_on_many_threads_but_still_one_at_a_time():
    q = SeparationQueue(max_pending=10)
    tracker = ConcurrencyTracker()
    results = []

    threads = [
        threading.Thread(target=lambda n=n: results.append(q.run(tracker.job, n)))
        for n in range(4)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=WAIT)

    assert sorted(results) == [0, 10, 20, 30]
    assert tracker.max_running == 1


def test_a_failing_job_raises_for_its_caller_and_the_queue_keeps_going():
    q = SeparationQueue(max_pending=10)

    def explode():
        raise ValueError("model exploded")

    with pytest.raises(ValueError, match="model exploded"):
        q.run(explode)
    assert q.run(lambda: "still working") == "still working"


def test_rejects_jobs_past_max_pending_and_accepts_them_again_once_drained():
    q = SeparationQueue(max_pending=2)
    release = threading.Event()

    first = q.submit(release.wait, WAIT)
    second = q.submit(lambda: "second")
    with pytest.raises(SeparationQueueFullError):
        q.submit(lambda: "third")

    release.set()
    first.result(timeout=WAIT)
    second.result(timeout=WAIT)
    assert q.run(lambda: "fourth") == "fourth"


def test_pending_counts_waiting_and_running_jobs():
    q = SeparationQueue(max_pending=10)
    release = threading.Event()

    running = q.submit(release.wait, WAIT)
    waiting = q.submit(lambda: None)
    assert q.pending == 2

    release.set()
    running.result(timeout=WAIT)
    waiting.result(timeout=WAIT)
    # The count drops just after the result is set, so give it a moment.
    deadline = time.monotonic() + WAIT
    while q.pending and time.monotonic() < deadline:
        time.sleep(0.01)
    assert q.pending == 0


def test_a_job_cancelled_while_waiting_never_runs():
    q = SeparationQueue(max_pending=10)
    release = threading.Event()
    ran = []

    blocker = q.submit(release.wait, WAIT)
    cancelled = q.submit(ran.append, "cancelled job")
    assert cancelled.cancel()

    release.set()
    blocker.result(timeout=WAIT)
    q.run(lambda: None)  # everything submitted before this has been handled
    assert ran == []
