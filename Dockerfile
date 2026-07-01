# CUDA base image with build tools
FROM nvidia/cuda:12.2.0-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV APP_HOME=/app
ENV PYTHONUNBUFFERED=TRUE \
    POETRY_VERSION=1.7.1 \
    POETRY_HOME="/opt/poetry"

WORKDIR $APP_HOME

# ────── Install System Dependencies & Python 3.11 ──────
RUN apt-get update && \
    apt-get install -y --no-install-recommends software-properties-common gnupg2 && \
    add-apt-repository ppa:deadsnakes/ppa -y && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        python3.11 python3.11-dev python3.11-distutils \
        curl git build-essential pkg-config \
        yasm nasm cmake ninja-build \
        libx264-dev libx265-dev libvpx-dev \
        libfdk-aac-dev libmp3lame-dev libopus-dev \
        libssl-dev zlib1g-dev \
        libass-dev libfreetype6-dev libfontconfig1-dev libfribidi-dev libharfbuzz-dev \
        libsndfile1 \
        wget unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Make Python 3.11 the default when calling 'python3' AND 'python'
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 && \
    update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1

# Install pip for Python 3.11, then install Poetry
RUN curl -sS https://bootstrap.pypa.io/get-pip.py | python3 && \
    python3 -m pip install "poetry==$POETRY_VERSION"

# ────── Build ffnvcodec (required for --enable-nvenc) ──────
RUN mkdir -p /ffmpeg_sources && \
    cd /ffmpeg_sources && \
    git clone https://github.com/FFmpeg/nv-codec-headers.git && \
    cd nv-codec-headers && \
    make && make install

# ────── Build FFmpeg from source with CUDA & Subtitle Support ──────
# Pinned to stable release/6.1 to avoid breaking syntax changes in master
RUN cd /ffmpeg_sources && \
    git clone --depth 1 --branch release/6.1 https://git.ffmpeg.org/ffmpeg.git ffmpeg && \
    cd ffmpeg && \
    ./configure \
        --prefix=/usr/local \
        --enable-cuda \
        --enable-cuvid \
        --enable-nvenc \
        --enable-libx264 \
        --enable-libx265 \
        --enable-libvpx \
        --enable-libfdk-aac \
        --enable-libmp3lame \
        --enable-libopus \
        --enable-libass \
        --enable-libfreetype \
        --enable-libfontconfig \
        --enable-nonfree \
        --enable-gpl \
        --extra-cflags="-I/usr/local/cuda/include" \
        --extra-ldflags="-L/usr/local/cuda/lib64" \
        --enable-shared \
        --disable-debug \
        --disable-doc && \
    make -j"$(nproc)" && \
    make install && \
    ldconfig && \
    make distclean && \
    hash -r

# Confirm installation (optional)
RUN ffmpeg -hwaccels && ffmpeg -encoders | grep nvenc

# ────── Install Python dependencies ──────
COPY ./poetry.lock ./pyproject.toml ./
RUN poetry config virtualenvs.create false && \
    poetry install --no-dev --no-interaction

# ────── Add app code and run Django static collection ──────
# Ensure the code is placed inside the 'api' subdirectory to match the volume mount
COPY api ./api
RUN cd api && poetry run ./manage.py collectstatic --noinput

EXPOSE $PORT
ENV PORT=$PORT

# ────── Start Gunicorn (Django setup) ──────
# We use --chdir to explicitly set Gunicorn's working directory to the API folder
CMD exec gunicorn --chdir /app/api --bind 0.0.0.0:$PORT --workers 1 --threads 8 --timeout 0 wsgi:application
