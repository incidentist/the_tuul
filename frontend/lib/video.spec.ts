import {
  FfmpegParamsOptions,
  RenderProgress,
  getAlternateTrackParams,
  getFfmpegParams,
  getMkvMuxParams,
  getTitleFrameParams,
  parseYouTubeTitle,
  fetchYouTubeVideo,
} from "./video";

// Mock fetch globally
global.fetch = vi.fn();

const METADATA = { artist: "The Bolks", title: "Squibble Doo Dah" };
const ALTERNATES = [
  { fileName: "vocals.m4a", title: "Vocals" },
  { fileName: "original.m4a", title: "Original mix" },
];

// The value ffmpeg would read for an argument, e.g. valueOf(args, '-c:a').
function valueOf(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

// The -threads input option ffmpeg would apply to one input: the last one between the previous -i and this one.
function inputThreads(args: string[], input: string): string | undefined {
  const inputIndex = args.findIndex((arg, index) => arg === input && args[index - 1] === "-i");
  const previousInput = args.lastIndexOf("-i", inputIndex - 2);
  const options = args.slice(previousInput + 1, inputIndex - 1);
  return valueOf(options.slice(options.lastIndexOf("-threads")), "-threads");
}

describe("getAlternateTrackParams", () => {
  it("encodes one delayed track on a single thread", () => {
    const args = getAlternateTrackParams("vocals.wav", 2000, "vocals.m4a");

    expect(valueOf(args, "-i")).toBe("vocals.wav");
    // Cover art would otherwise come along as a video stream the m4a muxer rejects.
    expect(valueOf(args, "-map")).toBe("0:a:0");
    expect(valueOf(args, "-af")).toBe("adelay=delays=2000:all=1");
    expect(valueOf(args, "-c:a")).toBe("aac");
    // A second audio encoder in one run deadlocks the WASM core above one thread.
    expect(valueOf(args, "-threads")).toBe("1");
    expect(args.at(-1)).toBe("vocals.m4a");
  });

  it("decodes the track on a single thread", () => {
    const args = getAlternateTrackParams("vocals.flac", 0, "vocals.m4a");

    expect(inputThreads(args, "vocals.flac")).toBe("1");
  });
});

describe("getFfmpegParams", () => {
  const FRAME = { width: 1920, height: 1080, frameRate: 30 };
  const VIDEO = { kind: "video", fileName: "background.webm" } as const;
  const IMAGE = { kind: "image", fileName: "background.png" } as const;

  function params(overrides: Partial<FfmpegParamsOptions> = {}) {
    return getFfmpegParams({
      background: null,
      backgroundColor: "0x101010",
      frame: FRAME,
      audioDelayMs: 0,
      durationSeconds: 200,
      metadata: METADATA,
      ...overrides,
    });
  }

  // The filters the background goes through before the subtitles, in order.
  function videoFilters(args: string[]): string[] {
    const chain = graphChains(args).find((each) => each.endsWith("[vout]"))!;
    return chain
      .replace(/^(\[[^\]]+\])+/, "")
      .replace(/\[vout\]$/, "")
      .split(",");
  }

  function graphChains(args: string[]): string[] {
    return valueOf(args, "-filter_complex")!.split(";");
  }

  it.each([
    ["a background video", VIDEO],
    ["a background image", IMAGE],
    ["a plain background", null],
  ])("decodes the backing track on a single thread over %s", (_, background) => {
    expect(inputThreads(params({ background }), "audio.mp4")).toBe("1");
  });

  it.each([
    ["a background video", VIDEO],
    ["a background image", IMAGE],
    ["a plain background", null],
  ])("runs the filter graph on a single thread over %s", (_, background) => {
    // A thread per core overruns the WASM core's thread pool on a many-core machine.
    expect(valueOf(params({ background }), "-filter_complex_threads")).toBe("1");
  });

  it.each([
    [1280, 720, 20],
    [1920, 1080, 30],
  ])("generates a plain %ix%i background at %i fps", (width, height, frameRate) => {
    const args = params({ frame: { width, height, frameRate } });

    expect(valueOf(args, "-f")).toBe("lavfi");
    expect(valueOf(args, "-i")).toBe(`color=c=0x101010:s=${width}x${height}:r=${frameRate}`);
    expect(videoFilters(args)).toEqual(["ass=subtitles.ass:fontsdir=/tmp"]);
  });

  it.each([
    [1280, 720, 20],
    [1920, 1080, 30],
  ])("covers a %ix%i frame with the background video at %i fps", (width, height, frameRate) => {
    const args = params({
      background: VIDEO,
      frame: { width, height, frameRate },
      audioDelayMs: 2500,
    });

    expect(videoFilters(args)).toEqual([
      `fps=${frameRate}`,
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      "tpad=start_duration=2.5:start_mode=clone",
      "ass=subtitles.ass:fontsdir=/tmp",
    ]);
  });

  it.each([
    [1280, 720, 20],
    [1920, 1080, 30],
  ])("covers a %ix%i frame with the background image at %i fps", (width, height, frameRate) => {
    const args = params({ background: IMAGE, frame: { width, height, frameRate } });

    expect(graphChains(args).slice(0, 3)).toEqual([
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[img]`,
      `color=c=0x101010:s=${width}x${height}[base]`,
      `[base][img]overlay=(W-w)/2:(H-h)/2:shortest=1,loop=loop=-1:size=1,fps=${frameRate},` +
        "ass=subtitles.ass:fontsdir=/tmp[vout]",
    ]);
  });

  it("fits the whole background video in the frame, with bars in the background color", () => {
    const filters = videoFilters(params({ background: VIDEO, backgroundFit: "fit" }));

    expect(filters.slice(1, 3)).toEqual([
      "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2",
      "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x101010",
    ]);
    expect(filters).not.toContainEqual(expect.stringMatching(/^crop/));
  });

  it("fits the whole background image over the background color, which fills the bars", () => {
    const args = params({ background: IMAGE, backgroundFit: "fit" });

    expect(graphChains(args)[0]).toBe(
      "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2[img]",
    );
    expect(videoFilters(args)[0]).toBe("overlay=(W-w)/2:(H-h)/2:shortest=1");
  });

  it("decodes the background image once, on a single thread", () => {
    const args = params({ background: IMAGE, audioDelayMs: 2500, videoOffset: 1 });

    expect(args).not.toContain("-loop");
    expect(args).not.toContain("-stream_loop");
    expect(inputThreads(args, "background.png")).toBe("1");
    expect(videoFilters(args)).not.toContainEqual(expect.stringMatching(/^(tpad|trim)/));
  });

  it("delays the background video by a positive offset", () => {
    const filters = videoFilters(
      params({ background: VIDEO, audioDelayMs: 2500, videoOffset: 0.25 }),
    );

    expect(filters).not.toContainEqual(expect.stringMatching(/^trim/));
    expect(filters.at(-2)).toBe("tpad=start_duration=2.75:start_mode=clone");
  });

  it("skips the start of the background video by a negative offset, after looping it", () => {
    const args = params({ background: VIDEO, audioDelayMs: 2500, videoOffset: -1.5 });

    expect(args).not.toContain("-ss");
    expect(videoFilters(args)).toEqual([
      "trim=start=1.5",
      "setpts=PTS-STARTPTS",
      "fps=30",
      "scale=1920:1080:force_original_aspect_ratio=increase",
      "crop=1920:1080",
      "tpad=start_duration=2.5:start_mode=clone",
      "ass=subtitles.ass:fontsdir=/tmp",
    ]);
  });

  it("encodes with x264's veryfast preset at its default CRF", () => {
    const args = params();

    expect(valueOf(args, "-c:v")).toBe("libx264");
    expect(valueOf(args, "-preset")).toBe("veryfast");
    expect(valueOf(args, "-crf")).toBe("23");
  });

  it("lowers the CRF for the high quality, on the same preset", () => {
    const args = params({ quality: "high" });

    expect(valueOf(args, "-preset")).toBe("veryfast");
    expect(valueOf(args, "-crf")).toBe("18");
  });

  it("loops the background video and decodes it on a bounded number of threads", () => {
    const args = params({ background: VIDEO });

    expect(args.slice(0, 2)).toEqual(["-stream_loop", "-1"]);
    expect(inputThreads(args, "background.webm")).toBe("2");
  });

  it("delays the backing track by the title delay", () => {
    const args = params({ audioDelayMs: 2500 });

    expect(valueOf(args, "-filter_complex")).toContain("[1:a]adelay=delays=2500:all=1[aout]");
    expect(args.join(" ")).toContain("-map [vout] -map [aout]");
  });

  it("mixes the hint tone into the delayed backing track", () => {
    const args = params({ audioDelayMs: 4000, hintTone: true });
    const chains = graphChains(args);

    expect(args.join(" ")).toContain("-i audio.mp4 -i hint.wav");
    expect(chains).toContain("[1:a]adelay=delays=4000:all=1[song]");
    // The backing track sets the length, and normalizing would halve its level.
    expect(chains).toContain("[song][2:a]amix=inputs=2:duration=first:normalize=0[aout]");
  });

  it.each([
    ["a background video", VIDEO],
    ["a background image", IMAGE],
    ["a plain background", null],
  ])("sets the length explicitly over %s", (_, background) => {
    const args = params({ background, durationSeconds: 203.4567 });

    expect(valueOf(args, "-t")).toBe("203.457");
    // Neither background ever ends, so -shortest would render forever.
    expect(args).not.toContain("-shortest");
  });
});

describe("getTitleFrameParams", () => {
  it("writes one frame of the rendered video on one thread, seeking before decoding", () => {
    const args = getTitleFrameParams(1.23456);

    expect(valueOf(args, "-ss")).toBe("1.235");
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(inputThreads(args, "karaoke.mp4")).toBe("1");
    expect(valueOf(args, "-frames:v")).toBe("1");
    expect(args.slice(-4)).toEqual(["-threads", "1", "-y", "title.png"]);
  });
});

describe("getMkvMuxParams", () => {
  it("copies the rendered video and labels every audio track", () => {
    const args = getMkvMuxParams(ALTERNATES, METADATA);

    expect(args.at(-1)).toBe("karaoke.mkv");
    expect(args.join(" ")).toContain("-i karaoke.mp4 -i vocals.m4a -i original.m4a");
    expect(args.join(" ")).toContain("-map 0:v -map 0:a -map 1:a -map 2:a");
    expect(valueOf(args, "-c")).toBe("copy");
    expect(valueOf(args, "-metadata:s:a:0")).toBe("title=Backing track");
    expect(valueOf(args, "-metadata:s:a:1")).toBe("title=Vocals");
    expect(valueOf(args, "-metadata:s:a:2")).toBe("title=Original mix");
    expect(valueOf(args, "-disposition:a:0")).toBe("default");
    expect(valueOf(args, "-disposition:a:1")).toBe("0");
    expect(valueOf(args, "-disposition:a:2")).toBe("0");
    expect(valueOf(args, "-disposition:v:0")).toBe("default");
    expect(valueOf(args, "-metadata")).toBe("artist=The Bolks");
  });

  it("names the main track after the restored gaps when the plain backing track is an alternate", () => {
    const args = getMkvMuxParams(
      [{ fileName: "backing.m4a", title: "Backing track" }, ...ALTERNATES],
      METADATA,
      "restoredBacking",
    );

    expect(valueOf(args, "-metadata:s:a:0")).toBe("title=Backing track, gaps restored");
    expect(valueOf(args, "-metadata:s:a:1")).toBe("title=Backing track");
    expect(valueOf(args, "-disposition:a:0")).toBe("default");
    expect(valueOf(args, "-disposition:a:1")).toBe("0");
  });

  it("names the main track after the original mix when the video plays the full song", () => {
    const args = getMkvMuxParams(
      [
        { fileName: "backing.m4a", title: "Backing track" },
        { fileName: "vocals.m4a", title: "Vocals" },
      ],
      METADATA,
      "original",
    );

    expect(valueOf(args, "-metadata:s:a:0")).toBe("title=Original mix");
    expect(valueOf(args, "-metadata:s:a:1")).toBe("title=Backing track");
    expect(valueOf(args, "-metadata:s:a:2")).toBe("title=Vocals");
  });

  it("leaves out an alternate that never arrived", () => {
    const args = getMkvMuxParams([ALTERNATES[0]], METADATA);

    expect(args.join(" ")).toContain("-map 0:v -map 0:a -map 1:a");
    expect(args).not.toContain("-map 2:a");
    expect(args).not.toContain("-metadata:s:a:2");
  });
});

describe("RenderProgress", () => {
  const RENDER = { phrase: "rendering the video", weight: 0.85 };
  const VOCALS = { phrase: "encoding the vocals track", weight: 0.06 };
  const MUX = { phrase: "writing the MKV", weight: 0.09 };

  // What a run prints once it has encoded `seconds` of media.
  function atSecond(seconds: number) {
    const stamp = new Date(seconds * 1000).toISOString().substring(11, 22);
    return {
      type: "stdout",
      message: `size=     468kB time=${stamp} bitrate= 150.0kbits/s`,
    } as any;
  }

  function record(plan: { phrase: string; weight: number }[], mediaSeconds = 100) {
    const reported: [number, string][] = [];
    const progress = new RenderProgress(plan, mediaSeconds, (value, step) =>
      reported.push([value, step]),
    );
    return { progress, reported, latest: () => reported[reported.length - 1] };
  }

  it("reports a single run against the length it produces", () => {
    const { progress, latest } = record([RENDER]);

    progress.begin(RENDER);
    progress.handleLog(atSecond(50));

    // The only step owns the whole bar, however small its weight reads.
    expect(latest()).toEqual([0.5, "rendering the video"]);
  });

  it("carries later runs on from where the earlier ones finished", () => {
    const { progress, latest } = record([RENDER, VOCALS, MUX]);

    progress.begin(RENDER);
    progress.handleLog(atSecond(100));
    progress.end();
    expect(latest()[0]).toBeCloseTo(0.85);
    expect(latest()[1]).toBe("rendering the video");

    progress.begin(VOCALS);
    progress.handleLog(atSecond(50));
    expect(latest()[0]).toBeCloseTo(0.88);
    expect(latest()[1]).toBe("encoding the vocals track");

    progress.end();
    progress.begin(MUX);
    progress.handleLog(atSecond(100));
    expect(latest()[0]).toBeCloseTo(1);
  });

  it("ignores log lines that carry no timestamp", () => {
    const { progress, reported } = record([RENDER]);

    progress.begin(RENDER);
    reported.length = 0;
    progress.handleLog({ type: "stdout", message: "[libx264 @ 0x1] using SAR=1/1" } as any);

    expect(reported).toEqual([]);
  });

  it("stops at full even when a run overruns the expected length", () => {
    const { progress, latest } = record([RENDER], 10);

    progress.begin(RENDER);
    progress.handleLog(atSecond(30));

    expect(latest()[0]).toBe(1);
  });

  it("still moves when the song duration is unknown", () => {
    const { progress, latest } = record([RENDER], 0);

    progress.begin(RENDER);
    progress.handleLog(atSecond(150));

    expect(latest()[0]).toBeCloseTo(0.5);
  });
});

describe("Video Library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parseYouTubeTitle handles titles without author info", () => {
    expect(parseYouTubeTitle({ title: "The Bolks singing Squibble Doo Dah" })).toEqual([
      "",
      "The Bolks singing Squibble Doo Dah",
    ]);
  });

  it("parseYouTubeTitle parses author and title correctly", () => {
    const expected = ["The Bolks", "Squibble Doo Dah"];
    expect(parseYouTubeTitle({ author: "The Bolks", title: "Squibble Doo Dah" })).toEqual(expected);
  });

  it("fetchYouTubeVideo throws error when polling endpoint returns error JSON", async () => {
    const mockFetch = fetch as any;

    // Mock initial response with polling URL
    const initialResponse = {
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue("application/json"),
      },
      json: vi.fn().mockResolvedValue({
        finishedDownloadURL: "http://example.com/poll-url",
      }),
    };

    // Mock polling response with error JSON
    const errorResponse = {
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue("application/json"),
      },
      blob: vi.fn().mockResolvedValue(
        new Blob(
          [
            JSON.stringify({
              success: false,
              error: "No route to host - unable to reach: YouTube servers",
            }),
          ],
          { type: "application/json" },
        ),
      ),
    };

    mockFetch
      .mockResolvedValueOnce(initialResponse as any)
      .mockResolvedValueOnce(errorResponse as any);

    await expect(fetchYouTubeVideo("https://www.youtube.com/watch?v=test")).rejects.toThrow(
      "No route to host - unable to reach: YouTube servers",
    );
  });
});
