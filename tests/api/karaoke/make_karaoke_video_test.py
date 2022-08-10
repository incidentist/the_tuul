from datetime import timedelta
from unittest.mock import Mock

from api.karaoke import make_karaoke_video

def test_compile_lyric_timings():
    lyrics = "Stop_in the name_of_love"
    events = [
        [timedelta(seconds=0.0), 1],
        [timedelta(seconds=1.0), 2],
        [timedelta(seconds=2.0), 1],
        [timedelta(seconds=3.0), 1]
    ]
    make_karaoke_video.get_file_duration = Mock(return_value=4.0)
    compiled_timings = make_karaoke_video.compile_lyric_timings(lyrics=lyrics, events=events)

    assert len(compiled_timings) == 1
    screen = compiled_timings[0]
    assert len(screen.lines) == 1
    line = screen.lines[0]
    assert len(line.segments) == 3
    assert line.segments[0].ts.seconds == 0.0
    assert line.segments[0].end_ts.seconds == 1.0
    assert line.segments[1].ts.seconds == 2.0
    assert line.segments[1].end_ts == None

    tweaked_timings = make_karaoke_video.set_segment_end_times(compiled_timings, "whatever.mp3")
    assert len(tweaked_timings) == 1
    screen = tweaked_timings[0]
    assert len(screen.lines) == 1
    line = screen.lines[0]
    assert len(line.segments) == 3
    assert line.segments[0].ts.seconds == 0.0
    assert line.segments[0].end_ts.seconds == 1.0
    assert line.segments[1].ts.seconds == 2.0
    assert line.segments[1].end_ts.seconds == 3.0

