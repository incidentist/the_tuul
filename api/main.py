import asyncio
import contextlib
import hashlib
import ipaddress
import json
import math
import tempfile
import time
from collections.abc import Callable
from pathlib import Path, PurePosixPath
from typing import Annotated, Literal

import structlog
from fastapi import (
    BackgroundTasks,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from fastapi import (
    Path as PathParam,
)
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from markupsafe import Markup
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

from . import app_logging, lyrics, settings
from .helpers import (
    cloud_storage,
    job_queue,
    job_store,
    youtube_helper,
    zip_helper,
)
from .helpers.rate_limit import RateLimiter
from .helpers.youtube_helper import YouTubeException
from .karaoke import (
    aligners,
    alignment_backends,
    separation_backends,
    separation_progress,
)
from .karaoke.alignment_backends import AlignmentRequest
from .karaoke.music_separation import AVAILABLE_MODELS, SeparationResult
from .vite_assets import vite_assets

# Configure logging
app_logging.setup()
logger = structlog.get_logger(__name__)

if settings.DEFAULT_SEPARATION_MODEL not in AVAILABLE_MODELS:
    raise RuntimeError(
        f"Unknown DEFAULT_SEPARATION_MODEL {settings.DEFAULT_SEPARATION_MODEL!r}. "
        f"Available models: {AVAILABLE_MODELS}"
    )

# Raises on an unknown backend or aligner, or one without its dependencies,
# so a misconfigured server fails at startup rather than on someone's first sync.
alignment_backends.configured_name()


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    resume_remote_separations()
    yield


# Create FastAPI app
app = FastAPI(title=f"{settings.APP_NAME} API", debug=settings.DEBUG, lifespan=lifespan)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# A multipart body is a little larger than the file in it.
_MULTIPART_ALLOWANCE_BYTES = 1_000_000

UPLOAD_TOO_LARGE_MESSAGE = (
    f"The song is larger than the {settings.MAX_UPLOAD_MB} MB this server accepts."
)


@app.middleware("http")
async def limit_upload_size(request: Request, call_next):
    """Refuse an oversized song before its body is read.

    A body without a Content-Length is checked once parsed, in the route.
    """
    if request.url.path in ("/separate_track", "/align_track"):
        length = request.headers.get("content-length", "")
        limit = settings.MAX_UPLOAD_BYTES + _MULTIPART_ALLOWANCE_BYTES
        if length.isdigit() and int(length) > limit:
            return JSONResponse({"detail": UPLOAD_TOO_LARGE_MESSAGE}, status_code=413)
    return await call_next(request)


# Custom middleware for SharedArrayBuffer headers
@app.middleware("http")
async def add_sharedarraybuffer_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    return response


@app.middleware("http")
async def cache_fonts(request: Request, call_next):
    """Let browsers reuse the bundled fonts for a week without asking again."""
    response = await call_next(request)
    # Browsers keep a replaced font file for up to a week, so give a new version a new name.
    if request.url.path.startswith("/static/fonts/") and response.status_code < 400:
        response.headers["Cache-Control"] = "public, max-age=604800"
    return response


# Only the local job store queues. A GCS-backed deployment runs on Cloud Run,
# which caps concurrency per instance itself.
local_jobs = job_queue.JobQueue(settings.SEPARATION_CONCURRENCY)
# Remote syncs run on GPU containers of their own,
# so the separations' slots don't limit them.
remote_alignments = job_queue.JobQueue(settings.ALIGNMENT_CONCURRENCY)

separation_starts = RateLimiter(
    [
        (settings.SEPARATIONS_PER_HOUR, 60 * 60),
        (settings.SEPARATIONS_PER_DAY, 24 * 60 * 60),
    ]
)

sync_starts = RateLimiter(
    [
        (settings.SYNCS_PER_HOUR, 60 * 60),
        (settings.SYNCS_PER_DAY, 24 * 60 * 60),
    ]
)


lyrics_provider = lyrics.get_provider()

lyrics_lookups = RateLimiter([(settings.LYRICS_LOOKUPS_PER_HOUR, 60 * 60)])


def client_address(request: Request) -> str:
    if settings.CLIENT_IP_HEADER:
        forwarded = request.headers.get(settings.CLIENT_IP_HEADER, "").strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


def rate_limit_key(address: str) -> str:
    """Key an IPv6 client by its /64, the block a single customer is usually given."""
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return address
    if ip.version == 4:
        return str(ip)
    if ip.ipv4_mapped:
        return str(ip.ipv4_mapped)
    return str(ipaddress.ip_network(f"{ip}/64", strict=False))


def start_separation_or_refuse(request: Request) -> None:
    """Count a new separation against the client's allowance, or refuse it with a 429."""
    _start_or_refuse(request, separation_starts, "separation", "separations")


def start_sync_or_refuse(request: Request) -> None:
    """Count a new sync against the client's allowance, or refuse it with a 429."""
    _start_or_refuse(request, sync_starts, "sync", "syncs")


def _start_or_refuse(
    request: Request, starts: RateLimiter, kind: str, plural: str
) -> None:
    client = client_address(request)
    wait = starts.acquire(rate_limit_key(client))
    if wait is None:
        return
    logger.warning(f"{kind}_rate_limited", client=client, retry_after=wait)
    raise HTTPException(
        status_code=429,
        detail=(
            f"You have started as many {plural} as this server allows for now. "
            f"Try again in {_describe_wait(wait)}."
        ),
        headers={"Retry-After": str(math.ceil(wait))},
    )


def _describe_wait(seconds: float) -> str:
    minutes = max(1, math.ceil(seconds / 60))
    if minutes < 120:
        return f"{minutes} minute{'s' if minutes > 1 else ''}"
    return f"{math.ceil(minutes / 60)} hours"


# Static files and templates
app.mount("/static", StaticFiles(directory=settings.STATIC_DIR), name="static")
templates = Jinja2Templates(directory=settings.TEMPLATES_DIR)


# Pydantic models
class LogErrorRequest(BaseModel):
    # Clients send context beyond these fields, such as the browser.
    model_config = ConfigDict(extra="allow")

    level: Literal["info", "warning", "error"] = "error"
    message: str | None = None
    stack: str | None = None
    url: str | None = None
    line: int | None = None
    column: int | None = None


NonBlank = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class LyricsRequest(BaseModel):
    title: NonBlank
    artist: NonBlank
    duration: float = Field(gt=0)


class JobPollResponse(BaseModel):
    finishedTrackURL: str


class DownloadPollResponse(BaseModel):
    finishedDownloadURL: str


def streamed_response(file_path: Path) -> StreamingResponse:
    """Return a streaming response for the given file path."""

    # Read the entire file into memory to avoid issues with temp file cleanup
    file_content = file_path.read_bytes()

    def streaming_content():
        # Stream the content in chunks
        chunk_size = 1024 * 1024  # 1MB chunks
        for i in range(0, len(file_content), chunk_size):
            yield file_content[i : i + chunk_size]

    return StreamingResponse(streaming_content(), media_type="application/zip")


def safe_filename(filename: str, fallback: str = "uploaded_song") -> str:
    """Reduce a client-supplied filename to a single path component.

    A directory picker hands back a relative path rather than a bare name, and
    the value is written to disk, so joining it unchecked writes wherever it
    points. PurePosixPath so a Windows-style separator is stripped too.
    """
    name = PurePosixPath(filename.replace("\\", "/")).name
    return fallback if name in ("", ".", "..") else name


def perform_music_separation(
    song_content: bytes,
    song_filename: str,
    model_name: str,
    song_files_dir: Path,
    cache_hash: str | None = None,
    on_progress: separation_progress.ProgressCallback | None = None,
    on_submitted: separation_backends.SubmittedCallback | None = None,
) -> Path:
    """Perform music separation and return the path to the created zip file.

    Args:
        song_content: The audio file content as bytes
        song_filename: The name of the song file
        model_name: The separation model to use
        song_files_dir: The temporary directory to work in
        cache_hash: Optional cache hash for logging context
        on_progress: Called with (fraction, stage) as the work advances
        on_submitted: Called with the ID of the task a remote backend runs it as

    Returns:
        Path to the created zip file containing separated tracks
    """
    song_file_path = song_files_dir / safe_filename(song_filename)
    with song_file_path.open("wb") as f:
        f.write(song_content)

    backend = separation_backends.get_backend()

    logger.info(
        "separation_started",
        backend=backend.name,
        cache_hash=cache_hash,
    )

    separated = backend.separate(
        song_file_path,
        song_files_dir,
        model_name,
        on_progress=on_progress,
        on_submitted=on_submitted,
    )
    return package_stems(separated, song_files_dir, cache_hash, on_progress)


def package_stems(
    separated: SeparationResult,
    song_files_dir: Path,
    cache_hash: str | None = None,
    on_progress: separation_progress.ProgressCallback | None = None,
) -> Path:
    """Zip the stems of a finished separation, returning the zip's path."""
    if on_progress:
        on_progress(1.0, separation_progress.PACKAGING_STAGE)

    zip_path = zip_helper.create_zip_file(
        song_files_dir / "split_song.zip",
        [
            (separated.accompaniment, separated.accompaniment.name),
            (separated.vocals, separated.vocals.name),
        ],
    )

    logger.info("zip_complete", path=zip_path, cache_hash=cache_hash)

    return zip_path


def process_track_separation_background(
    cache_hash: str, model_name: str, song_content: bytes, song_filename: str
):
    """Background task to process track separation and upload to cache.

    No progress is reported: the client polls the cache object directly rather
    than this service, so reporting would mean re-uploading the placeholder for
    every update.
    """
    logger.info("background_separation_started", cache_hash=cache_hash)

    with tempfile.TemporaryDirectory() as song_files_dir:
        song_files_dir_path = Path(song_files_dir)

        zip_path = perform_music_separation(
            song_content, song_filename, model_name, song_files_dir_path, cache_hash
        )

        # Upload to cache
        blob_name = f"separated_tracks/{cache_hash}.zip"
        logger.info(
            "background_uploading_to_cache", cache_hash=cache_hash, blob_name=blob_name
        )
        cloud_storage.upload_to_cache(cache_hash, zip_path)


def process_track_separation_local(
    cache_hash: str,
    run_id: str,
    model_name: str,
    song_content: bytes,
    song_filename: str,
):
    """Background task to process track separation into the local job store."""
    logger.info("local_separation_started", cache_hash=cache_hash)

    def separate(song_files_dir: Path, report) -> Path:
        return perform_music_separation(
            song_content,
            song_filename,
            model_name,
            song_files_dir,
            cache_hash,
            on_progress=report,
            on_submitted=lambda task_id: job_store.separations.mark_submitted(
                cache_hash, run_id, task_id
            ),
        )

    _run_local_job(job_store.separations, cache_hash, run_id, separate)


def resume_track_separation_local(cache_hash: str, run_id: str, task_id: str):
    """Background task that follows a remote task a previous server submitted."""
    logger.info("local_separation_resumed", cache_hash=cache_hash, task_id=task_id)

    def follow(song_files_dir: Path, report) -> Path:
        backend = separation_backends.get_backend()
        separated = backend.resume(task_id, song_files_dir, on_progress=report)
        return package_stems(separated, song_files_dir, cache_hash, report)

    _run_local_job(job_store.separations, cache_hash, run_id, follow)


def _run_local_job(
    store: job_store.JobStore,
    cache_hash: str,
    run_id: str,
    work: Callable[[Path, separation_progress.ProgressCallback], Path],
) -> None:
    """Run a job's work in a scratch directory, and record how it ended.

    `work` gets the directory and a progress callback, and returns the result file.
    """

    def report(progress: float | None, stage: str) -> None:
        # The job hands control back only to report,
        # so this is the one place a cancelled run can notice and unwind.
        if not store.is_current_run(cache_hash, run_id):
            raise job_store.JobCancelled()
        store.mark_progress(cache_hash, progress, stage)

    try:
        with tempfile.TemporaryDirectory() as song_files_dir:
            result = work(Path(song_files_dir), report)
            store.store_result(cache_hash, result)
    except job_store.JobCancelled:
        logger.info(f"local_{store.kind}_cancelled", cache_hash=cache_hash)
        store.mark_cancelled(cache_hash, run_id)
    except Exception as e:
        # The client is polling for this hash, so the failure has to be recorded rather than only logged,
        # or it will poll forever.
        logger.exception(f"local_{store.kind}_failed", cache_hash=cache_hash)
        store.mark_failed(cache_hash, str(e), run_id)


def alignment_hash(vocals: bytes, body: AlignmentRequest) -> str:
    """Return the key a sync's job is stored under.

    It covers the aligner's version, so a result from an older aligner is never served.
    """
    aligner = aligners.aligner_class(settings.ALIGNMENT_MODEL)
    digest = hashlib.sha256(hashlib.sha256(vocals).digest())
    digest.update(body.model_dump_json(exclude_none=True).encode("utf-8"))
    digest.update(f"{aligner.name}@{aligner.version}".encode())
    return digest.hexdigest()


def process_alignment_local(
    cache_hash: str,
    run_id: str,
    vocals_content: bytes,
    vocals_filename: str,
    request: dict,
):
    """Background task that syncs into the local job store."""
    logger.info("local_alignment_started", cache_hash=cache_hash)

    def align(work_dir: Path, report) -> Path:
        # The extension tells the decoder what the stem is.
        vocals = work_dir / safe_filename(vocals_filename, "vocals")
        vocals.write_bytes(vocals_content)
        result = alignment_backends.get_backend().align(
            vocals, request, work_dir, on_progress=report
        )
        result_path = work_dir / "result.json"
        result_path.write_text(json.dumps(result))
        return result_path

    _run_local_job(job_store.alignments, cache_hash, run_id, align)


async def queue_track_separation_local(
    cache_hash: str,
    run_id: str,
    model_name: str,
    song_content: bytes,
    song_filename: str,
):
    """Background task that waits its turn in line, then separates in a worker thread."""
    await _queue_local_job(
        job_store.separations,
        cache_hash,
        run_id,
        process_track_separation_local,
        model_name,
        song_content,
        song_filename,
    )


async def _queue_local_job(
    store: job_store.JobStore,
    cache_hash: str,
    run_id: str,
    process: Callable[..., None],
    *args,
    queue: job_queue.JobQueue | None = None,
) -> None:
    """Wait in line, then run `process(cache_hash, run_id, *args)` in a thread.

    The line is `queue`, or else the one separations wait in.
    """
    queue = queue or local_jobs
    try:
        async with queue.slot(
            run_id,
            on_wait=lambda ahead: store.mark_queued(cache_hash, run_id, ahead),
        ):
            if not store.mark_started(cache_hash, run_id):
                logger.info(f"local_{store.kind}_superseded", cache_hash=cache_hash)
                return
            await run_in_threadpool(process, cache_hash, run_id, *args)
    except job_queue.Withdrawn:
        logger.info(f"local_{store.kind}_withdrawn", cache_hash=cache_hash)
        store.mark_cancelled(cache_hash, run_id)


async def queue_resumed_separation_local(cache_hash: str, run_id: str, task_id: str):
    """Background task that waits its turn in line, then follows a remote task.

    It takes a slot like a new song, so the jobs a restart left running still
    count towards the limit.
    """
    try:
        async with local_jobs.slot(
            run_id,
            on_wait=lambda ahead: job_store.separations.mark_queued(
                cache_hash, run_id, ahead
            ),
        ):
            # A run cancelled or superseded meanwhile still goes ahead: its first
            # report unwinds it, and calls off the remote task on the way out.
            job_store.separations.mark_started(cache_hash, run_id)
            await run_in_threadpool(
                resume_track_separation_local, cache_hash, run_id, task_id
            )
    except job_queue.Withdrawn:
        logger.info("local_separation_withdrawn", cache_hash=cache_hash)
        job_store.separations.mark_cancelled(cache_hash, run_id)


def resume_remote_separations() -> None:
    """Pick up the remote tasks that a previous server left running.

    Assumes one worker process. A second would pick up every task too.
    """
    if settings.SEPARATED_TRACKS_BUCKET or not separation_backends.is_resumable(
        settings.SEPARATION_BACKEND
    ):
        return
    for cache_hash, status in job_store.separations.remote_jobs():
        job_store.separations.adopt(cache_hash, status["runId"])
        task = asyncio.get_running_loop().create_task(
            queue_resumed_separation_local(
                cache_hash, status["runId"], status["taskId"]
            )
        )
        # The loop holds only a weak reference, and a task nothing else holds can be collected mid-run.
        _resumed_separations.add(task)
        task.add_done_callback(_resumed_separations.discard)


_resumed_separations: set[asyncio.Task] = set()


@app.get("/")
async def index(request: Request):
    """Serve the main application page."""
    context = {
        "request": request,
        "vite_hmr_client": Markup(vite_assets.render_hmr_client()),
        "vite_assets": Markup(vite_assets.render_tags("index.ts")),
        "max_upload_bytes": settings.MAX_UPLOAD_BYTES,
        "default_separation_model": settings.DEFAULT_SEPARATION_MODEL,
        "app_name": settings.APP_NAME,
    }
    return templates.TemplateResponse("index.html", context)


SERVICE_WORKER = settings.STATIC_DIR / "bundles" / "sw.js"
SERVICE_WORKER_KILL_SWITCH = settings.BASE_DIR / "sw-kill.js"


@app.get("/sw.js")
async def service_worker():
    """Serve the service worker, or the one that removes it.

    The worker lives here rather than under /static/bundles/,
    so that its scope is the whole app.
    """
    use_kill_switch = (
        settings.DEBUG
        or settings.SERVICE_WORKER_KILL_SWITCH
        or not SERVICE_WORKER.exists()
    )
    return FileResponse(
        SERVICE_WORKER_KILL_SWITCH if use_kill_switch else SERVICE_WORKER,
        media_type="text/javascript",
        # Browsers otherwise reuse a cached worker script for up to a day before checking.
        headers={"Cache-Control": "no-cache"},
    )


@app.post("/separate_track")
async def separate_track(
    request: Request,
    background_tasks: BackgroundTasks,
    songFile: UploadFile = File(...),
    modelName: str = Form(...),
):
    """Return a zip containing vocal and accompaniment splits of songFile."""
    if not songFile or not modelName:
        raise HTTPException(
            status_code=400, detail="songFile and modelName are required"
        )
    # A remote backend would otherwise upload the whole song before the name was checked.
    if modelName not in AVAILABLE_MODELS:
        raise HTTPException(
            status_code=400, detail=f"Unknown separation model {modelName}"
        )

    if songFile.size is not None and songFile.size > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=UPLOAD_TOO_LARGE_MESSAGE)

    # Read file content
    song_content = await songFile.read()

    logger.info(
        "separate_tracks",
        song_size=len(song_content),
        model_name=modelName,
        client=client_address(request),
    )

    # Check if we can fetch from cache
    if settings.SEPARATED_TRACKS_BUCKET:
        cache_hash = cloud_storage.get_cache_hash(modelName, song_content)
        blob_name = f"separated_tracks/{cache_hash}.zip"
        logger.info("checking_cache", cache_hash=cache_hash, blob_name=blob_name)

        # Try to fetch from cache
        cache_result = cloud_storage.fetch_from_cache(cache_hash)
        if cache_result:
            # Cache found (either placeholder or completed) - return URL for client polling
            logger.info(
                "cache_found_returning_url",
                cache_hash=cache_hash,
                blob_name=blob_name,
                poll_url=cache_result,
            )
            return JobPollResponse(finishedTrackURL=cache_result)

    # If no cache hit or caching is disabled, proceed with track separation
    if settings.SEPARATED_TRACKS_BUCKET:
        # Create placeholder and get public URL for polling
        cache_hash = cloud_storage.get_cache_hash(modelName, song_content)
        start_separation_or_refuse(request)
        poll_url = cloud_storage.create_cache_placeholder(cache_hash)

        if poll_url:
            # Start background task to process separation
            background_tasks.add_task(
                process_track_separation_background,
                cache_hash,
                modelName,
                song_content,
                songFile.filename or "uploaded_song",
            )

            # Return URL immediately for client to poll
            logger.info("returning_poll_url", cache_hash=cache_hash, poll_url=poll_url)
            return JobPollResponse(finishedTrackURL=poll_url)
        else:
            logger.warning("failed_to_create_placeholder", cache_hash=cache_hash)
    else:
        # No bucket configured. Run the separation locally in the background and hand back a URL to poll:
        # a separation can take half an hour, far longer than a browser will hold a single request open.
        cache_hash = cloud_storage.get_cache_hash(modelName, song_content)

        if job_store.separations.result_path(cache_hash).exists():
            logger.info("local_cache_hit", cache_hash=cache_hash)
            return JobPollResponse(
                finishedTrackURL=job_store.separations.poll_url(cache_hash)
            )

        status = job_store.separations.read_status(cache_hash)
        if (
            status
            and status.get("status") == job_store.STATUS_PROCESSING
            and not status.get("cancelRequested")
            and not job_store.is_stale(status)
        ):
            # Already being separated. Point the client at the running job rather than doing the same work twice.
            logger.info("local_job_already_running", cache_hash=cache_hash)
            return JobPollResponse(
                finishedTrackURL=job_store.separations.poll_url(cache_hash)
            )

        # Anything else (a failed or cancelled job, or one whose worker died)
        # falls through to a fresh attempt,
        # so a single failure does not block the song forever.
        start_separation_or_refuse(request)
        job_store.separations.prune_expired_results()

        run_id = job_store.separations.mark_processing(cache_hash)
        background_tasks.add_task(
            queue_track_separation_local,
            cache_hash,
            run_id,
            modelName,
            song_content,
            songFile.filename or "uploaded_song",
        )

        logger.info("local_job_queued", cache_hash=cache_hash)
        return JobPollResponse(
            finishedTrackURL=job_store.separations.poll_url(cache_hash)
        )


@app.get("/separated_track/{cache_hash}")
async def separated_track(
    cache_hash: str = PathParam(..., pattern="^[0-9a-f]{64}$"),
):
    """Poll target for a separation running in the local job store.

    Returns the zip once the job has finished,
    JSON describing the job while it is still running or if it failed,
    and 404 for an unknown hash.
    The hash is constrained to a sha256 digest so it cannot escape the job directory.
    """
    return _poll_local_job(job_store.separations, cache_hash, "application/zip")


@app.post("/separated_track/{cache_hash}/cancel")
async def cancel_separated_track(
    cache_hash: str = PathParam(..., pattern="^[0-9a-f]{64}$"),
):
    """Call off a separation running in the local job store.

    A job still in line leaves it at once.
    A running one is best-effort: the worker stops at its next progress report,
    so a job still loading its model runs on until the separation itself starts.
    Reports whether there was a job to call off.
    """
    return _cancel_local_job(job_store.separations, cache_hash)


def _poll_local_job(store: job_store.JobStore, cache_hash: str, media_type: str):
    """Return a local job's result once it has one, and its status until then."""
    result = store.result_path(cache_hash)
    if result.exists():
        return FileResponse(result, media_type=media_type)

    status = store.read_status(cache_hash)
    if status is None:
        raise HTTPException(status_code=404, detail=f"Unknown {store.kind} job")

    if job_store.is_stale(status):
        logger.warning("local_job_stale", cache_hash=cache_hash, kind=store.kind)
        return JSONResponse(
            {"status": job_store.STATUS_ERROR, "error": store.stale_message}
        )

    if status.get("status") in (job_store.STATUS_ERROR, job_store.STATUS_CANCELLED):
        return JSONResponse(status)

    return JSONResponse(
        {**status, "pollIntervalSeconds": job_store.POLL_INTERVAL_SECONDS}
    )


def _cancel_local_job(store: job_store.JobStore, cache_hash: str) -> dict:
    status = store.read_status(cache_hash)
    cancelled = store.request_cancel(cache_hash)
    if cancelled:
        for queue in (local_jobs, remote_alignments):
            queue.withdraw(status["runId"])
    logger.info(
        f"local_{store.kind}_cancel_requested", cache_hash=cache_hash, running=cancelled
    )
    return {"cancelled": cancelled}


@app.post("/align_track")
async def align_track(
    request: Request,
    background_tasks: BackgroundTasks,
    vocalsFile: UploadFile = File(...),
    alignment_request: str = Form(..., alias="request"),
):
    """Start syncing lyrics to a vocals track, and return the URL to poll.

    `request` is JSON: every segment of the voice, in order, each marked to sync or to
    keep. A kept segment's times bound the audio the others are synced in.
    """
    if alignment_backends.configured_name() == alignment_backends.NONE:
        raise HTTPException(status_code=404, detail="Syncing is off on this server.")
    try:
        body = AlignmentRequest.model_validate_json(alignment_request)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.errors(include_url=False)) from e
    if not any(segment.sync for segment in body.segments):
        raise HTTPException(status_code=400, detail="No segment is marked to sync.")

    if vocalsFile.size is not None and vocalsFile.size > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=UPLOAD_TOO_LARGE_MESSAGE)
    vocals_content = await vocalsFile.read()

    store = job_store.alignments
    cache_hash = alignment_hash(vocals_content, body)
    logger.info(
        "align_track",
        cache_hash=cache_hash,
        vocals_size=len(vocals_content),
        segments=len(body.segments),
        client=client_address(request),
    )

    if store.result_path(cache_hash).exists():
        return JobPollResponse(finishedTrackURL=store.poll_url(cache_hash))

    status = store.read_status(cache_hash)
    if (
        status
        and status.get("status") == job_store.STATUS_PROCESSING
        and not status.get("cancelRequested")
        and not job_store.is_stale(status)
    ):
        return JobPollResponse(finishedTrackURL=store.poll_url(cache_hash))

    start_sync_or_refuse(request)
    store.prune_expired_results()
    run_id = store.mark_processing(cache_hash)
    background_tasks.add_task(
        _queue_local_job,
        store,
        cache_hash,
        run_id,
        process_alignment_local,
        vocals_content,
        vocalsFile.filename or "vocals",
        body.model_dump(exclude_none=True),
        queue=(
            remote_alignments
            if alignment_backends.configured_name()
            == alignment_backends.RemoteBackend.name
            else local_jobs
        ),
    )
    logger.info("local_alignment_queued", cache_hash=cache_hash)
    return JobPollResponse(finishedTrackURL=store.poll_url(cache_hash))


# Declared before /alignment/{cache_hash}, which would otherwise take the path.
@app.get("/alignment/available")
async def alignment_available():
    """Say whether this server can sync, which decides whether the page offers it."""
    return {
        "available": alignment_backends.configured_name() != alignment_backends.NONE
    }


@app.get("/alignment/{cache_hash}")
async def alignment_result(
    cache_hash: str = PathParam(..., pattern="^[0-9a-f]{64}$"),
):
    """Poll target for a sync.

    Returns the result once the job has finished, and the job's status until then,
    both as JSON. Only a status has a `status` field.
    """
    return _poll_local_job(job_store.alignments, cache_hash, "application/json")


@app.post("/alignment/{cache_hash}/cancel")
async def cancel_alignment(
    cache_hash: str = PathParam(..., pattern="^[0-9a-f]{64}$"),
):
    """Call off a sync, as /separated_track/{cache_hash}/cancel does a separation."""
    return _cancel_local_job(job_store.alignments, cache_hash)


@app.get("/download_video")
async def download_youtube_video(
    background_tasks: BackgroundTasks, youtube_url: str = Query(..., alias="url")
):
    """Download a YouTube video as audio and video streams and return them as a zip."""
    logger.info("download_youtube_video", youtube_url=youtube_url)

    if not youtube_url:
        raise HTTPException(status_code=400, detail="No url provided.")

    # Extract video ID from URL using pytube
    try:
        video_id = youtube_helper.get_video_id(youtube_url)
        logger.info("extracted_video_id", video_id=video_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # Check if we have storage configured
    if settings.SEPARATED_TRACKS_BUCKET:
        # Generate the expected GCS URL
        bucket_name = settings.SEPARATED_TRACKS_BUCKET
        poll_url = f"https://storage.googleapis.com/{bucket_name}/downloaded_videos/{video_id}.zip"

        # Start background task to process download
        background_tasks.add_task(
            youtube_helper.process_youtube_download_background, video_id, youtube_url
        )

        # Return URL immediately for client to poll
        logger.info("returning_youtube_poll_url", video_id=video_id, poll_url=poll_url)
        return DownloadPollResponse(finishedDownloadURL=poll_url)

    # Fallback to synchronous processing if no storage configured
    try:
        with tempfile.TemporaryDirectory() as song_files_dir:
            song_files_dir_path = Path(song_files_dir)
            zip_path = youtube_helper.download_and_zip_youtube(
                video_id, youtube_url, song_files_dir_path
            )
            return streamed_response(zip_path)
    except YouTubeException as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/lyrics/provider")
async def lyrics_provider_info():
    """Say which lyrics provider the server looks lyrics up with, if any."""
    if lyrics_provider is None:
        return {"provider": None}
    return {
        "provider": {
            "id": lyrics_provider.id,
            "name": lyrics_provider.name,
            "url": lyrics_provider.url,
        }
    }


# A POST keeps the song's title and artist out of the URL, which the access log records.
@app.post("/lyrics")
async def find_lyrics(request: Request, body: LyricsRequest):
    """Look up a song's lyrics with the configured provider."""
    if lyrics_provider is None:
        raise HTTPException(
            status_code=404, detail="Lyrics lookup is off on this server."
        )
    wait = lyrics_lookups.acquire(rate_limit_key(client_address(request)))
    if wait is not None:
        logger.warning("lyrics_rate_limited", retry_after=wait)
        raise HTTPException(
            status_code=429,
            detail=(
                "You have looked up as many lyrics as this server allows for now. "
                f"Try again in {_describe_wait(wait)}."
            ),
            headers={"Retry-After": str(math.ceil(wait))},
        )

    started = time.monotonic()
    query = lyrics.LyricsQuery(
        title=body.title, artist=body.artist, duration=body.duration
    )
    try:
        match = await lyrics_provider.find(query)
    except lyrics.LyricsProviderError as e:
        logger.warning(
            "lyrics_lookup",
            provider=lyrics_provider.id,
            outcome="provider_error",
            error=str(e),
            elapsed=round(time.monotonic() - started, 2),
        )
        raise HTTPException(
            status_code=502, detail=f"{lyrics_provider.name} couldn't be reached."
        ) from e

    if match is None:
        outcome = "not_found"
    elif match.instrumental:
        outcome = "instrumental"
    else:
        outcome = "found"
    logger.info(
        "lyrics_lookup",
        provider=lyrics_provider.id,
        outcome=outcome,
        elapsed=round(time.monotonic() - started, 2),
    )
    if match is None:
        raise HTTPException(status_code=404, detail="No lyrics found.")
    return {
        "lyrics": match.lyrics,
        "instrumental": match.instrumental,
        "match": {
            "title": match.title,
            "artist": match.artist,
            "album": match.album,
            "duration": match.duration,
            "url": match.url,
        },
    }


@app.post("/log_error")
async def log_error(error_data: LogErrorRequest):
    """Log client errors and warnings."""
    log = getattr(logger, error_data.level)
    log(
        f"Client {error_data.level}: {error_data.message or '<no message>'}",
        extra=error_data.model_dump(exclude={"level"}),
    )
    return {"success": True}


@app.api_route("/health", methods=["GET", "HEAD"])
async def health(request: Request):
    """Health-check endpoint for uptime monitors.

    GET -> returns JSON {"status": "ok"}
    HEAD -> returns empty 200
    """
    if request.method == "HEAD":
        return Response(status_code=200)
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=settings.HOST, port=settings.PORT)
