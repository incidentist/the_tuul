#!/usr/bin/env python3
"""
FastAPI app for GPU-accelerated music separation on host machine.

This server runs on the host (outside Docker) to provide GPU access for music separation.
The containerized Tuul app communicates with this server via TCP on localhost.
"""

import asyncio
import base64
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional
import logging

import structlog

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import app_logging
from . import settings

# Import model constants and split_song function from the main separation module for DRY
from .karaoke.music_separation import (
    AVAILABLE_MODELS,
    DEFAULT_MODEL,
    split_song,
    SeparationMethod,
)
from .karaoke.separation_queue import SeparationQueue, SeparationQueueFullError

# Setup logging
logging.basicConfig(level=logging.INFO)
app_logging.setup()
logger = structlog.get_logger(__name__)

app = FastAPI(title="Separator Socket API", version="1.0.0")

# Every separation this server runs goes through here, one at a time.
separation_queue = SeparationQueue(
    max_pending=settings.SEPARATION_QUEUE_MAX_PENDING, name="separator"
)


class SeparationRequest(BaseModel):
    model_name: str = DEFAULT_MODEL
    audio_base64: str
    filename: str = "audio.wav"


class SeparationResponse(BaseModel):
    success: bool
    vocals_base64: Optional[str] = None
    accompaniment_base64: Optional[str] = None
    vocals_filename: Optional[str] = None
    accompaniment_filename: Optional[str] = None
    error: Optional[str] = None


@app.get("/health")
async def health():
    """Readiness probe for the Compose provider.

    The provider polls this while waiting for startup. It exists so that check
    does not depend on /docs, which FastAPI only serves incidentally and which
    says nothing about whether the app is ready to separate.
    """
    return {"status": "ok"}


@app.post("/separate", response_model=SeparationResponse)
async def separate_track(request: SeparationRequest):
    """
    Separate audio track into vocals and accompaniment.

    Separations run one at a time through the queue, so this may wait a long
    time before it answers. It waits without blocking the event loop, so
    /health and newly arriving requests are still served meanwhile. Returns 503
    if the queue is already full.
    """
    logger.info(
        "separation_request", model_name=request.model_name, filename=request.filename
    )

    # Validate model
    if request.model_name not in AVAILABLE_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Model {request.model_name} not found. Available: {AVAILABLE_MODELS}",
        )

    try:
        job = separation_queue.submit(_separate, request)
    except SeparationQueueFullError as e:
        logger.warning("separation_queue_full", error=str(e))
        raise HTTPException(status_code=503, detail=str(e))

    return await asyncio.wrap_future(job)


def _separate(request: SeparationRequest) -> SeparationResponse:
    """Run one separation. Called on the queue's worker thread, never the event
    loop: everything here, decoding included, is blocking work."""
    # Decode audio from base64
    try:
        audio_data = base64.b64decode(request.audio_base64)
    except Exception as e:
        logger.error("base64_decode_failed", error=str(e))
        return SeparationResponse(
            success=False, error=f"Invalid base64 audio data: {e}"
        )

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Write input audio file
        input_file = temp_path / request.filename
        with input_file.open("wb") as f:
            f.write(audio_data)

        logger.info(
            "processing_separation",
            model=request.model_name,
            input_size=len(audio_data),
            input_file=str(input_file),
        )

        try:
            accompaniment_file, vocals_file = split_song(
                input_file, temp_path, request.model_name, method=SeparationMethod.API
            )

            logger.info(
                "separation_completed",
                vocals=vocals_file.name,
                accompaniment=accompaniment_file.name,
            )

            # Read and encode output files
            vocals_data = vocals_file.read_bytes()
            accompaniment_data = accompaniment_file.read_bytes()

            return SeparationResponse(
                success=True,
                vocals_base64=base64.b64encode(vocals_data).decode("utf-8"),
                accompaniment_base64=base64.b64encode(accompaniment_data).decode(
                    "utf-8"
                ),
                vocals_filename="vocals.wav",
                accompaniment_filename="accompaniment.wav",
            )

        except subprocess.CalledProcessError as e:
            logger.error(
                "separation_subprocess_failed", stderr=e.stderr, returncode=e.returncode
            )
            return SeparationResponse(
                success=False, error=f"Separation failed: {e.stderr}"
            )
        except FileNotFoundError as fnf:
            logger.error("audio_separator_not_found", error=str(fnf))
            return SeparationResponse(
                success=False,
                error="audio-separator command not found. Please install audio-separator CLI tool.",
            )
        except Exception as e:
            logger.error("separation_error", error=str(e))
            return SeparationResponse(success=False, error=str(e))


if __name__ == "__main__":
    import uvicorn

    # Bind all interfaces so containers can reach us via host.docker.internal.
    # Compose's provider in infra/compose-separation-provider/ starts us this way.
    uvicorn.run(
        app,
        host=os.getenv("SEPARATOR_BIND_HOST", "0.0.0.0"),
        port=settings.SEPARATOR_PORT,
        log_level="info",
    )
