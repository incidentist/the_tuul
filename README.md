# The Tüül - A Karaoke Video Maker Thing

Normally it takes a long time to make a decent karaoke video. You need to separate the music from the vocals, and painstakingly adjust the timing of every syllable. What we try to do here is use some shortcuts to make videos that are 80% perfect in 20% of the time.

## Install
Requires python 3, [uv](https://docs.astral.sh/uv/), npm and ffmpeg. Install with `make install`.

Copy .env.example to .env and fill out the variables.

## Run
This is a FastAPI app. Run it like so:
```
> make dev
```

Load up http://localhost:8000 and follow the instructions!

### Running Seperate Separator App

`uv run python -m api.separator_server`

## Build
To build the Docker image:

`> make docker-build`

