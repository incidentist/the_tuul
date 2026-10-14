import { describe, it, expect, vi, afterEach } from "vitest";
import type { StretchNode } from "signalsmith-stretch";
import { WebAudioPlayer, engineFor, heardContextTime, songTimeAt } from "./webAudioPlayer";

class FakeParam {
  value = 1;
  events: Array<[string, ...number[]]> = [];

  setValueAtTime(value: number, time: number) {
    this.events.push(["set", value, time]);
  }

  cancelScheduledValues(time: number) {
    this.events.push(["cancel", time]);
  }

  linearRampToValueAtTime(value: number, time: number) {
    this.events.push(["ramp", value, time]);
  }
}

class FakeSource {
  buffer: unknown = null;
  playbackRate = new FakeParam();
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeContext {
  currentTime = 10;
  sampleRate = 48000;
  outputLatency = 0;
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeParam[] = [];
  stamp: AudioTimestamp = { contextTime: 0, performanceTime: 0 };
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});

  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  createGain() {
    const gain = new FakeParam();
    this.gains.push(gain);
    return { gain, connect: (node: unknown) => node };
  }

  getOutputTimestamp() {
    return this.stamp;
  }
}

function fakeStretch() {
  return {
    connect: (node: unknown) => node,
    latency: async () => 0.12,
    schedule: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    addBuffers: vi.fn(async () => 0),
    dropBuffers: vi.fn(async () => {}),
  };
}

const track = {
  duration: 20,
  sampleRate: 48000,
  numberOfChannels: 2,
  getChannelData: () => new Float32Array(4),
} as unknown as AudioBuffer;

let players: WebAudioPlayer[] = [];

/**
 * A player on fake contexts and a fake Signalsmith node, with its track loaded.
 */
async function loadedPlayer(options: { pauseWhenHidden?: boolean } = {}) {
  const contexts: FakeContext[] = [];
  const stretches: ReturnType<typeof fakeStretch>[] = [];
  const player = new WebAudioPlayer({
    createContext: () => {
      const context = new FakeContext();
      contexts.push(context);
      return context as unknown as AudioContext;
    },
    createStretch: async () => {
      const stretch = fakeStretch();
      stretches.push(stretch);
      return stretch as unknown as StretchNode;
    },
    decode: async () => track,
    ...options,
  });
  players.push(player);
  await player.load(new Blob());
  return { player, contexts, stretches };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function hidePage() {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  players.forEach((player) => player.dispose());
  players = [];
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

describe("engineFor", () => {
  it("bypasses Signalsmith at exactly 1x, and when the pitch may drop", () => {
    expect(engineFor(1, true)).toBe("buffer");
    expect(engineFor(0.5, false)).toBe("buffer");
    expect(engineFor(0.5, true)).toBe("stretch");
    expect(engineFor(1.25, true)).toBe("stretch");
  });
});

describe("heardContextTime", () => {
  it("takes the output latency off a timestamp that leaves it out, as Firefox's does", () => {
    const heard = heardContextTime({ contextTime: 5, performanceTime: 1000 }, 5, 0.04, 1000);
    expect(heard).toBeCloseTo(4.96, 6);
  });

  it("trusts a timestamp that already trails the context's time by the latency, as Chrome's does", () => {
    const heard = heardContextTime({ contextTime: 4.96, performanceTime: 1000 }, 5, 0.04, 1000);
    expect(heard).toBeCloseTo(4.96, 6);
  });

  it("extrapolates the timestamp to now, and back to an earlier time", () => {
    const stamp = { contextTime: 4.96, performanceTime: 1000 };
    expect(heardContextTime(stamp, 5.1, 0.04, 1100)).toBeCloseTo(5.06, 6);
    expect(heardContextTime(stamp, 5.1, 0.04, 1100, 1050)).toBeCloseTo(5.01, 6);
  });

  it("falls back on the context's time before the first timestamp", () => {
    expect(heardContextTime({ contextTime: 0, performanceTime: 0 }, 2, 0.05, 1000)).toBe(1.95);
  });
});

describe("songTimeAt", () => {
  const spans = [
    { input: 2, output: 10, rate: 1 },
    { input: 3, output: 11, rate: 0.5 },
  ];

  it("holds at the start until it is heard", () => {
    expect(songTimeAt(spans, 9.5)).toBe(2);
  });

  it("follows each span at its rate", () => {
    expect(songTimeAt(spans, 10.5)).toBe(2.5);
    expect(songTimeAt(spans, 12)).toBe(3.5);
  });
});

describe("WebAudioPlayer", () => {
  it("plays a range from its start to its end on the audio clock", async () => {
    const { player, contexts } = await loadedPlayer();

    player.playRange(2, 3.5);
    await flush();

    const [source] = contexts[0].sources;
    expect(player.engine).toBe("buffer");
    expect(source.start).toHaveBeenCalledWith(10.03, 2, 1.5);
  });

  it("slows down through Signalsmith, whose gain cuts the end", async () => {
    const { player, contexts, stretches } = await loadedPlayer();
    player.playbackRate = 0.5;

    player.playRange(2, 3);
    await flush();

    expect(player.engine).toBe("stretch");
    expect(stretches[0].addBuffers).toHaveBeenCalledOnce();
    expect(stretches[0].schedule).toHaveBeenCalledWith({
      output: expect.closeTo(10.15, 6),
      active: true,
      input: 2,
      rate: 0.5,
    });
    expect(contexts[0].gains[0].events).toContainEqual(["set", 1, expect.closeTo(10.15, 6)]);
    expect(contexts[0].gains[0].events).toContainEqual(["set", 0, expect.closeTo(12.15, 6)]);
  });

  it("slows a plain buffer down when the pitch may drop", async () => {
    const { player, contexts } = await loadedPlayer();
    player.preservesPitch = false;
    player.playbackRate = 0.5;

    player.playRange(2, 3);
    await flush();

    expect(player.engine).toBe("buffer");
    expect(contexts[0].sources[0].playbackRate.value).toBe(0.5);
  });

  it("pauses after the audio already rendered", async () => {
    const { player, contexts } = await loadedPlayer();
    player.currentTime = 5;
    await player.play();

    contexts[0].currentTime = 11;
    player.pause();

    expect(player.paused).toBe(true);
    expect(player.currentTime).toBeCloseTo(5.97, 6);
    expect(contexts[0].sources[0].stop).toHaveBeenCalledWith(11);
  });

  it("reports the song time being heard", async () => {
    const { player, contexts } = await loadedPlayer();
    player.currentTime = 5;
    await player.play();

    const now = performance.now();
    Object.assign(contexts[0], {
      currentTime: 11.04,
      outputLatency: 0.04,
      stamp: { contextTime: 11, performanceTime: now },
    });

    expect(player.timeAt(now)).toBeCloseTo(5.97, 3);
    expect(player.timeAt(now - 100)).toBeCloseTo(5.87, 3);
  });

  it("hands a rate change over at a time on the audio clock", async () => {
    const { player, contexts, stretches } = await loadedPlayer();
    await player.play();

    contexts[0].currentTime = 11;
    player.playbackRate = 0.5;
    await flush();

    // Signalsmith starts 0.15 s ahead, where the buffer has reached 1.12 s.
    expect(contexts[0].sources[0].stop).toHaveBeenCalledWith(expect.closeTo(11.15, 6));
    expect(stretches[0].schedule).toHaveBeenCalledWith({
      output: expect.closeTo(11.15, 6),
      active: true,
      input: expect.closeTo(1.12, 6),
      rate: 0.5,
    });
  });

  it("fades a track loaded during playback in over the one it replaces", async () => {
    const { player, contexts } = await loadedPlayer();
    player.currentTime = 5;
    await player.play();

    contexts[0].currentTime = 11;
    await player.load(new Blob());

    const [before, after] = contexts[0].sources;
    const [beforeFader, afterFader] = contexts[0].gains;
    expect(before.stop).toHaveBeenCalledWith(expect.closeTo(11.05, 6));
    expect(beforeFader.events).toEqual([
      ["set", 1, expect.closeTo(11.03, 6)],
      ["ramp", 0, expect.closeTo(11.05, 6)],
    ]);
    // The old track has reached 6 s by the time the new one starts.
    expect(after.start).toHaveBeenCalledWith(expect.closeTo(11.03, 6), expect.closeTo(6, 6), 14);
    expect(afterFader.events).toEqual([
      ["set", 0, expect.closeTo(11.03, 6)],
      ["ramp", 1, expect.closeTo(11.05, 6)],
    ]);
    expect(player.paused).toBe(false);
  });

  it("emits ended before pause once a range has played", async () => {
    const { player, contexts } = await loadedPlayer();
    const events: string[] = [];
    for (const type of ["ended", "pause"]) {
      player.addEventListener(type, () => events.push(type));
    }

    player.playRange(2, 3);
    await flush();
    Object.assign(contexts[0], {
      currentTime: 12,
      stamp: { contextTime: 12, performanceTime: performance.now() },
    });

    await vi.waitFor(() => expect(events).toEqual(["ended", "pause"]));
    expect(player.currentTime).toBe(3);
  });

  it("pauses when the page is hidden, and plays on a new context after", async () => {
    const { player, contexts } = await loadedPlayer();
    const pauses = vi.fn();
    player.addEventListener("pause", pauses);
    player.currentTime = 5;
    await player.play();

    hidePage();

    expect(player.paused).toBe(true);
    expect(pauses).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalled();

    await player.play();
    player.pause();
    await player.play();

    expect(contexts).toHaveLength(2);
    expect(contexts[1].sources[0].start).toHaveBeenCalledWith(10.03, 5, 15);
  });

  it("plays on through a hidden page when told to, and closes the context if paused", async () => {
    const { player, contexts } = await loadedPlayer({ pauseWhenHidden: false });
    await player.play();

    hidePage();

    expect(player.paused).toBe(false);
    expect(contexts[0].close).not.toHaveBeenCalled();

    player.pause();
    hidePage();

    expect(contexts[0].close).toHaveBeenCalled();
  });

  it("plays on when the window loses focus", async () => {
    const { player, contexts } = await loadedPlayer();
    await player.play();

    window.dispatchEvent(new Event("blur"));

    expect(player.paused).toBe(false);
    expect(contexts[0].close).not.toHaveBeenCalled();
  });
});
