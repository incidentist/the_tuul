import atexit
import subprocess
from datetime import datetime, timedelta
from enum import IntEnum
from pathlib import Path
from typing import List, Optional, Tuple

import click


class LyricMarker(IntEnum):
    SEGMENT_START = 1
    SEGMENT_END = 2


ffplay_process: Optional[subprocess.Popen] = None


class LyricSegmentIterator:
    def __init__(self, lyrics_txt: str):
        self._segments = lyrics_txt.split("\n")
        self._current_segment = None

    def __iter__(self):
        self._current_segment = 0
        return self

    def __next__(self):
        if self._current_segment >= len(self._segments):
            raise StopIteration
        val = self._segments[self._current_segment]
        self._current_segment += 1
        return val

    def __len__(self):
        return len(self._segments)


def gather_timing_data(
    lyrics: str, song_path: Path
) -> List[Tuple[timedelta, LyricMarker]]:
    """
    Gather timestamp data for lyrics by displaying lines to the user and
    having them enter keystrokes to mark the data.
    """
    print_preamble()
    click.pause()

    atexit.register(stop_track)
    play_track(song_path)

    start_ts = datetime.now()
    lyric_chunks = LyricSegmentIterator(lyrics)
    timing_data = []
    for chunk in lyric_chunks:
        marker = None
        click.echo(chunk)
        if chunk == "":
            continue
        while marker != LyricMarker.SEGMENT_START:
            ts, marker = get_next_marker(start_ts)
            timing_data.append((ts, marker))
    timing_data.append(get_last_line_end(start_ts))

    stop_track()
    return timing_data


def print_preamble():
    click.echo("This is the Karaoke Song Maker Thing!")
    click.echo("The song will play, and lyrics will be shown line by line.")
    click.echo("Press spacebar to mark the start of the displayed line.")
    click.echo("Press Enter to mark the *end* of the *previous* line.")


def play_track(song_path: Path, start_ts: str = "00:00"):
    """ Play the song starting at start_ts seconds """
    global ffplay_process
    if ffplay_process is not None:
        ffplay_process.kill()
    cmd = ["ffplay", "-nodisp", "-autoexit", "-ss", start_ts, str(song_path.resolve())]
    ffplay_process = subprocess.Popen(
        cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )


def stop_track():
    global ffplay_process
    ffplay_process.kill()


def get_next_marker(start_ts: datetime) -> Tuple[timedelta, LyricMarker]:
    """ Prompt the user for the next LyricMarker and timestamp """
    char = click.getchar()
    ts = datetime.now() - start_ts
    event = None
    if char == " ":
        event = LyricMarker.SEGMENT_START
    elif char in "\n\r":
        event = LyricMarker.SEGMENT_END
    else:
        ts, event = get_next_marker(start_ts)
    return ts, event


def get_last_line_end(start_ts):
    click.echo("Press space or enter when the last line ends")
    ts, event = get_next_marker(start_ts)
    return ts, LyricMarker.SEGMENT_END


from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import BaseRequestHandler
import threading
import time
import webbrowser
from pathlib import Path
from typing import Callable, Tuple

hostName = "localhost"
serverPort = 8080


def launch_timing_tool(host, port):
    success = webbrowser.open_new_tab(f"http://{host}:{port}/index.html")


class JsTimingCollector(BaseHTTPRequestHandler):
    app_paths = {
        "/": "index.html",
        "/index.html": "index.html",
        "/style.css": "style.css",
        "/timings-ui.js": "timings-ui.js",
    }

    def do_GET(self):

        self.send_response(200)
        self.send_header("Content-type", "text/html")
        self.end_headers()

        if self.path == "/favicon.ico":
            return

        if self.path in self.app_paths:
            self._send_app_file(self.app_paths.get(self.path))
        else:
            self._send_song_file(Path(self.path).name)

    def do_POST(self):
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def _send_app_file(self, filename):
        self.wfile.writelines(Path(f"www/{filename}").open("rb").readlines())

    def _send_song_file(self, filename):
        self.wfile.writelines(
            self.server.song_dir.joinpath(filename).open("rb").readlines()
        )


class JsTimingCollectionServer(HTTPServer):
    def __init__(self, song_dir: Path):
        super().__init__((hostName, serverPort), JsTimingCollector)
        self.song_dir = song_dir


if __name__ == "__main__":
    webServer = JsTimingCollectionServer(Path("songs/opposite_day"))
    print("Server started http://%s:%s" % (hostName, serverPort))

    try:

        launch_timing_tool(webServer.server_address[0], webServer.server_address[1])
        webServer.serve_forever()
    except KeyboardInterrupt:
        pass

    webServer.server_close()
    print("Server stopped.")