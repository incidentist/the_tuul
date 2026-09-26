"""
One-at-a-time execution for audio separation.

Separation loads a model and saturates a GPU (or every CPU core) for minutes at
a time. Running several at once doesn't finish any of them sooner -- it
multiplies the memory held by loaded models and starves the web server of CPU
until it stops answering. So every separation in a process goes through one
SeparationQueue, which runs them in submission order on a single worker thread.

The queue lives in memory, so it is per-process: it serializes separations for
one gunicorn worker (or one separator server), not across several.
"""

import queue
import threading
from concurrent.futures import Future
from dataclasses import dataclass, field
from typing import Any, Callable, TypeVar

import structlog

logger = structlog.get_logger(__name__)

T = TypeVar("T")


class SeparationQueueFullError(RuntimeError):
    """Raised when a job is submitted to a queue that is already at capacity."""


@dataclass
class _Job:
    """One call waiting its turn, and the Future its caller is watching."""

    future: Future
    fn: Callable[..., Any]
    args: tuple = ()
    kwargs: dict = field(default_factory=dict)


class SeparationQueue:
    """Runs submitted jobs one at a time, in order, on a daemon worker thread.

    The worker is a daemon so that a process shutting down doesn't sit waiting
    for every queued separation to finish first; jobs still waiting are simply
    dropped with the process.
    """

    def __init__(self, max_pending: int, name: str = "separation") -> None:
        """
        Args:
            max_pending: How many jobs may wait or run at once. Past this,
                submit() raises SeparationQueueFullError rather than queueing work
                nobody will wait long enough to collect.
            name: Names the worker thread and the log lines, for telling
                queues apart.
        """
        self.max_pending = max_pending
        self.name = name
        self._jobs: queue.SimpleQueue[_Job] = queue.SimpleQueue()
        # Jobs submitted but not yet finished, including the running one.
        self._pending = 0
        self._lock = threading.Lock()
        self._worker = threading.Thread(
            target=self._work, name=f"{name}-queue", daemon=True
        )
        self._worker.start()

    @property
    def pending(self) -> int:
        """Jobs waiting or running."""
        with self._lock:
            return self._pending

    def submit(self, fn: Callable[..., T], *args, **kwargs) -> "Future[T]":
        """Queue fn(*args, **kwargs) and return a Future for its result.

        Cancelling the Future before the job starts removes it from the line.
        Raises SeparationQueueFullError if max_pending jobs are already queued.
        """
        with self._lock:
            if self._pending >= self.max_pending:
                raise SeparationQueueFullError(
                    f"{self.max_pending} separations are already queued"
                )
            self._pending += 1
            position = self._pending

        future: Future[T] = Future()
        self._jobs.put(_Job(future, fn, args, kwargs))
        logger.info("separation_queued", queue=self.name, position=position)
        return future

    def run(self, fn: Callable[..., T], *args, **kwargs) -> T:
        """Queue fn(*args, **kwargs) and block until it has run.

        For callers that are already on a thread of their own. Re-raises
        whatever the job raised.
        """
        return self.submit(fn, *args, **kwargs).result()

    def _work(self) -> None:
        while True:
            job = self._jobs.get()
            try:
                # False means the caller cancelled while it was waiting.
                if job.future.set_running_or_notify_cancel():
                    try:
                        job.future.set_result(job.fn(*job.args, **job.kwargs))
                    except BaseException as e:
                        job.future.set_exception(e)
            finally:
                with self._lock:
                    self._pending -= 1
