Karaoke Video Maker Thing

A script for making karaoke videos. Very very very early and basic.

## Install
Requires python 3 and ffmpeg. Install with `pip install -r requirements.txt`.

## Step 1
Create a txt file with lyrics. Line breaks separate lines, two line breaks separate screens.

## Step 2

Run make_karaoke_video.py to create the video. Give it the lyrics file and the original (with vocals) track. It'll play the song and you'll hit spacebar when a line begins. The video will be created from the timings of your keystrokes. The video will called `karaoke.mp4`. You can find it in a subfolder of the `songs/` directory named after the song.
