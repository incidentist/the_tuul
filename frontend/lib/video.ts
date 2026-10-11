import type { LogEvent } from "@ffmpeg/ffmpeg";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

import { RenderDiagnostics } from "@/lib/renderDiagnostics";
import { BackgroundFit, KaraokeOptions, RESOLUTIONS, RenderQuality } from "@/lib/timing";
import { BackgroundKind, backgroundExtension, backgroundKind } from "@/lib/background";
import { audioDuration } from "@/lib/trackLength";
import { HintTone, hintToneWav } from "@/lib/hintTone";
import jszip from "jszip";

// Functions related to video file creation

interface VideoMetadata {
  duration?: number;
  artist?: string;
  title?: string;
}

// What the video's own audio track holds, which names it in an MKV.
export type MainAudioTrack = "backing" | "restoredBacking" | "original";

// The additional audio tracks an MKV render carries alongside the main track.
// A track left undefined isn't wanted, and a null or empty one is missing.
export interface AlternateAudioTracks {
  // The plain backing track, when the main track is something else.
  backing?: Blob | null;
  vocals?: Blob | null;
  original?: Blob | null;
}

interface EncodedTrack {
  fileName: string;
  title: string;
}

const RENDERED_VIDEO_FILE = "karaoke.mp4";
const MKV_FILE = "karaoke.mkv";
const TITLE_FRAME_FILE = "title.png";
const BACKING_TRACK_TITLE = "Backing track";
const ORIGINAL_TRACK_TITLE = "Original mix";

const MAIN_TRACK_TITLES: Record<MainAudioTrack, string> = {
  backing: BACKING_TRACK_TITLE,
  restoredBacking: "Backing track, gaps restored",
  original: ORIGINAL_TRACK_TITLE,
};

const ALTERNATE_TRACKS = [
  { key: "backing", title: BACKING_TRACK_TITLE },
  { key: "vocals", title: "Vocals" },
  { key: "original", title: ORIGINAL_TRACK_TITLE },
] as const satisfies readonly { key: keyof AlternateAudioTracks; title: string }[];

class ApiError extends Error {
  public path: string;
  public status?: number;

  constructor(path: string, message: string, status?: number) {
    super(message);
    this.path = path;
    this.name = "ApiError";
    this.status = status;
  }

  toString() {
    return `${this.name}: ${this.message} (status: ${this.status ?? "N/A"}, path: ${this.path})`;
  }
}

// An input option, so it goes right before the -i it applies to.
// The FLAC decoder otherwise starts a thread per core,
// and the WASM core deadlocks once its fixed thread pool runs out.
const SINGLE_THREAD_DECODE = ["-threads", "1"];
// The same goes for the background video's decoder and for the filter graph,
// which otherwise start a thread per core too.
const BACKGROUND_DECODE_THREADS = ["-threads", "2"];
const FILTER_THREADS = ["-filter_complex_threads", "1"];
// Against the default medium, this renders about 3.5 times faster in the browser,
// with files of the same size and nearly the same quality.
const VIDEO_ENCODER = ["-c:v", "libx264", "-preset", "veryfast"];
// A slower preset barely improves on veryfast at the same CRF, so only the CRF changes.
const QUALITY_CRF: Record<RenderQuality, number> = { standard: 23, high: 18 };

export interface RenderFrame {
  width: number;
  height: number;
  frameRate: number;
}

// The background file as written to FFmpeg's filesystem, or none for a plain color.
export interface BackgroundInput {
  kind: BackgroundKind;
  fileName: string;
}

const HINT_TONE_FILE = "hint.wav";

export interface FfmpegParamsOptions {
  background: BackgroundInput | null;
  backgroundFit?: BackgroundFit;
  backgroundColor: string;
  frame: RenderFrame;
  quality?: RenderQuality;
  audioDelayMs: number;
  // Whether HINT_TONE_FILE is mixed into the backing track.
  hintTone?: boolean;
  // Seconds the background video is moved by. A positive offset delays it, and a negative one
  // skips its start.
  videoOffset?: number;
  // The whole video's length. It has to be explicit, since -shortest never ends a filter graph
  // fed by an endless background, which a color source or a looped video is.
  durationSeconds: number;
  metadata: VideoMetadata;
}

// An image goes through chains of its own first, and `head` names their outputs.
interface BackgroundSource {
  input: string[];
  chains?: string[];
  head?: string;
  filters: string[];
}

/**
 * The input arguments and the filters that turn the background into frames of the video's size
 * and rate, before the subtitles go over them.
 */
function backgroundSource(
  background: BackgroundInput | null,
  {
    backgroundFit,
    backgroundColor,
    width,
    height,
    frameRate,
    heldSeconds,
    videoOffset,
  }: RenderFrame & {
    backgroundFit: BackgroundFit;
    backgroundColor: string;
    heldSeconds: number;
    videoOffset: number;
  },
): BackgroundSource {
  const scaled =
    backgroundFit === "fit"
      ? [`scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`]
      : [
          `scale=${width}:${height}:force_original_aspect_ratio=increase`,
          `crop=${width}:${height}`,
        ];
  // As the preview shows it: either covering the frame and cropped to it, or whole and centered.
  const cover =
    backgroundFit === "fit"
      ? [
          // Chroma is subsampled, so an odd size or offset would shift the colors by a pixel.
          `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${backgroundColor}`,
        ]
      : [
          `scale=${width}:${height}:force_original_aspect_ratio=increase`,
          `crop=${width}:${height}`,
        ];
  if (background?.kind === "video") {
    return {
      // A video shorter than the song loops, and -t cuts a longer one.
      input: ["-stream_loop", "-1", ...BACKGROUND_DECODE_THREADS, "-i", background.fileName],
      filters: [
        // An input -ss would be simpler, but with -stream_loop the first loop then ends early.
        ...(videoOffset < 0 ? [`trim=start=${-videoOffset}`, "setpts=PTS-STARTPTS"] : []),
        `fps=${frameRate}`,
        ...cover,
        // Its first frame repeats during the title delay and any delay of its own.
        `tpad=start_duration=${heldSeconds}:start_mode=clone`,
      ],
    };
  }
  if (background?.kind === "image") {
    return {
      input: [...SINGLE_THREAD_DECODE, "-i", background.fileName],
      // Laid over the background color, which fills the bars and shows through any transparency.
      // Converting to the video's pixel format would otherwise drop the alpha and show whatever
      // color the image stores under it.
      chains: [
        `[0:v]${scaled.join(",")}[img]`,
        `color=c=${backgroundColor}:s=${width}x${height}[base]`,
      ],
      head: "[base][img]",
      // The still is decoded, scaled and laid over once, then repeated. An input -loop would decode
      // it again for every frame.
      filters: ["overlay=(W-w)/2:(H-h)/2:shortest=1", "loop=loop=-1:size=1", `fps=${frameRate}`],
    };
  }
  return {
    input: ["-f", "lavfi", "-i", `color=c=${backgroundColor}:s=${width}x${height}:r=${frameRate}`],
    filters: [],
  };
}

export function getFfmpegParams({
  background: backgroundInput,
  backgroundFit = "fill",
  backgroundColor,
  frame: { width, height, frameRate },
  quality = "standard",
  audioDelayMs,
  hintTone = false,
  videoOffset = 0,
  durationSeconds,
  metadata,
}: FfmpegParamsOptions) {
  // Rounded, so the filters don't carry float noise such as 2.7500000000000004.
  const heldSeconds = Number((audioDelayMs / 1000 + Math.max(0, videoOffset)).toFixed(3));
  const background = backgroundSource(backgroundInput, {
    backgroundFit,
    backgroundColor,
    width,
    height,
    frameRate,
    heldSeconds,
    videoOffset,
  });
  const delaySong = `[1:a]adelay=delays=${audioDelayMs}:all=1`;
  const filterGraph = [
    ...(background.chains ?? []),
    `${background.head ?? "[0:v]"}${[...background.filters, "ass=subtitles.ass:fontsdir=/tmp"].join(",")}[vout]`,
    ...(hintTone
      ? [`${delaySong}[song]`, "[song][2:a]amix=inputs=2:duration=first:normalize=0[aout]"]
      : [`${delaySong}[aout]`]),
  ].join(";");

  return [
    ...background.input,
    ...SINGLE_THREAD_DECODE,
    "-i",
    "audio.mp4",
    ...(hintTone ? ["-i", HINT_TONE_FILE] : []),
    ...FILTER_THREADS,
    "-filter_complex",
    filterGraph,
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-t",
    durationSeconds.toFixed(3),
    "-y",
    ...VIDEO_ENCODER,
    "-crf",
    String(QUALITY_CRF[quality]),
    "-threads",
    "3",
    ...ffmpegMetadataArgs(metadata),
    RENDERED_VIDEO_FILE,
  ];
}

// One alternate per run: two audio encoders in one ffmpeg run deadlock the WASM core above
// one thread.
export function getAlternateTrackParams(
  inputFile: string,
  audioDelayMs: number,
  outputFile: string,
) {
  return [
    ...SINGLE_THREAD_DECODE,
    "-i",
    inputFile,
    // Cover art would otherwise come in as a video stream the m4a muxer rejects.
    "-map",
    "0:a:0",
    "-af",
    `adelay=delays=${audioDelayMs}:all=1`,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-threads",
    "1",
    "-y",
    outputFile,
  ];
}

// Copy only: nothing here re-encodes.
export function getMkvMuxParams(
  alternates: EncodedTrack[],
  metadata: VideoMetadata,
  mainTrack: MainAudioTrack = "backing",
) {
  const titles = [MAIN_TRACK_TITLES[mainTrack], ...alternates.map(({ title }) => title)];
  return [
    "-i",
    RENDERED_VIDEO_FILE,
    ...alternates.flatMap(({ fileName }) => ["-i", fileName]),
    "-map",
    "0:v",
    "-map",
    "0:a",
    ...alternates.flatMap((_track, index) => ["-map", `${index + 1}:a`]),
    "-c",
    "copy",
    // Setting any disposition turns off ffmpeg's automatic ones, video included.
    "-disposition:v:0",
    "default",
    ...titles.flatMap((title, index) => [
      `-metadata:s:a:${index}`,
      `title=${title}`,
      `-disposition:a:${index}`,
      index === 0 ? "default" : "0",
    ]),
    ...ffmpegMetadataArgs(metadata),
    "-y",
    MKV_FILE,
  ];
}

export function getTitleFrameParams(seconds: number) {
  return [
    "-ss",
    seconds.toFixed(3),
    ...SINGLE_THREAD_DECODE,
    "-i",
    RENDERED_VIDEO_FILE,
    "-frames:v",
    "1",
    // The PNG encoder otherwise starts a thread per core too.
    "-threads",
    "1",
    "-y",
    TITLE_FRAME_FILE,
  ];
}

// ffmpeg picks a demuxer partly by extension, so a named source keeps its own.
function withSourceExtension(baseName: string, source: Blob): string {
  const sourceName = source instanceof File ? source.name : "";
  const extension = sourceName.match(/\.([A-Za-z0-9]{1,5})$/)?.[1];
  return extension ? `${baseName}.${extension}` : baseName;
}

// A failed run otherwise surfaces as an FS error when its missing output is read back.
async function runFfmpeg(
  ffmpeg: FFmpeg,
  args: string[],
  step: RenderStep,
  progress: RenderProgress | null,
  diagnostics: RenderDiagnostics,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  diagnostics.mark(step.phrase);
  progress?.begin(step);
  const code = await ffmpeg.exec(args);
  if (code !== 0) {
    throw new Error(`FFmpeg failed while ${step.phrase} (exit code ${code})`);
  }
  progress?.end();
}

export type ProgressCallback = (progress: number, step: string) => void;

export interface RenderStep {
  // Names the step in the progress bar, and in the error if the step fails.
  phrase: string;
  // Relative to the other steps in the plan, not a fraction of the bar.
  weight: number;
}

// From the encode speeds the WASM core reports.
const STEP_WEIGHTS = {
  render: 0.85,
  titleFrame: 0.01,
  alternateTrack: 0.06,
  mux: 0.03,
};

const ASSUMED_SONG_SECONDS = 300;

// Each run reports the media time it has reached, so its own progress is that against the
// length of what it produces.
export class RenderProgress {
  private readonly totalWeight: number;
  private readonly mediaSeconds: number;
  private readonly onProgress: ProgressCallback;
  private finishedShare = 0;
  private currentShare = 0;
  private phrase = "";

  constructor(plan: RenderStep[], mediaSeconds: number, onProgress: ProgressCallback) {
    this.totalWeight = plan.reduce((total, { weight }) => total + weight, 0) || 1;
    this.mediaSeconds = mediaSeconds > 0 ? mediaSeconds : ASSUMED_SONG_SECONDS;
    this.onProgress = onProgress;
  }

  begin(step: RenderStep) {
    this.currentShare = step.weight / this.totalWeight;
    this.phrase = step.phrase;
    this.report(0);
  }

  handleLog = ({ message }: LogEvent) => {
    if (typeof message !== "string") return;
    const timestamp = message.match(/time=\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
    if (!timestamp) return;
    const [, hours, minutes, seconds] = timestamp;
    const reached = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
    this.report(Math.min(reached / this.mediaSeconds, 1));
  };

  end() {
    this.finishedShare += this.currentShare;
    this.currentShare = 0;
    this.report(0);
  }

  private report(stepProgress: number) {
    const total = this.finishedShare + this.currentShare * stepProgress;
    this.onProgress(Math.min(total, 1), this.phrase);
  }
}

interface AlternateSource {
  source: Blob;
  baseName: string;
  title: string;
}

function usableAlternates(tracks: AlternateAudioTracks | null): AlternateSource[] {
  const usable: AlternateSource[] = [];
  for (const { key, title } of ALTERNATE_TRACKS) {
    const source = tracks?.[key];
    if (source === undefined) {
      continue;
    }
    if (!source || source.size === 0) {
      console.warn(`No ${title.toLowerCase()} track available, leaving it out of the MKV`);
      continue;
    }
    usable.push({ source, baseName: key, title });
  }
  return usable;
}

/**
 * How long the backing track plays, from the file itself, since an uploaded backing track can run
 * longer than the song.
 */
async function backingSeconds(backing: Blob, songSeconds?: number): Promise<number> {
  const seconds = (await audioDuration(backing)) ?? songSeconds;
  if (!seconds) {
    throw new Error("Couldn't read the length of the backing track");
  }
  return seconds;
}

export interface CreateVideoOptions {
  backing: Blob;
  mainTrack?: MainAudioTrack;
  subtitles: string;
  videoOptions: KaraokeOptions;
  metadata: VideoMetadata;
  // Every font the subtitles use, keyed by family name.
  fontMap: Record<string, string>;
  // An image or a video.
  background?: Blob | null;
  backgroundVideoOffset?: number;
  audioDelay?: number;
  // Mixed into the main audio track only.
  hintTone?: HintTone | null;
  // When the video shows the title and artist. A PNG of the frame there comes back with the video.
  titleFrameTime?: number | null;
  alternateTracks?: AlternateAudioTracks | null;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

export interface CreatedVideo {
  video: Uint8Array;
  titleFrame: Uint8Array | null;
}

async function createVideo({
  backing,
  mainTrack = "backing",
  subtitles,
  videoOptions,
  metadata,
  fontMap,
  background = null,
  backgroundVideoOffset = 0,
  audioDelay = 0,
  hintTone = null,
  titleFrameTime = null,
  alternateTracks = null,
  onProgress,
  signal,
}: CreateVideoOptions): Promise<CreatedVideo> {
  // Create the video using ffmpeg.wasm v0.12
  const songFileName = "audio.mp4";
  const isMkv = videoOptions.outputFormat === "mkv";
  const backgroundColor = "0x" + videoOptions.color.background.toString().substring(1);
  const audioDelayMs = audioDelay * 1000;

  // Create FFmpeg instance and load multithread core

  // Most assets can be pulled from any origin, so let's use a CDN
  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.9/dist/esm";
  // The root worker needs to be served from the same origin as the page to enable SharedArrayBuffer
  const workerBaseUrl = window.location.origin + "/static/ffmpeg";
  const classWorkerURL = `${workerBaseUrl}/worker.js`;
  const ffmpeg = new FFmpeg();

  const coreFiles = {
    core: `${baseURL}/ffmpeg-core.js`,
    wasm: `${baseURL}/ffmpeg-core.wasm`,
    worker: `${baseURL}/ffmpeg-core.worker.js`,
  };
  const diagnostics = new RenderDiagnostics([...Object.values(coreFiles), classWorkerURL]);
  diagnostics.start();

  // The core does not come back to JS mid-run,
  // so killing its worker is the only way to stop an encode that is already going.
  const terminate = () => ffmpeg.terminate();
  signal?.addEventListener("abort", terminate, { once: true });
  try {
    diagnostics.mark("downloading the FFmpeg core");
    // Download most ffmpeg files to local blobs
    const [coreURL, wasmURL, workerURL] = await Promise.all([
      toBlobURL(coreFiles.core, "text/javascript").catch((error) => {
        console.error(`Failed to fetch FFmpeg core from: ${coreFiles.core}`, error);
        throw error;
      }),
      toBlobURL(coreFiles.wasm, "application/wasm").catch((error) => {
        console.error(`Failed to fetch FFmpeg WASM from: ${coreFiles.wasm}`, error);
        throw error;
      }),
      toBlobURL(coreFiles.worker, "text/javascript").catch((error) => {
        console.error(`Failed to fetch FFmpeg worker from: ${coreFiles.worker}`, error);
        throw error;
      }),
    ]);
    signal?.throwIfAborted();
    diagnostics.mark("loading FFmpeg");
    await ffmpeg.load({ coreURL, wasmURL, workerURL, classWorkerURL });

    ffmpeg.on("log", ({ message }) => console.log("ffmpeg output", message));
    ffmpeg.on("log", diagnostics.handleLog);
    diagnostics.mark("writing the input files");

    // Planned before anything runs, so the bar can weigh the whole job rather than restart
    // at each run.
    const alternates = isMkv ? usableAlternates(alternateTracks) : [];
    const renderStep: RenderStep = { phrase: "rendering the video", weight: STEP_WEIGHTS.render };
    const trackSteps: RenderStep[] = alternates.map(({ title }) => ({
      phrase: `encoding the ${title.toLowerCase()} track`,
      weight: STEP_WEIGHTS.alternateTrack,
    }));
    const muxStep: RenderStep = { phrase: "writing the MKV", weight: STEP_WEIGHTS.mux };
    const titleFrameStep: RenderStep = {
      phrase: "capturing the title frame",
      weight: STEP_WEIGHTS.titleFrame,
    };
    const plan = [
      renderStep,
      ...(titleFrameTime === null ? [] : [titleFrameStep]),
      ...(isMkv ? [...trackSteps, muxStep] : []),
    ];
    const videoSeconds = (await backingSeconds(backing, metadata.duration)) + audioDelay;
    const progress = onProgress ? new RenderProgress(plan, videoSeconds, onProgress) : null;
    if (progress) {
      ffmpeg.on("log", progress.handleLog);
    }

    // Write audio to ffmpeg filesystem
    await ffmpeg.writeFile(songFileName, await fetchFile(backing));
    if (hintTone) {
      await ffmpeg.writeFile(HINT_TONE_FILE, new Uint8Array(hintToneWav(hintTone)));
    }

    // The ass filter indexes fontsdir by the family name inside each file,
    // so the filename only has to be path-safe and unique, which a family name is not necessarily.
    for (const [index, [family, source]] of Object.entries(fontMap).entries()) {
      await ffmpeg.writeFile(
        `/tmp/${index}-${family.replace(/[^\w.-]+/g, "_")}.ttf`,
        await fetchFile(source),
      );
    }
    if (!fontMap[videoOptions.font.name]) {
      console.warn(`No font file available for "${videoOptions.font.name}", falling back`);
    }

    await ffmpeg.writeFile("subtitles.ass", subtitles);

    // ffmpeg picks a demuxer partly by extension.
    const backgroundInput = background
      ? {
          kind: backgroundKind(background),
          fileName: `background.${backgroundExtension(background)}`,
        }
      : null;
    if (background && backgroundInput) {
      await ffmpeg.writeFile(backgroundInput.fileName, await fetchFile(background));
    }

    const ffmpegParams = getFfmpegParams({
      background: backgroundInput,
      backgroundFit: videoOptions.backgroundFit,
      backgroundColor,
      frame: { ...RESOLUTIONS[videoOptions.resolution], frameRate: videoOptions.frameRate },
      quality: videoOptions.quality,
      audioDelayMs,
      hintTone: hintTone !== null,
      videoOffset: backgroundVideoOffset,
      durationSeconds: videoSeconds,
      metadata,
    });
    await runFfmpeg(ffmpeg, ffmpegParams, renderStep, progress, diagnostics, signal);

    let titleFrame: Uint8Array | null = null;
    if (titleFrameTime !== null) {
      // The video is what was asked for, so a missing frame only leaves out the PNG.
      try {
        await runFfmpeg(
          ffmpeg,
          getTitleFrameParams(titleFrameTime),
          titleFrameStep,
          progress,
          diagnostics,
          signal,
        );
        titleFrame = (await ffmpeg.readFile(TITLE_FRAME_FILE)) as Uint8Array;
      } catch (error) {
        signal?.throwIfAborted();
        console.warn("Couldn't capture the title frame", error);
      }
    }

    if (!isMkv) {
      return { video: (await ffmpeg.readFile(RENDERED_VIDEO_FILE)) as Uint8Array, titleFrame };
    }

    const encoded: EncodedTrack[] = [];
    for (const [index, { source, baseName, title }] of alternates.entries()) {
      const inputFile = withSourceExtension(baseName, source);
      const fileName = `${baseName}.m4a`;
      await ffmpeg.writeFile(inputFile, await fetchFile(source));
      await runFfmpeg(
        ffmpeg,
        getAlternateTrackParams(inputFile, audioDelayMs, fileName),
        trackSteps[index],
        progress,
        diagnostics,
        signal,
      );
      encoded.push({ fileName, title });
    }
    await runFfmpeg(
      ffmpeg,
      getMkvMuxParams(encoded, metadata, mainTrack),
      muxStep,
      progress,
      diagnostics,
      signal,
    );

    return { video: (await ffmpeg.readFile(MKV_FILE)) as Uint8Array, titleFrame };
  } catch (error) {
    // A terminated run surfaces as an ffmpeg failure, which is not what the caller asked for.
    signal?.throwIfAborted();
    throw error;
  } finally {
    diagnostics.stop();
    signal?.removeEventListener("abort", terminate);
    // Each run loads a core of its own, so without this every one leaks a worker holding 30-odd MB of wasm.
    ffmpeg.terminate();
  }
}

interface DownloadPollResponse {
  finishedDownloadURL: string;
}

async function isYouTubeError(response: Response, blob: Blob): Promise<string | null> {
  // Check if this is an error JSON response instead of a ZIP
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json") || blob.type === "application/json") {
    const text = await blob.text();
    try {
      const errorData = JSON.parse(text);
      if (!errorData.success && errorData.error) {
        return errorData.error;
      }
    } catch (parseError) {
      // If it's not valid JSON, continue as normal blob
    }
  }
  return null;
}

async function pollForVideoResult(url: string): Promise<Blob> {
  const POLL_INTERVAL = 10000; // 10 seconds
  while (true) {
    let response: Response;
    try {
      response = await fetch(url, {
        cache: "no-cache",
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("pollForVideoResult fetch failed:", {
        url,
        error: err.message,
        errorType: err.constructor.name,
        stack: err.stack,
      });
      throw error;
    }

    // For video downloads, a 404 means it's still processing
    if (response.status === 404) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      continue;
    }

    if (response.status !== 200) {
      const errMsg = await response.text();
      throw new ApiError(url, errMsg, response.status);
    }

    const blob = await response.blob();

    // Check if this is an error response
    const errorMessage = await isYouTubeError(response, blob);
    if (errorMessage) {
      throw new ApiError(url, errorMessage);
    }

    return blob;
  }
}

export async function fetchYouTubeVideo(url: string): Promise<[Blob, Blob, Object]> {
  const apiPath = "/download_video?url=" + url;

  try {
    const response = await fetch(apiPath);
    if (response.status !== 200) {
      const errMsg = await response.text();
      throw new ApiError(apiPath, errMsg, response.status);
    }

    const contentType = response.headers.get("content-type");

    let zipContents: Blob;

    // The endpoint can return either a JSON response with a URL to poll for results or a direct ZIP file response
    if (contentType?.includes("application/json")) {
      const jsonResponse: DownloadPollResponse = await response.json();
      zipContents = await pollForVideoResult(jsonResponse.finishedDownloadURL);
    } else {
      zipContents = await response.blob();
    }

    const zip = await jszip.loadAsync(zipContents);
    const audioEntry = zip.file("audio.mp4");
    const videoEntry = zip.file("video.mp4");
    const metadataEntry = zip.file("metadata.json");
    if (!audioEntry || !videoEntry || !metadataEntry) {
      throw new Error("YouTube download archive is missing audio.mp4, video.mp4 or metadata.json");
    }

    const [audio, video, metadata] = await Promise.all([
      audioEntry.async("blob"),
      videoEntry.async("blob"),
      metadataEntry.async("string").then((md) => JSON.parse(md)),
    ]);

    // TODO return blob URLs instead
    return [audio, video, metadata];
  } catch (error) {
    console.error(`Failed to fetch YouTube video from URL: ${apiPath}`, error);
    throw error;
  }
}

// Parse a YouTube video title into song artist and title
export function parseYouTubeTitle(videoMetadata: any): [string, string] {
  if (videoMetadata.author && videoMetadata.title) {
    return [videoMetadata.author, videoMetadata.title];
  }
  return ["", videoMetadata.title];
}

function ffmpegMetadataArgs(metadata: VideoMetadata): string[] {
  let ffmpegArgs = [];
  if (metadata.artist) {
    ffmpegArgs.push("-metadata", `artist=${metadata.artist}`);
  }
  if (metadata.title) {
    ffmpegArgs.push("-metadata", `title=${metadata.title}`);
  }
  ffmpegArgs.push("-metadata", `description=Karaoke version created by the-tuul.com`);
  return ffmpegArgs;
}

export default { createVideo, fetchYouTubeVideo, parseYouTubeTitle };
