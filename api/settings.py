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
