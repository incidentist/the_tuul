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

# Pro Tips

* *Autocorrect* - The script outputs two videos: one with autocorrect, and one without. Autocorrect works by noting the difference between the time you marked the start of the first line, and the time when the first vocals in the song actually start. It then applies that difference to all your other timings, on the assumption that if you're .2 seconds off on the first line, you'll probably be .2 seconds off on all the other lines as well. It might mess up if a song starts with vocals that aren't really lyrics. You can either add those noises into your lyrics file and treat them like lyrics, or you can ignore the autocorrected version. As of October 2021, autocorrect is basically useless and will probably be removed.

