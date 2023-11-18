# Use an official lightweight Python image.
# https://hub.docker.com/_/python
FROM python:3.9-slim

ENV APP_HOME=/app
# Setting this ensures print statements and log messages
# promptly appear in Cloud Logging.
ENV PYTHONUNBUFFERED=TRUE \
    POETRY_VERSION=1.7.1 \
    # make poetry install to this location
    POETRY_HOME="/opt/poetry" 
WORKDIR $APP_HOME

# prepend poetry and venv to path
# ENV PATH "$POETRY_HOME/bin:$PATH"


# Install dependencies.
RUN apt-get update \
    && apt-get install -y ffmpeg \
    && pip install "poetry==$POETRY_VERSION"

COPY ./poetry.lock ./pyproject.toml ./

RUN poetry config virtualenvs.create false \
    && poetry install --no-dev --no-interaction

# Copy local code to the container image.
COPY api .
RUN poetry run ./manage.py collectstatic --noinput

# Service must listen to $PORT environment variable.
# This default value facilitates local development.
ENV PORT 8080
EXPOSE $PORT

# Run the web service on container startup. Here we use the gunicorn
# webserver, with one worker process and 8 threads.
# For environments with multiple CPU cores, increase the number of workers
# to be equal to the cores available.
CMD exec gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 8 --timeout 0 wsgi:application