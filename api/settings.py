"""
FastAPI application settings.
"""

import os
from pathlib import Path

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.getenv("SECRET_KEY", "frabbaglabba")

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = os.getenv("DEBUG", "True") != "False"

# Google Cloud Storage bucket for caching separated tracks
SEPARATED_TRACKS_BUCKET = os.getenv("SEPARATED_TRACKS_BUCKET", "")

# YouTube proxy settings
TUUL_YOUTUBE_PROXY = os.getenv("TUUL_YOUTUBE_PROXY", "")

# Valid values are 'console' or 'gcp'
LOGGING_FORMAT = os.getenv("LOGGING_FORMAT", "console")

# Static files configuration
STATIC_DIR = BASE_DIR / "assets"


# Templates directory
TEMPLATES_DIR = BASE_DIR / "templates"

# CORS settings
CORS_ALLOW_ALL_ORIGINS = True

# Server settings
HOST = "0.0.0.0"
PORT = int(os.getenv("PORT", "8000"))

# Separator settings (for GPU access on host)
# SEPARATOR_URL is injected by the Docker Compose provider in
# infra/compose-separation-provider/ into services that `depends_on` the separator
# service. Set it by hand only when running the separator yourself.
SEPARATOR_URL = os.getenv("SEPARATOR_URL", "")

# Port the separator server binds to when run directly (see api/separator_server.py).
SEPARATOR_PORT = int(os.getenv("SEPARATOR_PORT", "8001"))

# Separation method used by the web app: "api", "cli", or "compose_provider".
SEPARATION_METHOD = os.getenv("SEPARATION_METHOD", "api")

# Separations run one at a time (see api/karaoke/separation_queue.py). This is
# how many may wait in line, including the running one, before new requests
# are turned away. Applies to the web app with "api"/"cli", and to the
# separator server, which queues for "compose_provider".
#
# Keep it well under 40: each queued separation holds one of the web app's
# threadpool threads while it waits, and AnyIO's pool (which also serves static
# files) has 40.
SEPARATION_QUEUE_MAX_PENDING = int(os.getenv("SEPARATION_QUEUE_MAX_PENDING", "20"))

# How long the web app waits for the separator server to answer a separation,
# including time spent waiting in its queue. Long, because a full queue is
# hours of work.
SEPARATOR_TIMEOUT_SECONDS = int(os.getenv("SEPARATOR_TIMEOUT_SECONDS", str(6 * 3600)))

# A "processing" placeholder in the GCS cache older than this is assumed to
# belong to a separation that was lost (e.g. a restart), and a new request for
# the same song separates it again instead of waiting on it forever.
SEPARATION_PLACEHOLDER_STALE_SECONDS = int(
    os.getenv("SEPARATION_PLACEHOLDER_STALE_SECONDS", str(6 * 3600))
)
