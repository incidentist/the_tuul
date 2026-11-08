"""Loudness matching of a separated stem to the song it came from.

Taking the vocals out takes much of a song's energy with them, so the
accompaniment comes out several dB quieter than the song. Played after the
original, or after another karaoke track, it sounds like the volume dropped.

The stem is scaled by a single gain, so its dynamics are left as the separation
made them. ffmpeg measures both files, since it reads any song a user uploads,
and soundfile rewrites the stem, since it keeps the stem's format and bit depth.
"""

import json
import math
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

import structlog

logger = structlog.get_logger(__name__)

# A smaller correction is inaudible, and not worth rewriting the stem for.
_MIN_GAIN_DB = 0.1

_STATS_PATTERN = re.compile(r'\{\s*"input_i"[^{}]*\}')


@dataclass(frozen=True)
class Loudness:
    integrated_lufs: float
    true_peak_dbtp: float


def measure(path: Path) -> Loudness | None:
    """Measure the integrated loudness and true peak of a file's first audio stream.

    Returns None if ffmpeg is missing, cannot decode the file, or finds it silent.
    """
    command = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-nostats",
        "-i",
        str(path),
        "-map",
        "0:a:0",
        # Audio wider than stereo is downmixed before it is separated, so it is measured that way too.
        "-af",
        "aformat=channel_layouts=mono|stereo,loudnorm=print_format=json",
        "-f",
        "null",
        "-",
    ]

    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
    except FileNotFoundError:
        logger.warning("loudness_measurement_skipped", reason="ffmpeg not found")
        return None
    except subprocess.CalledProcessError as e:
        logger.warning(
            "loudness_measurement_failed", file=path.name, stderr=e.stderr.strip()
        )
        return None

    stats = _STATS_PATTERN.search(result.stderr)
    if not stats:
        logger.warning("loudness_measurement_failed", file=path.name, stderr="")
        return None
    values = json.loads(stats.group())
    loudness = Loudness(float(values["input_i"]), float(values["input_tp"]))
    # A silent file measures -inf.
    if not math.isfinite(loudness.integrated_lufs):
        return None
    return loudness


def match(stem: Path, reference: Path) -> None:
    """Scale the stem in place so that it is as loud as the reference.

    The gain stops where the stem would peak above the reference or above full
    scale, so matching never clips. A stem as dense as a mastered song can
    therefore stay short of the reference.
    """
    target = measure(reference)
    current = measure(stem)
    if target is None or current is None:
        return

    ceiling = min(target.true_peak_dbtp, 0.0)
    # A stem that already peaks past the ceiling is left as loud as it is rather than turned down.
    headroom = max(ceiling - current.true_peak_dbtp, 0.0)
    gain = min(target.integrated_lufs - current.integrated_lufs, headroom)
    if abs(gain) < _MIN_GAIN_DB:
        return

    try:
        _apply_gain(stem, gain)
    except RuntimeError as e:
        logger.warning("loudness_match_failed", stem=stem.name, error=str(e))
        return

    logger.info(
        "loudness_matched",
        stem=stem.name,
        gain_db=round(gain, 2),
        stem_lufs=current.integrated_lufs,
        reference_lufs=target.integrated_lufs,
    )


def _apply_gain(path: Path, gain_db: float) -> None:
    import soundfile

    info = soundfile.info(str(path))
    data, sample_rate = soundfile.read(str(path), dtype="float32", always_2d=True)
    # Written beside the stem and moved over it, so a failed write leaves the stem whole.
    scaled = path.with_name(f".scaled.{path.name}")
    try:
        soundfile.write(
            str(scaled),
            data * 10 ** (gain_db / 20),
            sample_rate,
            subtype=info.subtype,
            format=info.format,
        )
        os.replace(scaled, path)
    finally:
        scaled.unlink(missing_ok=True)
