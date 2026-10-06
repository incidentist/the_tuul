"""
Audio Separator API - Simple Modal Deployment
A FastAPI service for separating vocals from instrumental tracks using audio-separator

Features:
- Asynchronous job processing
- Progress tracking and status polling
- Persistent storage for models and outputs
- GPU acceleration support
- Multiple audio format support

Usage with Remote CLI:
1. Install audio-separator package: pip install audio-separator
2. Set environment variable: export AUDIO_SEPARATOR_API_URL="https://your-deployment-url.modal.run"
3. Use the remote CLI:
   - audio-separator-remote separate song.mp3
   - audio-separator-remote separate song.mp3 --model UVR-MDX-NET-Inst_HQ_4
   - audio-separator-remote status <task_id>
   - audio-separator-remote models
   - audio-separator-remote download <task_id> <filename>
"""

# Standard library imports
import logging
import os
import shutil
import subprocess
import traceback
import uuid
import json
import hashlib
from importlib.metadata import version
import typing
from typing import Optional

# Third-party imports
import modal

# Constants
DEFAULT_MODEL_NAME = "default"  # Used when no model is specified


def generate_file_hash(filename: str) -> str:
    """Generate a short, stable hash for a filename to use in download URLs."""
    # Use SHA-256 hash of the filename, take first 16 characters for brevity
    # This gives us a stable, URL-safe identifier that's much shorter than the filename
    return hashlib.sha256(filename.encode("utf-8")).hexdigest()[:16]


# Get the version of the installed audio-separator package
try:
    AUDIO_SEPARATOR_VERSION = version("audio-separator")
except Exception:
    # Fallback version if package version cannot be determined
    AUDIO_SEPARATOR_VERSION = "unknown"

# Create Modal app
app = modal.App("audio-separator")

# Modal already provides the NVIDIA driver, and torch's pip wheels bring the
# CUDA runtime libraries, which onnxruntime-gpu picks up because audio-separator
# imports torch first. So no CUDA base image or build toolchain is needed.
image = (
    modal.Image.debian_slim(python_version="3.14")
    .apt_install("ffmpeg", "libsndfile1", "libsamplerate0")
    # Pinned: audio-separator leaves its dependencies unbounded, and an
    # unannounced major release (librosa 1.0) has already broken a rebuild.
    .uv_pip_install(
        "audio-separator[gpu]==0.47.0",
        "librosa==1.0.0",
        # audio-separator imports audioread without declaring it.
        "audioread==3.1.0",
        # onnxruntime-gpu runs on the CUDA libraries torch's wheels bring, so
        # bump these two together and check the CUDA provider still loads.
        "torch==2.14.0",
        "onnxruntime-gpu==1.30.0",
        # FastAPI and web server dependencies for Modal API deployment
        "fastapi==0.141.1",
        "uvicorn[standard]==0.54.0",
        "python-multipart==0.0.32",
        # File type detection for response content type
        "filetype==1.2.0",
    )
    .env(
        {
            "AUDIO_SEPARATOR_MODEL_DIR": "/models",
            # Compile numba code for a generic x86 CPU, so the cache built below
            # (on Modal's build machines) stays valid on whatever host runs it.
            "NUMBA_CPU_NAME": "generic",
        }
    )
    # librosa's numba functions take ~30s to compile on first use -- nearly all
    # of a cold separation. They're declared cache=True, so compiling them here
    # bakes the cache into the image.
    .run_commands("python -c 'import librosa.util.utils'")
)

# Only installed in the container, not wherever `modal deploy` runs.
with image.imports():
    import filetype
    from audio_separator.separator import Separator
    from fastapi import FastAPI, File, Form, HTTPException, UploadFile
    from fastapi.middleware.cors import CORSMiddleware
    from starlette.responses import (
        FileResponse,
        PlainTextResponse,
        Response as StarletteResponse,
    )

# Create persistent volume for storing separated files
volume = modal.Volume.from_name("audio-separator-storage", create_if_missing=True)

# Create persistent volume for caching downloaded models
models_volume = modal.Volume.from_name("audio-separator-models", create_if_missing=True)

# Modal Dict for job status tracking is accessed by name in functions
# job_status_dict = modal.Dict.from_name("audio-separator-job-status", create_if_missing=True)


# T4 is Modal's cheapest GPU and plenty for the small ONNX separation models;
# L4 is the fallback when T4s are scarce. A short scaledown_window because jobs
# rarely reuse a warm container.
@app.function(
    image=image,
    gpu=["T4", "L4"],
    timeout=1200,
    volumes={"/storage": volume, "/models": models_volume},
    scaledown_window=60,
)
def separate_audio_function(
    audio_data: bytes,
    filename: str,
    models: Optional[list] = None,
    task_id: Optional[str] = None,
    # Separator parameters
    output_format: str = "flac",
    output_bitrate: Optional[str] = None,
    normalization_threshold: float = 0.9,
    amplification_threshold: float = 0.0,
    output_single_stem: Optional[str] = None,
    invert_using_spec: bool = False,
    sample_rate: int = 44100,
    use_soundfile: bool = False,
    use_autocast: bool = False,
    custom_output_names: Optional[dict] = None,
    # MDX parameters
    mdx_segment_size: int = 256,
    mdx_overlap: float = 0.25,
    mdx_batch_size: int = 1,
    mdx_hop_length: int = 1024,
    mdx_enable_denoise: bool = False,
    # VR parameters
    vr_batch_size: int = 1,
    vr_window_size: int = 512,
    vr_aggression: int = 5,
    vr_enable_tta: bool = False,
    vr_high_end_process: bool = False,
    vr_enable_post_process: bool = False,
    vr_post_process_threshold: float = 0.2,
    # Demucs parameters
    demucs_segment_size: str = "Default",
    demucs_shifts: int = 2,
    demucs_overlap: float = 0.25,
    demucs_segments_enabled: bool = True,
    # MDXC parameters
    mdxc_segment_size: int = 256,
    mdxc_override_model_segment_size: bool = False,
    mdxc_overlap: int = 8,
    mdxc_batch_size: int = 1,
    mdxc_pitch_shift: int = 0,
) -> dict:
    """
    Separate audio into stems using one or more models
    """
    if task_id is None:
        task_id = str(uuid.uuid4())

    # Default to single default model if no models specified
    if models is None or len(models) == 0:
        models = [None]  # None will use separator's default

    all_output_files = {}  # Dictionary mapping file hashes to filenames
    models_used = []
    current_model_index = 0
    total_models = len(models)

    def update_job_status(
        status: str, progress: int = 0, error: str = None, files: list = None
    ):
        """Update job status in Modal Dict"""
        status_data = {
            "task_id": task_id,
            "status": status,
            "progress": progress,
            "original_filename": filename,
            "models_used": models_used,
            "total_models": total_models,
            "current_model_index": current_model_index,
            "files": files or [],
        }
        if error:
            status_data["error"] = error

        # Access Modal Dict by name within function scope
        job_status = modal.Dict.from_name(
            "audio-separator-job-status", create_if_missing=True
        )
        job_status[task_id] = status_data

    # Container-local scratch for the decoded input; not worth keeping on the volume.
    decode_dir = f"/tmp/decode/{task_id}"

    try:
        # Ensure storage directories exist
        os.makedirs("/storage/uploads", exist_ok=True)
        os.makedirs("/storage/outputs", exist_ok=True)
        os.makedirs("/models", exist_ok=True)

        # Update status: starting
        update_job_status("processing", 5)

        # Create output directory
        output_dir = f"/storage/outputs/{task_id}"
        os.makedirs(output_dir, exist_ok=True)

        # Write uploaded file directly to output directory with original filename
        input_file_path = os.path.join(output_dir, filename)
        with open(input_file_path, "wb") as f:
            f.write(audio_data)

        # librosa (1.0+) only reads what libsndfile can, which leaves out m4a,
        # aac and webm, so decode everything to WAV first. Keeping the stem
        # keeps audio-separator's default output names the same.
        os.makedirs(decode_dir, exist_ok=True)
        wav_path = os.path.join(decode_dir, f"{os.path.splitext(filename)[0]}.wav")
        decoded = subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-loglevel",
                "error",
                "-y",
                "-i",
                input_file_path,
                wav_path,
            ],
            capture_output=True,
            text=True,
        )
        if decoded.returncode != 0:
            raise ValueError(f"Could not decode {filename}: {decoded.stderr.strip()}")

        update_job_status("processing", 10)

        # Process each model
        for model_index, model_name in enumerate(models):
            current_model_index = model_index
            base_progress = 10 + (model_index * 80 // total_models)
            model_progress_range = 80 // total_models

            print(
                f"Processing model {model_index + 1}/{total_models}: {model_name or 'default'}"
            )
            update_job_status("processing", base_progress + (model_progress_range // 4))

            # Initialize separator with all the provided parameters
            separator = Separator(
                log_level=logging.INFO,
                model_file_dir="/models",
                output_dir=output_dir,
                output_format=output_format,
                output_bitrate=output_bitrate,
                normalization_threshold=normalization_threshold,
                amplification_threshold=amplification_threshold,
                output_single_stem=output_single_stem,
                invert_using_spec=invert_using_spec,
                sample_rate=sample_rate,
                use_soundfile=use_soundfile,
                use_autocast=use_autocast,
                mdx_params={
                    "hop_length": mdx_hop_length,
                    "segment_size": mdx_segment_size,
                    "overlap": mdx_overlap,
                    "batch_size": mdx_batch_size,
                    "enable_denoise": mdx_enable_denoise,
                },
                vr_params={
                    "batch_size": vr_batch_size,
                    "window_size": vr_window_size,
                    "aggression": vr_aggression,
                    "enable_tta": vr_enable_tta,
                    "enable_post_process": vr_enable_post_process,
                    "post_process_threshold": vr_post_process_threshold,
                    "high_end_process": vr_high_end_process,
                },
                demucs_params={
                    "segment_size": demucs_segment_size,
                    "shifts": demucs_shifts,
                    "overlap": demucs_overlap,
                    "segments_enabled": demucs_segments_enabled,
                },
                mdxc_params={
                    "segment_size": mdxc_segment_size,
                    "batch_size": mdxc_batch_size,
                    "overlap": mdxc_overlap,
                    "override_model_segment_size": mdxc_override_model_segment_size,
                    "pitch_shift": mdxc_pitch_shift,
                },
            )

            # Load the model
            update_job_status("processing", base_progress + (model_progress_range // 2))
            if model_name:
                print(f"Loading specified model: {model_name}")
                separator.load_model(model_name)
                models_used.append(model_name)
            else:
                print(f"No model specified, using default model")
                separator.load_model()
                models_used.append("default")

            # Perform separation
            update_job_status(
                "processing", base_progress + (3 * model_progress_range // 4)
            )
            print(f"Separating audio file: {filename} with model: {models_used[-1]}")

            # Create custom output names for this model if multiple models
            model_custom_output_names = None
            if total_models > 1 and custom_output_names:
                # Add model name suffix to custom output names
                model_suffix = f"_{models_used[-1].replace('.', '_').replace('/', '_')}"
                model_custom_output_names = {
                    stem: f"{name}{model_suffix}"
                    for stem, name in custom_output_names.items()
                }
            elif custom_output_names:
                model_custom_output_names = custom_output_names

            output_files = separator.separate(
                wav_path, custom_output_names=model_custom_output_names
            )

            if not output_files:
                error_msg = f"Separation with model {models_used[-1]} completed but produced no output files"
                print(f"❌ {error_msg}")
                update_job_status("error", 0, error=error_msg)
                return {
                    "task_id": task_id,
                    "status": "error",
                    "error": error_msg,
                    "models_used": models_used,
                    "original_filename": filename,
                }

            # Convert full paths to filenames and add to collection with hashes
            model_result_files = [os.path.basename(f) for f in output_files]
            for filename in model_result_files:
                file_hash = generate_file_hash(filename)
                all_output_files[file_hash] = filename
            print(
                f"Model {models_used[-1]} produced {len(model_result_files)} files: {model_result_files}"
            )

        # Update final status
        update_job_status("processing", 95)
        print(f"All separations completed. Total output files: {len(all_output_files)}")

        # Commit volume changes
        volume.commit()
        models_volume.commit()

        # Update status: completed
        update_job_status("completed", 100, files=all_output_files)

        return {
            "task_id": task_id,
            "status": "completed",
            "files": all_output_files,
            "models_used": models_used,
            "original_filename": filename,
        }

    except FileNotFoundError as e:
        print(f"Input file not found: {str(e)}")
        traceback.print_exc()
        try:
            update_job_status("error", 0, error=f"Input file not found: {str(e)}")
        except Exception as status_error:
            print(f"WARNING: Failed to update job status: {status_error}")
        return {
            "task_id": task_id,
            "status": "error",
            "error": f"Input file not found: {str(e)}",
            "models_used": models_used,
            "original_filename": filename,
        }

    except ValueError as e:
        print(f"Invalid input or configuration: {str(e)}")
        traceback.print_exc()
        try:
            update_job_status("error", 0, error=f"Invalid input: {str(e)}")
        except Exception as status_error:
            print(f"WARNING: Failed to update job status: {status_error}")
        return {
            "task_id": task_id,
            "status": "error",
            "error": f"Invalid input: {str(e)}",
            "models_used": models_used,
            "original_filename": filename,
        }

    except Exception as e:
        print(f"Unexpected error during separation: {str(e)}")
        traceback.print_exc()
        try:
            update_job_status("error", 0, error=str(e))
        except Exception as status_error:
            print(f"WARNING: Failed to update job status: {status_error}")

        # Clean up on error
        if os.path.exists(input_file_path):
            os.unlink(input_file_path)
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir, ignore_errors=True)

        return {
            "task_id": task_id,
            "status": "error",
            "error": str(e),
            "models_used": models_used,
            "original_filename": filename,
        }

    finally:
        shutil.rmtree(decode_dir, ignore_errors=True)


@app.function(image=image, timeout=300, volumes={"/storage": volume})
def get_job_status_function(task_id: str) -> dict:
    """
    Get the status of a separation job
    """
    try:
        # Access Modal Dict by name within function scope
        job_status = modal.Dict.from_name(
            "audio-separator-job-status", create_if_missing=True
        )

        if task_id in job_status:
            return job_status[task_id]
        else:
            # Job not found - might be initializing or doesn't exist
            return {
                "task_id": task_id,
                "status": "not_found",
                "progress": 0,
                "error": "Job not found - may have been cleaned up or never existed",
            }
    except Exception as e:
        print(f"ERROR: Failed to access job status for {task_id}: {str(e)}")
        return {
            "task_id": task_id,
            "status": "error",
            "error": f"Failed to read status: {str(e)}",
        }


@app.function(image=image, timeout=300, volumes={"/storage": volume})
def get_file_function(task_id: str, filename: str) -> bytes:
    """
    Retrieve a separated audio file
    """
    file_path = f"/storage/outputs/{task_id}/{filename}"

    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {filename}")

    with open(file_path, "rb") as f:
        return f.read()


def output_filename_for_hash(files, file_hash: str) -> Optional[str]:
    """Find the output filename a job recorded under file_hash, or None."""
    # Jobs from before file hashes were introduced recorded a plain list.
    if isinstance(files, list):
        files = {generate_file_hash(filename): filename for filename in files}
    return files.get(file_hash)


@app.function(image=image, timeout=60, volumes={"/models": models_volume})
def list_available_models() -> dict:
    """
    List available separation models using the same approach as CLI
    """
    # Use the persistent model directory
    model_dir = "/models"

    # Ensure the model directory exists
    os.makedirs(model_dir, exist_ok=True)

    # Use the same approach as the CLI: create separator with info_only=True
    separator = Separator(info_only=True, model_file_dir=model_dir)

    # Get the list of supported models
    model_list = separator.list_supported_model_files()

    # Return the full model dictionary
    return model_list


@app.function(image=image, timeout=60, volumes={"/models": models_volume})
def get_simplified_models(filter_sort_by: str = None) -> dict:
    """
    Get simplified model list using the same approach as CLI --list_models
    """
    # Use the persistent model directory
    model_dir = "/models"

    # Ensure the model directory exists
    os.makedirs(model_dir, exist_ok=True)

    # Use the same approach as the CLI: create separator with info_only=True
    separator = Separator(info_only=True, model_file_dir=model_dir)

    # Get the simplified model list
    simplified_models = separator.get_simplified_model_list(
        filter_sort_by=filter_sort_by
    )

    return simplified_models


def create_web_app():
    """Build the FastAPI app. Only called in the container, where FastAPI is installed."""

    class PrettyJSONResponse(StarletteResponse):
        """Custom JSON response class for pretty-printing JSON"""

        media_type = "application/json"

        def render(self, content: typing.Any) -> bytes:
            return json.dumps(
                content,
                ensure_ascii=False,
                allow_nan=False,
                indent=4,
                separators=(", ", ": "),
            ).encode("utf-8")

    web_app = FastAPI(
        title="Audio Separator API",
        description="Separate vocals from instrumental tracks using AI",
        version=AUDIO_SEPARATOR_VERSION,
    )

    web_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


    @web_app.post("/separate")
    async def separate_audio(
        file: UploadFile = File(..., description="Audio file to separate"),
        # Model selection - support both single model and multiple models
        model: Optional[str] = Form(
            None,
            description="Single model to use for separation (for backwards compatibility)",
        ),
        models: Optional[str] = Form(
            None,
            description='JSON list of models to use for separation, e.g. ["model1.ckpt", "model2.onnx"]',
        ),
        # Output parameters
        output_format: str = Form("flac", description="Output format for separated files"),
        output_bitrate: Optional[str] = Form(
            None, description="Output bitrate for separated files"
        ),
        normalization_threshold: float = Form(
            0.9, description="Max peak amplitude to normalize audio to"
        ),
        amplification_threshold: float = Form(
            0.0, description="Min peak amplitude to amplify audio to"
        ),
        output_single_stem: Optional[str] = Form(
            None, description="Output only single stem (e.g. Vocals, Instrumental)"
        ),
        invert_using_spec: bool = Form(
            False, description="Invert secondary stem using spectrogram"
        ),
        sample_rate: int = Form(44100, description="Sample rate of output audio"),
        use_soundfile: bool = Form(False, description="Use soundfile for output writing"),
        use_autocast: bool = Form(
            False, description="Use PyTorch autocast for faster inference"
        ),
        custom_output_names: Optional[str] = Form(
            None, description="JSON dict of custom output names"
        ),
        # MDX parameters
        mdx_segment_size: int = Form(256, description="MDX segment size"),
        mdx_overlap: float = Form(0.25, description="MDX overlap"),
        mdx_batch_size: int = Form(1, description="MDX batch size"),
        mdx_hop_length: int = Form(1024, description="MDX hop length"),
        mdx_enable_denoise: bool = Form(False, description="Enable MDX denoising"),
        # VR parameters
        vr_batch_size: int = Form(1, description="VR batch size"),
        vr_window_size: int = Form(512, description="VR window size"),
        vr_aggression: int = Form(5, description="VR aggression"),
        vr_enable_tta: bool = Form(False, description="Enable VR Test-Time-Augmentation"),
        vr_high_end_process: bool = Form(
            False, description="Enable VR high end processing"
        ),
        vr_enable_post_process: bool = Form(False, description="Enable VR post processing"),
        vr_post_process_threshold: float = Form(
            0.2, description="VR post process threshold"
        ),
        # Demucs parameters
        demucs_segment_size: str = Form("Default", description="Demucs segment size"),
        demucs_shifts: int = Form(2, description="Demucs shifts"),
        demucs_overlap: float = Form(0.25, description="Demucs overlap"),
        demucs_segments_enabled: bool = Form(True, description="Enable Demucs segments"),
        # MDXC parameters
        mdxc_segment_size: int = Form(256, description="MDXC segment size"),
        mdxc_override_model_segment_size: bool = Form(
            False, description="Override MDXC model segment size"
        ),
        mdxc_overlap: int = Form(8, description="MDXC overlap"),
        mdxc_batch_size: int = Form(1, description="MDXC batch size"),
        mdxc_pitch_shift: int = Form(0, description="MDXC pitch shift"),
    ) -> dict:
        """
        Upload an audio file and separate it into stems using one or more models (asynchronous processing)
        """
        if not file.filename:
            raise HTTPException(status_code=400, detail="No file provided")

        try:
            # Parse models parameter
            models_list = None
            if models:
                try:
                    models_list = json.loads(models)
                    if not isinstance(models_list, list):
                        raise ValueError("Models must be a JSON list")
                except json.JSONDecodeError as e:
                    raise HTTPException(
                        status_code=400, detail=f"Invalid JSON in models parameter: {e}"
                    )
            elif model:
                # Backwards compatibility: single model parameter
                models_list = [model]
            # If neither provided, models_list stays None (will use default)

            # Parse custom_output_names if provided
            custom_output_names_dict = None
            if custom_output_names:
                try:
                    custom_output_names_dict = json.loads(custom_output_names)
                    if not isinstance(custom_output_names_dict, dict):
                        raise ValueError("Custom output names must be a JSON object")
                except json.JSONDecodeError as e:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid JSON in custom_output_names parameter: {e}",
                    )

            # Read file data
            audio_data = await file.read()

            # Generate task ID
            task_id = str(uuid.uuid4())

            # Create initial status in Modal Dict
            initial_status = {
                "task_id": task_id,
                "status": "submitted",
                "progress": 0,
                "original_filename": file.filename,
                "models_used": models_list or ["default"],
                "total_models": len(models_list) if models_list else 1,
                "current_model_index": 0,
                "files": [],
            }

            # Access Modal Dict by name to ensure proper scope
            job_status = modal.Dict.from_name(
                "audio-separator-job-status", create_if_missing=True
            )
            await job_status.put.aio(task_id, initial_status)

            # Submit job asynchronously with all parameters
            await separate_audio_function.spawn.aio(
                audio_data,
                file.filename,
                models_list,
                task_id,
                # Separator parameters
                output_format,
                output_bitrate,
                normalization_threshold,
                amplification_threshold,
                output_single_stem,
                invert_using_spec,
                sample_rate,
                use_soundfile,
                use_autocast,
                custom_output_names_dict,
                # MDX parameters
                mdx_segment_size,
                mdx_overlap,
                mdx_batch_size,
                mdx_hop_length,
                mdx_enable_denoise,
                # VR parameters
                vr_batch_size,
                vr_window_size,
                vr_aggression,
                vr_enable_tta,
                vr_high_end_process,
                vr_enable_post_process,
                vr_post_process_threshold,
                # Demucs parameters
                demucs_segment_size,
                demucs_shifts,
                demucs_overlap,
                demucs_segments_enabled,
                # MDXC parameters
                mdxc_segment_size,
                mdxc_override_model_segment_size,
                mdxc_overlap,
                mdxc_batch_size,
                mdxc_pitch_shift,
            )

            return {
                "task_id": task_id,
                "status": "submitted",
                "message": "Job submitted for processing. Use /status/{task_id} to check progress.",
                "models_used": models_list or ["default"],
                "total_models": len(models_list) if models_list else 1,
                "original_filename": file.filename,
            }
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Separation failed: {str(e)}"
            ) from e


    @web_app.get("/status/{task_id}")
    async def get_job_status(task_id: str) -> dict:
        """
        Get the status of a separation job
        """
        try:
            status_data = await get_job_status_function.remote.aio(task_id)
            return status_data
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Failed to get job status: {str(e)}"
            ) from e


    @web_app.get("/download/{task_id}/{file_hash}")
    async def download_file(task_id: str, file_hash: str) -> FileResponse:
        """
        Download a separated audio file using its hash identifier
        """
        job_status = modal.Dict.from_name(
            "audio-separator-job-status", create_if_missing=True
        )
        status_data = await job_status.get.aio(task_id)
        if status_data is None:
            raise HTTPException(status_code=404, detail="Task not found")

        actual_filename = output_filename_for_hash(
            status_data.get("files", {}), file_hash
        )
        if actual_filename is None:
            raise HTTPException(status_code=404, detail="File not found")

        # Read from this container's mount of the volume instead of shipping the
        # bytes through another function, which cost a cold start plus ~10s per
        # file. The separation committed from another container, so reload if
        # this container hasn't seen the file yet.
        file_path = f"/storage/outputs/{task_id}/{actual_filename}"
        if not os.path.exists(file_path):
            await volume.reload.aio()
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="File not found")

        detected_type = filetype.guess(file_path)
        if detected_type and detected_type.mime:
            content_type = detected_type.mime
        else:
            print(
                f"WARNING: Could not detect MIME type for {actual_filename}, using generic type"
            )
            content_type = "application/octet-stream"

        return FileResponse(
            file_path, media_type=content_type, filename=actual_filename
        )


    @web_app.get("/models-json")
    async def get_available_models() -> PrettyJSONResponse:
        """
        Get list of available separation models
        """
        models = await list_available_models.remote.aio()

        # Return pretty-printed JSON for better readability
        return PrettyJSONResponse(content=models)


    @web_app.get("/models")
    async def get_simplified_models_list(filter_sort_by: str = None) -> PlainTextResponse:
        """
        Get simplified model list in plain text format (like CLI --list_models)
        """
        models = await get_simplified_models.remote.aio(filter_sort_by=filter_sort_by)

        if not models:
            return PlainTextResponse("No models found")

        # Calculate maximum widths for each column
        filename_width = max(
            len("Model Filename"), max(len(filename) for filename in models.keys())
        )
        arch_width = max(len("Arch"), max(len(info["Type"]) for info in models.values()))
        stems_width = max(
            len("Output Stems (SDR)"),
            max(len(", ".join(info["Stems"])) for info in models.values()),
        )
        name_width = max(
            len("Friendly Name"), max(len(info["Name"]) for info in models.values())
        )

        # Calculate total width for separator line
        total_width = (
            filename_width + arch_width + stems_width + name_width + 15
        )  # 15 accounts for spacing between columns

        # Format the output with dynamic widths and extra spacing
        output_lines = []
        output_lines.append("-" * total_width)
        output_lines.append(
            f"{'Model Filename':<{filename_width}}  {'Arch':<{arch_width}}  {'Output Stems (SDR)':<{stems_width}}  {'Friendly Name'}"
        )
        output_lines.append("-" * total_width)

        for filename, info in models.items():
            stems = ", ".join(info["Stems"])
            output_lines.append(
                f"{filename:<{filename_width}}  {info['Type']:<{arch_width}}  {stems:<{stems_width}}  {info['Name']}"
            )

        return PlainTextResponse("\n".join(output_lines))


    @web_app.get("/health")
    async def health_check() -> dict:
        """
        Health check endpoint
        """
        return {
            "status": "healthy",
            "service": "audio-separator-api",
            "version": AUDIO_SEPARATOR_VERSION,
        }


    @web_app.get("/")
    async def root() -> dict:
        """
        Root endpoint with API information
        """
        return {
            "message": "Audio Separator API",
            "version": AUDIO_SEPARATOR_VERSION,
            "description": (
                "Separate vocals from instrumental tracks using AI - "
                "supports all formats and parameters that audio-separator CLI supports"
            ),
            "features": [
                "Multiple model processing in single job",
                "Full separator parameter compatibility",
                "Asynchronous processing with progress tracking",
                "All MDX, VR, Demucs, and MDXC architectures supported",
                "Custom output naming and format options",
            ],
            "endpoints": {
                "POST /separate": "Upload and separate audio file (supports multiple models and all separator parameters)",
                "GET /status/{task_id}": "Get job status and progress (includes model-specific progress and file hashes)",
                "GET /download/{task_id}/{file_hash}": "Download separated file using hash identifier (avoids URL length limits)",
                "GET /models-json": "List available models (JSON format)",
                "GET /models": "List available models (plain text format like CLI --list_models)",
                "GET /health": "Health check",
            },
            "note": (
                "Full-featured wrapper around audio-separator with complete parameter compatibility"
            ),
            "remote_cli": {
                "install": "pip install audio-separator",
                "setup": 'export AUDIO_SEPARATOR_API_URL="https://your-deployment-url.modal.run"',
                "usage": [
                    "audio-separator-remote separate song.mp3",
                    "audio-separator-remote separate song.mp3 --model UVR-MDX-NET-Inst_HQ_4",
                    "audio-separator-remote separate song.mp3 --models model1.ckpt model2.onnx",
                    'audio-separator-remote separate song.mp3 --custom_output_names \'{"Vocals": "lead_vocals"}\'',
                    "audio-separator-remote status <task_id>",
                    "audio-separator-remote models --filter vocals",
                ],
            },
        }

    return web_app


@app.function(
    image=image, timeout=600, scaledown_window=300, volumes={"/storage": volume}
)
@modal.asgi_app()
def api():
    """
    Deploy the FastAPI app as a Modal ASGI application
    """
    return create_web_app()
