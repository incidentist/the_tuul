Karaoke Video Maker Thing

Scripts for making karaoke videos. Very very very early and basic.

## Step 1
Use [spleeter](https://github.com/deezer/spleeter) to separate vocals from instrumental.

## Step 2
Create a txt file with lyrics. Line breaks separate lines, two line breaks separate screens.

Run create_song_json.py to create timings for lines. Give it the lyrics file and the original (with vocals) track. It'll play the song and you'll hit spacebar when a line begins. That outputs a json file.

## Step 3
Run create_video.py with the json file you just created.