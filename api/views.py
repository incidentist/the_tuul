import io
import json
import logging
import tempfile
from pathlib import Path
from typing import Tuple
import zipfile

from django.core.files.storage import FileSystemStorage
from django.core.files import File
from django.http import FileResponse
from django.views.generic.base import TemplateView
from rest_framework.response import Response
from rest_framework.views import APIView

from karaoke import make_karaoke_video


class Index(TemplateView):
    template_name = "index.html"


class GenerateVideo(APIView):
    def post(self, request, format=None):
        lyrics = request.data.get("lyrics")
        timings = request.data.get("timings")
        song_file = request.data.get("songFile")

        with tempfile.TemporaryDirectory() as song_files_dir:
            zip_path = None
            [song_path, lyrics_path, timings_path] = self.setup_song_files_dir(
                song_files_dir, song_file, lyrics, timings
            )
            logging.info(song_path)
            success = make_karaoke_video.run(
                lyricsfile=lyrics_path, songfile=song_path, timingsfile=timings_path
            )
            if success:
                zip_path = self.zip_project(
                    song_name=song_path.name, song_files_dir=Path(song_files_dir)
                )
            if zip_path:

                response = FileResponse(zip_path.open("rb"), as_attachment=True)
                return response
            else:
                logging.error("No zip path for some reason.")

    def zip_project(self, song_name: str, song_files_dir: Path) -> Path:
        include_files = [
            "karaoke.mp4",
            "lyrics.txt",
            "subtitles.ass",
            "timings.json",
        ]
        zip_path = song_files_dir.joinpath(f"{song_name}.zip")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for entry in song_files_dir.glob("*"):
                if entry.name in include_files:
                    zip_file.write(entry, entry.relative_to(song_files_dir))
        logging.info(f"Zipped to: {zip_path}")
        return zip_path

    def setup_song_files_dir(
        self, files_dir, song_file, lyrics, timings
    ) -> Tuple[Path, Path, Path]:
        """Copy song components to the temp dir.

        Return component paths.
        """
        fs = FileSystemStorage(files_dir)
        song_file_name = fs.save(song_file.name, content=song_file)
        lyrics_file_name = fs.save("lyrics.txt", io.StringIO(lyrics))
        timings_file_name = fs.save("timings.json", io.StringIO(timings))
        return tuple(
            map(
                lambda p: Path(fs.location, p),
                [song_file_name, lyrics_file_name, timings_file_name],
            )
        )
