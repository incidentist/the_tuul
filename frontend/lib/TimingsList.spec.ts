import TimingsList from "./TimingsList"
import { KEY_CODES, LYRIC_MARKERS } from "../constants";

test("TimingsList conflicts should be resolved", () => {
    const t = new TimingsList()
    t.add(0, KEY_CODES.SPACEBAR, 1.0);
    t.add(1, KEY_CODES.ENTER, 3.0);
    t.add(2, KEY_CODES.SPACEBAR, 2.5)

    expect(t.toArray()[1]).toStrictEqual([2.5, LYRIC_MARKERS.SEGMENT_START])
});