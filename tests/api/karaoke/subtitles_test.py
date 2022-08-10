from unittest import TestCase
from datetime import timedelta

from api.karaoke.subtitles import LyricsLine, LyricSegment

class LyricsLineTest(TestCase):
    def test_decorate_ass_with_gaps(self):
        segments = [
            LyricSegment("Hold", timedelta(seconds=0), timedelta(seconds=1)),
            LyricSegment("me", timedelta(seconds=2), timedelta(seconds=3)),
            LyricSegment("now", timedelta(seconds=3), timedelta(seconds=4))
        ]
        line = LyricsLine(segments=segments)
        assert "{\k0.0}{\kf100.0}Hold{\kf100.0}{\kf100.0}me{\kf100.0}now" == line.decorate_ass_line(segments, timedelta(0))