# The Tüül - A Karaoke Video Maker Thing

Normally it takes a long time to make a decent karaoke video. You need to separate the music from the vocals, and painstakingly adjust the timing of every syllable. What we try to do here is use some shortcuts to make videos that are 80% perfect in 20% of the time.

## Install
Requires python 3, npm and ffmpeg. Install with `poetry install && npm install && npm build`.

## Run
This is a Django app. Run it like so:
```
> cd api/
> poetry run ./manage.py runserver
```

Load up http://localhost:8000 and follow the instructions!

