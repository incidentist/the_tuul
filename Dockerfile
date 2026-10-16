# Stage 1: Frontend builder
FROM node:22-slim AS frontend-builder

ARG TUUL_API_HOSTNAME=""
ARG TUUL_DONATE_URL=""
ARG INTRO_MARKDOWN=""

ENV TUUL_API_HOSTNAME=$TUUL_API_HOSTNAME \
    TUUL_DONATE_URL=$TUUL_DONATE_URL \
    INTRO_MARKDOWN=$INTRO_MARKDOWN

WORKDIR /app

# Copy frontend source files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/ ./patches/
RUN corepack enable && pnpm install --frozen-lockfile

# Copy the rest of the frontend source
COPY frontend/ ./frontend/
COPY vite.config.*.ts tsconfig.json ./
# The service worker's precache revisions hash the page template and the static files.
COPY api/assets ./api/assets
COPY api/templates ./api/templates

# Build the frontend
RUN pnpm run build

# Use an official lightweight Python image.
# https://hub.docker.com/_/python
FROM python:3.13-slim AS backend-builder

ENV APP_HOME=/app
# Setting this ensures print statements and log messages
# promptly appear in Cloud Logging.
ENV PYTHONUNBUFFERED=TRUE \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
WORKDIR $APP_HOME

COPY --from=ghcr.io/astral-sh/uv:0.12.23 /uv /usr/local/bin/uv

# Install dependencies.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential

COPY ./uv.lock ./pyproject.toml ./

# Torch is roughly 2 GB of the image and is needed only where separation or syncing
# runs in this container. A deployment that runs both elsewhere leaves this false.
ARG INSTALL_ML=false

RUN if [ "$INSTALL_ML" = "true" ]; then \
        uv sync --frozen --no-dev --group ml --no-cache; \
    else \
        uv sync --frozen --no-dev --no-cache; \
    fi

# The lock pins the CPU builds. `cuda` swaps them for the CUDA builds of the same
# versions, for an image that separates on an NVIDIA GPU. onnxruntime-gpu loads
# the CUDA and cuDNN libraries that the torch wheels bring.
ARG SEPARATION_DEVICE=cpu

RUN if [ "$INSTALL_ML" = "true" ] && [ "$SEPARATION_DEVICE" = "cuda" ]; then \
        uv pip install --python .venv/bin/python --no-cache \
            --extra-index-url https://download.pytorch.org/whl/cu128 \
            "torch==2.7.1+cu128" "torchvision==0.22.1+cu128" "torchaudio==2.7.1+cu128" \
        && uv pip uninstall --python .venv/bin/python onnxruntime \
        && uv pip install --python .venv/bin/python --no-cache "onnxruntime-gpu==1.22.0"; \
    fi

#
# RUNTIME IMAGE
#

FROM python:3.13-slim AS runner


# Service must listen to $PORT environment variable.
# The default value facilitates local development.
ENV APP_HOME=/app \
    PYTHONUNBUFFERED=TRUE \
    VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    PORT=8080 \
    WORKER_COUNT=1 \
    DEBUG=False \
    YOUTUBE_SOCKS5_PROXY="" \
    SEPARATED_TRACKS_BUCKET=""

# With a child process per separation, running out of memory kills that child, not the web worker.
# A recycled worker would take its background separations with it.
ENV SEPARATION_BACKEND=subprocess \
    MAX_REQUESTS=0

WORKDIR $APP_HOME

# Copy installed dependencies from builder
COPY --from=backend-builder $VIRTUAL_ENV $VIRTUAL_ENV

# Install runtime dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && apt-get remove -y build-essential \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Copy local code to the container image.
COPY api api
# Copy gunicorn configuration
COPY gunicorn.conf.py pyproject.toml uv.lock ${APP_HOME}

# Copy frontend static files from the node builder to the correct location
# for FastAPI to serve them
COPY --from=frontend-builder /app/api/assets/bundles api/assets/bundles

EXPOSE $PORT

# Run the web service on container startup using gunicorn with uvicorn workers
# Configuration handles workers, port, and other production settings
CMD ["gunicorn", "--config", "gunicorn.conf.py", "api.main:app"]