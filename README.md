# Karaoke Video Maker Thing

A script for making karaoke videos. Normally it takes a long time to make a decent karaoke video. You need to separate the music from the vocals, and painstakingly adjust the timing of every syllable. What we try to do here is use some shortcuts to make videos that are 80% perfect in 20% of the time.

## Install
Requires python 3 and ffmpeg. Install with `pip install -r requirements.txt`.

## Step 1
Create a txt file with lyrics. Line breaks separate lines, two line breaks separate screens. If you want to time specific words, put an underscore between them instead of a space. If you want to time specific syllables, put a slash between the syl/lab/bles.

## Step 2

Run make_karaoke_video.py to create the video. Give it the lyrics file and the original (with vocals) track. It'll play the song and you'll hit spacebar when a line begins. The video will be created from the timings of your keystrokes. The video will be called `karaoke.mp4`. An autocorrected version of the video will be named `karaoke-autocorrect.mp4`. You can find them in a subfolder of the `songs/` directory named after the song.

# Pro Tips

* *Autocorrect* - The script outputs two videos: one with autocorrect, and one without. Autocorrect works by noting the difference between the time you marked the start of the first line, and the time when the first vocals in the song actually start. It then applies that difference to all your other timings, on the assumption that if you're .2 seconds off on the first line, you'll probably be .2 seconds off on all the other lines as well. It might mess up if a song starts with vocals that aren't really lyrics. You can either add those noises into your lyrics file and treat them like lyrics, or you can ignore the autocorrected version.

* The system splits your song into files called `instrumental.wav` and `vocals.wav`. If it sees that those files already exist in your song's folder, it won't try to split them again. If you need to split them again for some reason, delete or rename those files.
