import * as _ from 'lodash';
import { KEY_CODES, LYRIC_MARKERS } from "../constants";

type LyricMarker = number;


export default class TimingsList {
    _timings: Array<[number, LyricMarker]>;
    constructor() {
        this._timings = [];
    }
    add(currentSegmentNum, keyCode, timestamp) {
        if (currentSegmentNum < 0) {
            return;
        }
        const marker =
            keyCode == KEY_CODES.SPACEBAR
                ? LYRIC_MARKERS.SEGMENT_START
                : LYRIC_MARKERS.SEGMENT_END;
        if (marker == LYRIC_MARKERS.SEGMENT_START) {
            this.handleConflictWithPreviousSegment(timestamp);
        }
        this._timings.push([timestamp, marker]);
    }
    toJson() {
        return JSON.stringify(this._timings);
    }

    toArray() {
        return this._timings;
    }

    handleConflictWithPreviousSegment(segmentStartTimestamp: number) {
        // If the user has entered a segment start time that is before the end of
        // the previous segment, adjust the end of the previous segment
        // TODO: what if segmentStartTime is earlier than a bunch of the most recent segments?
        const previousTiming = this._timings.at(-1);
        if (!previousTiming || segmentStartTimestamp > previousTiming[0]) {
            return;
        }
        if (previousTiming[1] == LYRIC_MARKERS.SEGMENT_END) {
            _.pullAt(this._timings, [this._timings.length - 1])
        }
    }

    timingForSegmentNum(segmentNum) {
        const starts = this._timings.filter(
            (t) => t[1] == LYRIC_MARKERS.SEGMENT_START
        );
        if (segmentNum >= starts.length) {
            return 0;
        }
        return starts[segmentNum][0];
    }

    setCurrentSegment(segmentNum) {
        // Set the segment we're currently listening for to segmentNum
        let i = 0,
            currentSegment = 0;
        while (i < this._timings.length) {
            if (this._timings[i][1] == LYRIC_MARKERS.SEGMENT_START) {
                currentSegment += 1;
            }
            if (currentSegment > segmentNum) {
                break;
            }
            i++;
        }
        this._timings = this._timings.slice(0, i);
    }

    last() {
        return this._timings[this._timings.length - 1];
    }

    get length() {
        return this._timings.length;
    }
}