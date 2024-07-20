# Use an official lightweight Python image.
# https://hub.docker.com/_/python
FROM python:3.11-slim AS builder

ENV APP_HOME=/app
# Setting this ensures print statements and log messages
# promptly appear in Cloud Logging.
ENV PYTHONUNBUFFERED=TRUE \
    POETRY_VERSION=1.8.3 \
    POETRY_VIRTUALENVS_IN_PROJECT=1 \
    POETRY_VIRTUALENVS_CREATE=1 \
    POETRY_CACHE_DIR=/tmp/poetry_cache
WORKDIR $APP_HOME

# prepend poetry and venv to path
# ENV PATH "$POETRY_HOME/bin:$PATH"

# Install dependencies.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg build-essential \
    && pip install "poetry==$POETRY_VERSION" \
    && poetry config virtualenvs.create false

COPY ./poetry.lock ./pyproject.toml ./

RUN poetry install --without dev --no-root --no-interaction --no-ansi

#
# RUNTIME IMAGE
#

# Note that this image does not use poetry at all

FROM python:3.11-slim AS runner

ENV APP_HOME=/app \
    PYTHONUNBUFFERED=TRUE \
    VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    # Service must listen to $PORT environment variable.
    # This default value facilitates local development.
    PORT=8080 \
    WORKER_COUNT=1

WORKDIR $APP_HOME

# Copy installed dependencies from builder
COPY --from=builder $VIRTUAL_ENV $VIRTUAL_ENV

# Install runtime dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && apt-get remove -y build-essential \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Copy local code to the container image.
COPY api .
RUN ./manage.py collectstatic --noinput

EXPOSE $PORT

# Run the web service on container startup. Here we use the gunicorn
# webserver, with one worker process and 8 threads.
# For environments with multiple CPU cores, increase the number of workers
# to be equal to the cores available.
CMD exec gunicorn --bind 0.0.0.0:$PORT --workers $WORKER_COUNT --threads 8 --timeout 0 wsgi:application