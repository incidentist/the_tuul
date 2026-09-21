# Stage 1: Frontend builder
FROM node:22-slim AS frontend-builder

ARG TUUL_API_HOSTNAME="" \
    TUUL_DONATE_URL="https://ko-fi.com/incidentist"

ENV TUUL_API_HOSTNAME=$TUUL_API_HOSTNAME \
    TUUL_DONATE_URL=$TUUL_DONATE_URL

WORKDIR /app

# Copy frontend source files
COPY package.json package-lock.json ./
RUN npm clean-install

# Copy the rest of the frontend source
COPY frontend/ ./frontend/
COPY vite.config.*.ts tsconfig.json jsconfig.json ./

# Build the frontend
RUN npm run build

# Use an official lightweight Python image.
# https://hub.docker.com/_/python
FROM python:3.13-slim AS backend-builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV APP_HOME=/app
# Setting this ensures print statements and log messages
# promptly appear in Cloud Logging.
ENV PYTHONUNBUFFERED=TRUE \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_CACHE_DIR=/tmp/uv_cache
WORKDIR $APP_HOME

# Install dependencies.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential

COPY ./uv.lock ./pyproject.toml ./

RUN uv sync --no-dev --no-install-project --locked

#
# RUNTIME IMAGE
#

FROM python:3.13-slim AS runner

ENV APP_HOME=/app \
    PYTHONUNBUFFERED=TRUE \
    VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    # Service must listen to $PORT environment variable.
    # This default value facilitates local development.
    PORT=8080 \
    WORKER_COUNT=1 \
    DEBUG=False \
    SECRET_KEY=SECRET_KEY \
    TUUL_YOUTUBE_PROXY= \
    SEPARATED_TRACKS_BUCKET= \
    SEPARATOR_SOCKET_PATH= 

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
CMD exec gunicorn --config gunicorn.conf.py api.main:app