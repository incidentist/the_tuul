import io
import json
import tempfile
from pathlib import Path
from typing import Tuple
import zipfile

import structlog

import pytube

from django.core.files.storage import FileSystemStorage
from django.http import FileResponse, StreamingHttpResponse
from django.core.files import File
from django.views.generic.base import TemplateView
from rest_framework.response import Response
from rest_framework.request import Request
from rest_framework.views import APIView

from karaoke import make_karaoke_video
from karaoke import music_separation

logger = structlog.get_logger(__name__)


def streamed_response(file_path: Path) -> StreamingHttpResponse:
    """Return a streaming response for the given file path."""
    f = file_path.open("rb")

    def streaming_content():
        while True:
            data = f.read(1024 * 1024)
            if not data:
                break
            yield data

    return StreamingHttpResponse(streaming_content=streaming_content())


class Index(TemplateView):
    template_name = "index.html"


class SeparateTrack(APIView):
    def post(self, request: Request, format: str | None = None) -> Response:
        """Return a zip containing vocal and accompaniment splits of songFile"""
        song_file = request.data.get("songFile")
        logger.info(
            "separate_tracks",
            song_size=len(song_file),
        )
        with tempfile.TemporaryDirectory() as song_files_dir:
            song_files_dir_path = Path(song_files_dir)
            song_file_path = self.setup_song_files_dir(song_files_dir, song_file)
            accompaniment_path, vocal_path = music_separation.split_song(
                song_file_path, song_files_dir_path
            )
            zip_path = song_files_dir_path / "split_song.zip"
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
                zip_file.write(
                    accompaniment_path,
                    "accompaniment.wav",
                )
                zip_file.write(
                    vocal_path,
                    "vocals.wav",
                )

            logger.info("zip_complete", path=zip_path)
            return streamed_response(zip_path)

    def setup_song_files_dir(self, files_dir: str, song_file: File) -> Path:
        """Copy song file to the temp dir.

        Return song file path.
        """
        fs = FileSystemStorage(files_dir)
        song_file_name = fs.save(song_file.name, content=song_file)
        return Path(fs.location, song_file_name)


class DownloadYouTubeVideo(APIView):
    """
    Download a YouTube video as audio and video streams and return them as a zip.
    """

    def get(self, request: Request, format: str | None = None) -> Response:
        """Return a zip containing vocal and accompaniment splits of songFile, and song metadata"""
        youtube_url = request.query_params.get("url")
        logger.info(
            "download_youtube_video",
            youtube_url=youtube_url,
            request=request.query_params,
        )
        if not youtube_url:
            return Response({"error": "No url provided."})
        with tempfile.TemporaryDirectory() as song_files_dir:
            song_files_dir_path = Path(song_files_dir)

            metadata, audio_path, video_path = self.get_youtube_streams(
                youtube_url, song_files_dir_path
            )
            logger.info("metadata", metadata=metadata)
            (song_files_dir_path / "metadata.json").write_text(json.dumps(metadata))
            zip_path = song_files_dir_path / "youtube_video.zip"
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
                zip_file.write(
                    audio_path,
                    "audio.mp4",
                )
                zip_file.write(
                    video_path,
                    "video.mp4",
                )
                zip_file.write(song_files_dir_path / "metadata.json", "metadata.json")

            logger.info("zip_complete", path=zip_path)
            return streamed_response(zip_path)

    def get_youtube_streams(
        self, youtube_url: str, song_files_dir: Path
    ) -> Tuple[dict[str, str], Path, Path]:
        """Download audio and video streams from YouTube URL.
        Video has max resolution of 1080p.
        Return audio and video paths.
        """
        youtube = pytube.YouTube(youtube_url)
        audio_stream = youtube.streams.filter(only_audio=True).first()
        video_stream = youtube.streams.filter(only_video=True, res="1080p").first()
        if not video_stream:
            video_stream = youtube.streams.filter(only_video=True).first()
        audio_path = audio_stream.download(song_files_dir, "audio")
        video_path = video_stream.download(song_files_dir, "video")
        logger.info("video_stream", video_stream=video_stream)
        return self.assemble_metadata(youtube), Path(audio_path), Path(video_path)

    def assemble_metadata(self, youtube: pytube.YouTube) -> dict[str, str]:
        metadata = {
            "title": youtube.title,
            "author": youtube.author,
            "length": youtube.length,
            "rating": youtube.rating,
            "views": youtube.views,
            "keywords": youtube.keywords,
            "description": youtube.description,
            # **youtube.metadata,
        }
        return metadata


class GenerateVideo(APIView):
    def post(self, request: Request, format=None) -> Response:
        lyrics: str = request.data.get("lyrics")
        timings: str = request.data.get("timings")
        song_file = request.data.get("songFile")
        song_artist: str = request.data.get("songArtist", "Unknown Artist")
        song_title: str = request.data.get("songTitle", "Unknown Title")
        subtitles: str = request.data.get("subtitles")
        audio_delay: float = float(request.data.get("audioDelay", 0.0))
        background_color: str = request.data.get("backgroundColor", "#000000")

        logger.info(
            "generate_video",
            lyrics=lyrics,
            timings=timings,
            song_artist=song_artist,
            song_title=song_title,
            subtitles=subtitles,
            song_size=len(song_file),
        )

        with tempfile.TemporaryDirectory() as song_files_dir:
            zip_path = None
            video_filename = self.get_output_filename(song_artist, song_title)
            [song_path, lyrics_path, timings_path] = self.setup_song_files_dir(
                song_files_dir, song_file, lyrics, timings
            )
            success = make_karaoke_video.run(
                lyricsfile=lyrics_path,
                songfile=song_path,
                timingsfile=timings_path,
                lyric_subtitles=subtitles,
                output_filename=video_filename,
                audio_delay=audio_delay,
                metadata={"title": song_title, "artist": song_artist},
                background_color=background_color,
            )
            if success:
                zip_path = self.zip_project(
                    song_name=video_filename, song_files_dir=Path(song_files_dir)
                )
            if zip_path:
                response = FileResponse(zip_path.open("rb"), as_attachment=True)
                return response
            else:
                logger.error("No zip path for some reason.")

    def zip_project(self, song_name: str, song_files_dir: Path) -> Path:
        include_files = [
            song_name,
            "lyrics.txt",
            "subtitles.ass",
            "timings.json",
        ]
        zip_path = song_files_dir.joinpath(f"{song_name}.zip")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for entry in song_files_dir.glob("*"):
                if entry.name in include_files:
                    zip_file.write(entry, entry.relative_to(song_files_dir))
        logger.info(f"Zipped to: {zip_path}")
        return zip_path

    def setup_song_files_dir(
        self, files_dir, song_file, lyrics, timings
    ) -> tuple[Path, ...]:
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

    def get_output_filename(self, artist: str, title: str) -> str:
        if artist and title:
            return f"{artist} - {title} [karaoke].mp4".replace("/", "_")
        return "karaoke.mp4"
