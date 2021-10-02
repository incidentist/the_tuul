import atexit
import json
import logging
import threading
import webbrowser
from datetime import datetime, timedelta
from enum import IntEnum
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import List, Optional, Tuple

import click

logging.getLogger().setLevel(logging.DEBUG)


class JsTimingCollector(BaseHTTPRequestHandler):
    app_paths = {
        "/": "index.html",
        "/index.html": "index.html",
        "/style.css": "style.css",
        "/timings-ui.js": "timings-ui.js",
    }

    def do_GET(self):
        if self.path == "/favicon.ico":
            return

        if self.path in self.app_paths:
            self._send_app_file(self.app_paths.get(self.path))
        else:
            self._send_song_file(Path(self.path).name)
        logging.info("GET done")

    def do_POST(self):
        data_string = self.rfile.read(int(self.headers["Content-Length"]))
        logging.info(data_string)
        self.send_response(200)
        self.send_header("Content-type", "text/html")
        self.end_headers()
        self.wfile.flush()
        timings = json.loads(data_string)
        self.server.timings = timings
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def _send_app_file(self, filename):
        self.send_response(200)
        self.send_header("Content-type", "text/html")
        self.end_headers()
        self.wfile.writelines(Path(f"www/{filename}").open("rb").readlines())

    def _send_song_file(self, filename):
        logging.info(f"file: {filename}")
        if filename == "song_file":
            try:
                self.send_response(200)
                self.send_header("Content-type", "text/html")
                self.end_headers()
                self.wfile.write(self.server.song_path.read_bytes())
            except Exception as e:
                logging.error(e)
                pass
            return
        elif filename == "lyrics.txt":
            self.send_response(200)
            self.send_header("Content-type", "text/plain")
            self.end_headers()
            self.wfile.write(self.server.lyrics.encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()


class JsTimingCollectionServer(HTTPServer):

    HOST_NAME = "localhost"
    HOST_PORT = 8080

    def __init__(self, lyrics: str, song_path: Path):
        super().__init__((self.HOST_NAME, self.HOST_PORT), JsTimingCollector)
        self.lyrics = lyrics
        self.song_path = song_path
        self.timings = None

    def launch_timing_tool(self, host, port) -> bool:
        return webbrowser.open_new_tab(f"http://{host}:{port}/index.html")


class LyricMarker(IntEnum):
    SEGMENT_START = 1
    SEGMENT_END = 2


class LyricSegmentIterator:
    def __init__(self, lyrics_txt: str):
        self._segments = self.parse_segments(lyrics_txt)
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

    def parse_segments(self, lyrics: str) -> List[str]:
        segments: List[str] = []
        current_segment = ""
        for i, char in enumerate(lyrics):
            finish_segment = False
            if char in ["\n", "/", "_"] or i == len(lyrics) - 1:
                finish_segment = True
                if char == "/":
                    char = ""
                elif char == "_":
                    char = " "
            if char == "\n" and current_segment == "":
                segments[-1] += char
                continue
            current_segment += char
            if finish_segment:
                segments.append(current_segment)
                current_segment = ""

        return segments


def gather_timing_data(
    lyrics: str, song_path: Path
) -> List[Tuple[timedelta, LyricMarker]]:
    """
    Gather timestamp data for lyrics by displaying lines to the user and
    having them enter keystrokes to mark the data.
    """
    web_server = JsTimingCollectionServer(lyrics=lyrics, song_path=song_path)
    print(
        "Server started http://{}:{}".format(
            JsTimingCollectionServer.HOST_NAME, JsTimingCollectionServer.HOST_PORT
        )
    )

    try:
        web_server.launch_timing_tool(
            web_server.server_address[0], web_server.server_address[1]
        )
        web_server.serve_forever()
    except KeyboardInterrupt:
        pass

    web_server.server_close()
    print("Server stopped.")
    if web_server.timings is not None:
        return [(timedelta(seconds=t[0]), t[1]) for t in web_server.timings]
    else:
        raise ValueError(
            "It looks like timings collection didn't work. Please try again."
        )


def get_next_marker(start_ts: datetime) -> Tuple[timedelta, LyricMarker]:
    """Prompt the user for the next LyricMarker and timestamp"""
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
