"""Render made-up lines with libass through ffmpeg, and record how wide their ink is.

    python3 scripts/rendered_widths.py > tests/fixtures/rendered-widths.json

textWidth.spec.ts checks the app's width estimates against these widths.
Only the bundled fonts are visible, as in the app's renderers, which have no system fonts.
With system fonts visible, fontconfig would swap real bold faces in for faux bold.
"""

import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "api/assets/fonts"
FAMILIES = list(json.loads((ROOT / "frontend/lib/bundledMetrics.json").read_text()))
CJK_FAMILY = "Noto Sans CJK JP"

# The subtitle canvas, and how many frame pixels each of its units takes.
WIDTH, HEIGHT, SCALE = 512, 288, 4
SIZE = 20
TOP = 100

LINES = [
    "Lanterns drift home over the quiet hill",
    "Pale moon, rising slow - where to now?",
    "WE KEEP THE EMBERS BURNING ALL NIGHT",
    "jump quickly, fix the waxed oven gizmo",
    "Crème brûlée à l'été, naïve façade",
    "Twelve o'clock, 1984: (lights) & songs!",
]
CJK_LINES = ["雨が降る夜に灯りをともして", "遠い町へ、歌を届けよう"]

ASS = """[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{family},{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,0

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{{\\pos(4,{top})}}{text}
"""


def ink_width(family: str, text: str, work: Path, env: dict) -> float:
    """The width of the line's ink in canvas units, from the first lit column to the last."""
    ass = work / "line.ass"
    fields = dict(width=WIDTH, height=HEIGHT, family=family, size=SIZE, top=TOP)
    ass.write_text(ASS.format(**fields, text=text))
    row_length = WIDTH * SCALE
    canvas = f"color=c=black:s={row_length}x{HEIGHT * SCALE}:d=1"
    # Only the band the line is drawn in is read back.
    band = f"crop={row_length}:{SIZE * 2 * SCALE}:0:{(TOP - SIZE // 2) * SCALE}"
    frame = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", canvas]
        + ["-vf", f"subtitles={ass}:fontsdir={FONT_DIR},{band}"]
        + ["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        env=env,
        check=True,
        capture_output=True,
    ).stdout
    lit = bytes(1 if value > 40 else 0 for value in range(256))
    columns = 0
    for start in range(0, len(frame), row_length):
        row = frame[start : start + row_length]
        columns |= int.from_bytes(row.translate(lit), "big")
    lit_columns = columns.to_bytes(row_length, "big").rstrip(b"\0")
    first = len(lit_columns) - len(lit_columns.lstrip(b"\0"))
    return round((len(lit_columns) - first) / SCALE, 2)


def main() -> None:
    with tempfile.TemporaryDirectory() as directory:
        work = Path(directory)
        config = work / "fonts.conf"
        config.write_text(
            f"<?xml version='1.0'?><fontconfig><dir>{FONT_DIR}</dir>"
            f"<cachedir>{work / 'cache'}</cachedir></fontconfig>"
        )
        env = {**os.environ, "FONTCONFIG_FILE": str(config)}
        widths = {
            family: {
                text: ink_width(family, text, work, env)
                for text in (CJK_LINES if family == CJK_FAMILY else LINES)
            }
            for family in FAMILIES
        }
    print(
        json.dumps(
            {"size": SIZE, "bold": True, "widths": widths}, ensure_ascii=False, indent=2
        )
    )


if __name__ == "__main__":
    main()
