import tempfile
from pathlib import Path
from typing import Literal, Optional

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
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from markupsafe import Markup
from pydantic import BaseModel

from . import settings
from . import app_logging
from .karaoke import music_separation
from .karaoke.music_separation import SeparationMethod
from .karaoke.separation_queue import SeparationQueue, SeparationQueueFullError
from .helpers import youtube_helper, zip_helper, cloud_storage
from .helpers.youtube_helper import YouTubeException
from .vite_assets import vite_assets

# Configure logging
app_logging.setup()
logger = structlog.get_logger(__name__)

# Create FastAPI app
app = FastAPI(title="The Tuul API", debug=settings.DEBUG)

# In-process separations ("api"/"cli") run one at a time through here. With
# "compose_provider" the separator server does its own queueing instead, and
# with "modal_api" Modal runs concurrent separations in separate containers.
separation_queue = SeparationQueue(
    max_pending=settings.SEPARATION_QUEUE_MAX_PENDING, name="app"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Custom middleware for SharedArrayBuffer headers
@app.middleware("http")
async def add_sharedarraybuffer_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    return response


# Static files and templates
app.mount("/static", StaticFiles(directory=settings.STATIC_DIR), name="static")
templates = Jinja2Templates(directory=settings.TEMPLATES_DIR)


# Pydantic models
class LogRequest(BaseModel):
    severity: Literal["debug", "info", "warning", "error"] = "error"
    message: Optional[str] = None
    stack: Optional[str] = None
    url: Optional[str] = None
    line: Optional[int] = None
    column: Optional[int] = None


class SeparationPollResponse(BaseModel):
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


def perform_music_separation(
    song_content: bytes,
    song_filename: str,
    model_name: str,
    song_files_dir: Path,
    cache_hash: Optional[str] = None,
) -> Path:
    """Perform music separation and return the path to the created zip file.

    Blocks until the separation is done, including any wait in the queue, so
    call it from a thread, never from the event loop. Raises
    SeparationQueueFullError if the queue is already full.

    Args:
        song_content: The audio file content as bytes
        song_filename: The name of the song file
        model_name: The separation model to use
        song_files_dir: The temporary directory to work in
        cache_hash: Optional cache hash for logging context

    Returns:
        Path to the created zip file containing separated tracks
    """
    # Save uploaded file
    song_file_path = song_files_dir / song_filename
    with song_file_path.open("wb") as f:
        f.write(song_content)

    separation_method = SeparationMethod(settings.SEPARATION_METHOD)

    logger.info(
        "separation_started",
        method=separation_method,
        cache_hash=cache_hash,
    )

    split_args = (song_file_path, song_files_dir)
    split_kwargs = {"model_name": model_name, "method": separation_method}
    if separation_method.runs_in_process:
        # Separates right here in our process, one at a time via the queue.
        accompaniment_path, vocal_path = separation_queue.run(
            music_separation.split_song, *split_args, **split_kwargs
        )
    else:
        # Calls out to a remote separator (the Compose provider's host process,
        # or Modal), which handles its own concurrency.
        accompaniment_path, vocal_path = music_separation.split_song(
            *split_args, **split_kwargs
        )
    zip_path = zip_helper.create_zip_file(
        song_files_dir / "split_song.zip",
        [(accompaniment_path, "accompaniment.wav"), (vocal_path, "vocals.wav")],
    )

    logger.info("zip_complete", path=zip_path, cache_hash=cache_hash)

    return zip_path


def process_track_separation_background(
    cache_hash: str, model_name: str, song_content: bytes, song_filename: str
):
    """Background task to process track separation and upload to cache.

    Runs after the response has gone out, on a threadpool thread (FastAPI runs
    sync background tasks that way), so it is free to block on the queue.

    The client is polling the cache placeholder, so any failure has to be
    written there -- otherwise the client polls a "processing" placeholder
    forever.
    """
    logger.info("background_separation_started", cache_hash=cache_hash)

    try:
        with tempfile.TemporaryDirectory() as song_files_dir:
            song_files_dir_path = Path(song_files_dir)

            zip_path = perform_music_separation(
                song_content, song_filename, model_name, song_files_dir_path, cache_hash
            )

            # Upload to cache
            blob_name = f"separated_tracks/{cache_hash}.zip"
            logger.info(
                "background_uploading_to_cache",
                cache_hash=cache_hash,
                blob_name=blob_name,
            )
            uploaded = cloud_storage.upload_to_cache(cache_hash, zip_path)
    except Exception:
        logger.exception("background_separation_failed", cache_hash=cache_hash)
        uploaded = False

    if not uploaded:
        cloud_storage.mark_cache_failed(cache_hash)


def separate_to_zip_response(
    song_content: bytes, song_filename: str, model_name: str
) -> StreamingResponse:
    """Separate a song and return the zip as a response. Blocking: run it on a
    thread, never on the event loop."""
    with tempfile.TemporaryDirectory() as song_files_dir:
        zip_path = perform_music_separation(
            song_content, song_filename, model_name, Path(song_files_dir)
        )
        return streamed_response(zip_path)


@app.get("/")
async def index(request: Request):
    """Serve the main application page."""
    context = {
        "vite_hmr_client": Markup(vite_assets.render_hmr_client()),
        "vite_assets": Markup(vite_assets.render_tags("index.ts")),
    }
    return templates.TemplateResponse(request, "index.html", context)


@app.post("/separate_track")
async def separate_track(
    background_tasks: BackgroundTasks,
    songFile: UploadFile = File(...),
    modelName: str = Form(...),
):
    """Return a zip containing vocal and accompaniment splits of songFile."""
    if not songFile or not modelName:
        raise HTTPException(
            status_code=400, detail="songFile and modelName are required"
        )

    # Read file content
    song_content = await songFile.read()

    logger.info(
        "separate_tracks",
        song_size=len(song_content),
        model_name=modelName,
    )

    song_filename = songFile.filename or "uploaded_song"

    # Everything below blocks -- hashing a whole song, GCS round trips,
    # separation -- so it runs on threadpool threads. On the event loop it would
    # stall every other request for its duration.
    if settings.SEPARATED_TRACKS_BUCKET:
        cache_hash = await run_in_threadpool(
            cloud_storage.get_cache_hash, modelName, song_content
        )
        blob_name = f"separated_tracks/{cache_hash}.zip"
        logger.info("checking_cache", cache_hash=cache_hash, blob_name=blob_name)

        # Try to fetch from cache
        cache_result = await run_in_threadpool(
            cloud_storage.fetch_from_cache, cache_hash
        )
        if cache_result:
            # Cache found (either placeholder or completed) - return URL for client polling
            logger.info(
                "cache_found_returning_url",
                cache_hash=cache_hash,
                blob_name=blob_name,
                poll_url=cache_result,
            )
            return SeparationPollResponse(finishedTrackURL=cache_result)

        # Cache miss: create placeholder and get public URL for polling
        poll_url = await run_in_threadpool(
            cloud_storage.create_cache_placeholder, cache_hash
        )

        if poll_url:
            # Start background task to process separation
            background_tasks.add_task(
                process_track_separation_background,
                cache_hash,
                modelName,
                song_content,
                song_filename,
            )

            # Return URL immediately for client to poll
            logger.info("returning_poll_url", cache_hash=cache_hash, poll_url=poll_url)
            return SeparationPollResponse(finishedTrackURL=poll_url)
        else:
            logger.warning("failed_to_create_placeholder", cache_hash=cache_hash)
    else:
        # No caching - process synchronously
        logger.info("synchronous_separation_started")
        try:
            return await run_in_threadpool(
                separate_to_zip_response, song_content, song_filename, modelName
            )
        except SeparationQueueFullError as e:
            logger.warning("separation_queue_full", error=str(e))
            raise HTTPException(
                status_code=503, detail="The server is busy. Try again later."
            )


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
        raise HTTPException(status_code=400, detail=str(e))

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
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/log")
async def log(log_data: LogRequest):
    """Log a client-side message at the severity the client reports."""
    log_at_severity = getattr(logger, log_data.severity)
    log_at_severity(
        f"Client {log_data.severity}: {log_data.message or '<no message>'}",
        extra=log_data.model_dump(),
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
