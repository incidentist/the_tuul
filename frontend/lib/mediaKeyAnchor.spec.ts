import { describe, it, expect, vi, afterEach } from "vitest";
import { anchorMediaKeys } from "./mediaKeyAnchor";

const anchors: Array<{ play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }> = [];

afterEach(() => {
  anchors.length = 0;
  vi.restoreAllMocks();
});

/**
 * Records every media element the anchor creates.
 */
function spyOnAudio() {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async function (
    this: HTMLMediaElement,
  ) {
    anchors.push(this as never);
  });
  return vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
}

describe("anchorMediaKeys", () => {
  it("loops its media element while the player plays, and stops it on a pause", () => {
    const pause = spyOnAudio();
    const player = new EventTarget() as EventTarget & { paused: boolean };
    const release = anchorMediaKeys(player as never);

    player.dispatchEvent(new Event("play"));

    expect(anchors).toHaveLength(1);
    expect((anchors[0] as unknown as HTMLAudioElement).loop).toBe(true);

    player.dispatchEvent(new Event("pause"));

    expect(pause).toHaveBeenCalledOnce();
    release();
  });

  it("no longer follows the player once released", () => {
    spyOnAudio();
    const player = new EventTarget();
    anchorMediaKeys(player as never)();

    player.dispatchEvent(new Event("play"));

    expect(anchors).toHaveLength(0);
  });
});
