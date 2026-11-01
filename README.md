# The Tüül - A Karaoke Video Maker Thing

Making a decent karaoke video can take a long time.  
You need to separate the music from the vocals, and painstakingly adjust the timing of every syllable.  
This projects lets you create videos that are 80% perfect in 20% of the time.

## Quick start

Requirements: Docker

1. Clone the project, or download and extract the zip file if you don't have git
2. Run it with `docker compose`.
3. Open http://localhost:8080/ in your browser.

```
git clone https://github.com/vctls/the_tuul.git
cd the_tuul
docker compose up
```

The image builds on the first run, and the first separation downloads the selected model.
Both take a while the first time.

## What's new in this fork

### Voice separation

- **Three additional separation models**, grouped by what they do to the backing vocals:
  - _Keep them:_ MDX-Net (fastest), Mel-Band Roformer (aufr33/viperx), Mel-Band Roformer (becruily).
  - _Remove them:_ MDX-Net Inst HQ (fastest), BS-Roformer (highest quality, slowest).
- Mel-Band Roformer (becruily) is preselected. `DEFAULT_SEPARATION_MODEL` picks another, by model
  file name, such as `UVR_MDXNET_KARA_2.onnx` for a server without a GPU.
- The separation process shows an actual progress indicator as soon as possible.
- Separation progress also replaces the icon on the Files tab header, so it stays visible from any other tab.
- **Cancellable jobs.** Separation runs as a background task, so the request no longer blocks, and a
  Cancel button stops a job you started by mistake instead of leaving you to wait it out.
- Already have an instrumental or an a cappella? Load them directly and skip separation.

![Separation progress, with the named stage, the bar, the tab header ring and the Cancel button](docs/media/separation-progress.gif)

### Lyrics

There's a player on the Lyrics tab now, so you can listen while you check the lyrics.
Only one player runs at a time across the app, and the media keys follow whichever one you last
started.

When a song is loaded and the lyrics are empty, they are looked up on [LRCLIB](https://lrclib.net)
from the song's title, artist and length. The request goes through the server, so LRCLIB never
sees the user's address. `LYRICS_PROVIDER=lrclib` turns the lookup on. It is on in the dev stack
and off by default elsewhere.

### Multiple voices

Prefix a line with a tag in square brackets and the lyrics split into independent voices, each with its own timings,
its own pass through the timing tabs, and optionally its own font, weight and colors in the rendered video.
`[Anna+Ben]` puts the line into both. Voices can overlap freely, because nothing is shared between them but the audio.

![Tagging lyric lines with voice names, then switching between voices](docs/media/multi-voice.gif)

### Tapping out the timings

The Timing tab has a **Tap mode** for timing the song as it plays. The playhead stays in the middle
and the waveform scrolls past it, with the syllables still to tap queued along the middle. Press the
start key as each syllable begins, and it feeds through the playhead. A syllable lasts until the next
one starts, so the end key is only needed where the singer pauses.

- **Re-tap any part of the song** by clicking its rectangle, or a syllable in the queue. Only what you
  tap changes. The syllables ahead are drawn faded until you reach them, and keep their timings if
  you stop first.
- **Undo takes back one tap at a time**, playing or paused, and moves the playhead to just before it.
- **Taps are kept** when playback stops, and when the page is reloaded mid-song.
- **On a phone held sideways**, the waveform takes the whole screen, with the timing buttons floating
  under your thumbs. Swipe to move the playhead, and pinch to zoom.

![Re-tapping a line: a click on its first rectangle, then the start and end keys as the song plays](docs/media/tap-mode.gif)

The start, end and redo keys can be remapped, and pitch preservation can be toggled on or off when
changing playback speed.  
The previous Timing tab is still there, behind a switch at the end of the Tap mode help.

![Remapping the start, end and redo keys, the playback speed and pitch preservation, and tapping timings against the seek bar in the previous Timing tab](docs/media/timing-controls.gif)

### Adjusting timings manually

- **Zoom the waveform by scrolling**, centered on the cursor.

  ![Scrolling to zoom the waveform around the cursor](docs/media/waveform-zoom.gif)

- **Join and separate segments** by dragging the end of a rectangle.
  Drag it up to the next rectangle's start to join them. Once joined, moving either side moves their shared edge.  
  This means that you don't even have to tap the timing ends if that's too difficult, you can simply set them by hand.

  ![Dragging a segment's end to separate it from the next, then re-joining it](docs/media/segment-split-join.gif)

- **Edit the lyrics after timing them.** Timings are tied to lyric segments, not to their position.
  An edit only affects adjacent segments. Removing a `/` merges the corresponding timing regions and keeps
  the outer edges. Adding a `/` back splits them again, and the syllable with no timing of its own is
  drawn faded until you drag it into place. Everything around the edit stays where it was.  
  A faded rectangle still renders, spaced between its neighbors, so you can preview the video
  without fixing it first. Fixing a typo costs nothing at all.

  ![Removing a slash merges two rectangles, adding it back leaves a faded one that a drag pins down](docs/media/lyric-edit-reconcile.gif)

- **See what a lyric edit did to the timings.** When an edit replaces words, the timings it
  couldn't keep for certain are flagged on the waveform: red for a syllable that lost its timing,
  orange for one that took its timing from a replaced word. Each gets a line across the waveform,
  so it stands out however far you zoom out. The message after a paste says how many there are,
  and **Show** takes you to the first.  
  The arrows by the heading, or <kbd>N</kbd> and <kbd>shift</kbd>+<kbd>N</kbd>, go from one to the
  next. Moving a syllable clears its flag, and **Mark as checked** (<kbd>C</kbd>) clears it on the
  selected ones without moving them.

  ![Pasting replaced words over timed lyrics, then Show, a drag that retimes the red syllable, and Mark as checked on an orange one](docs/media/timings-review.gif)

- **Select and drag multiple regions at once.** Click one, click another, and everything between
  the two moves together, clamped by the rectangles on either side. <kbd>Esc</kbd> clears it.  
  That way you can quickly fix entire timing sections.

  ![Selecting a run of rectangles and dragging them as one](docs/media/region-group-drag.gif)

- **Keyboard control throughout:** <kbd>space</kbd> plays and pauses, <kbd>←</kbd> <kbd>→</kbd> step
  the playhead by the preroll you set (<kbd>shift</kbd> for five times as long), <kbd>Home</kbd> and
  <kbd>End</kbd> jump to the edges of the visible waveform (<kbd>ctrl</kbd> for the whole song), and
  <kbd>Enter</kbd> replays from the last position you set yourself.
- **Controls for playback rate, pitch preservation, zoom level, playhead preroll, and a global shift**
  in milliseconds for when everything is late by the same amount.
- **Listen to the vocals alone** while you adjust, instead of the full mix.
- **A preview of the screen you are on** above the waveform, sized to the window and painted in the
  app's own colors rather than the video's, so it stays readable in either theme.

### Editing the timings

- **An advanced Edit tab** for editing timings as `<MM:SS.cc>` text.
  This makes it possible to fix subtle issues, adjust timings as precisely as you want,
  or copy and paste blocks of timings which can be useful for multi-voice tracks with partial unison.

![Timings as editable `<MM:SS.cc>` text, one tag per syllable](docs/media/edit-tab.png)

### Rendering the video

- **MKV output** carrying the vocals and the original mix as extra audio tracks, for players that support it.
- **Count-ins** before every screen, or before any line that follows a gap, with a configurable threshold and duration.
- **Custom fonts** from your own `.ttf` or `.otf` files, bundled into the exported source files.
- A preview that resizes with the window and lets you switch between the full track and the backing track.

![The Submit tab: render settings, the live preview, and the source files it exports](docs/media/submit-tab.png)

### Picking a project back up

The session survives a refresh, so a stray reload no longer costs you an afternoon,
and a **Start Over** button discards it when you do want a clean slate.

Nothing is lost either way. The Submit tab hands you every source file: lyrics, timings, subtitles,
settings, fonts and the separated tracks.
Point **Restore existing files**, on the Files tab, at that folder once extracted to restore the
whole project.
Any subset works: a folder with only lyrics and timings restores those, and each file can also be
loaded on its own.

![Start Over clearing the project, then an exported folder putting all of it back](docs/media/start-over-and-restore.gif)

### Finding your way around

- **One toggle shows or hides the instructions** on every tab at once.
- **Each tab has its own URL fragment**: `#lyrics`, `#adjust`, `#submit`. A reload comes back to the
  tab you were on, and you can link someone straight to a step. Stepping through the tabs doesn't
  stack history entries, so Back still works.

### Layout and dark theme

The interface follows the system dark theme, waveform and timing rectangles included, and a navbar
button cycles between following the system, forcing light and forcing dark. The choice sticks across
reloads.  
Forms spread into columns when there's room, and collapse when there isn't.  
On the Submit tab the settings take a third of the width and the preview the rest, each scrolling on
its own so neither pushes the other off-screen.

![The theme button cycling through the system theme, forced light and forced dark, repainting the waveform and the timing rectangles with the rest](docs/media/theme-toggle.gif)

Under the hood: strict TypeScript, Prettier and Ruff formatting, a lint action, unit and end-to-end
test suites, and Docker Compose stacks for dev, production and GPU-backed separation.

## Running the dev stack

The dev stack runs either on the host directly, or in Docker.

To run locally, it requires python 3.13, [uv](https://docs.astral.sh/uv/), pnpm and FFmpeg.
Install it on the host with `make install`.

Copy .env.example to .env and fill out the variables.
The dev compose stack needs that file, the main one runs without it.

Run it with `docker compose`:

```
docker compose -f compose.dev.yaml up
```

And open it on http://localhost:5173

Alternatively, run it directly on the host:

```
> make dev
```

And open it on http://localhost:8000

### Running Separate Separator App

`uv run python -m api.separator_server`

It listens on port 8001, and both separates and syncs. The app sends both to it with
`SEPARATION_BACKEND=remote`, with `SEPARATION_REMOTE_URL` pointing at it.

To run it in a container with GPU access instead:

```
docker compose -f compose.yaml -f compose.gpu.yaml up
```

For the dev stack, with hot reload and the end-to-end tests:

```
docker compose -f compose.dev.yaml -f compose.dev-gpu.yaml up
```

Both need the NVIDIA container toolkit.

### Separating and syncing on Modal

`api/modal_app.py` serves the same job protocol from a Modal GPU. Serve it from the repository
root. The first run installs the Modal SDK.

```
uv run --group modal modal serve -m api.modal_app
```

To run the app against it, set `MODAL_SEPARATION_URL`, `MODAL_PROXY_KEY` and `MODAL_PROXY_SECRET` in
.env to the printed URL and a workspace proxy token, then:

```
docker compose -f compose.yaml -f compose.modal.yaml up
```

Coming from the GPU stack, add `--remove-orphans` to stop its separator.

## Build

To build the Docker image:

`> make build-docker`

## Credits

@incidentist made the first version of The Tüül. @vctls made so many improvements on his [Le Toul fork](https://github.com/vctls/le_toul) that @incidentist went ahead and just made his fork the new Tüül. So now they are both basically mirrors of eachother.

Lyrics lookup uses [LRCLIB](https://lrclib.net), a free, open lyrics database.

Vocal/instrumental separation is performed by [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator), which wraps a number of pretrained models
from the [Ultimate Vocal Remover](https://github.com/Anjok07/ultimatevocalremovergui) (UVR) community.
The Tüül does not redistribute the model weights. They are auto-downloaded by `audio-separator` on first use.

Models currently exposed in the UI:

- **MDX-Net** (`UVR_MDXNET_KARA_2`, `UVR-MDX-NET-Inst_HQ_3`). UVR core team ([Anjok07](https://github.com/Anjok07), [aufr33](https://github.com/aufr33))
- **Mel-Band Roformer (karaoke)**. [aufr33](https://github.com/aufr33) & [viperx](https://huggingface.co/viperx); newer variant by [becruily](https://huggingface.co/becruily)
- **BS-Roformer**. Original architecture by [lucidrains](https://github.com/lucidrains/BS-RoFormer); weights by [viperx](https://huggingface.co/viperx)

The UVR GUI is MIT-licensed and its maintainers ask third-party tools that use these models to credit UVR and the model authors.
If you use The Tüül to publish karaoke content, please pass that attribution along.
