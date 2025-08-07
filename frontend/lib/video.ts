import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { Log } from '@ffmpeg/ffmpeg/dist/esm/types';


import { KaraokeOptions } from "@/lib/timing";
import jszip from "jszip";

// Functions related to video file creation

const FFMPEG_CORE_VERSION = '0.12.9';

interface VideoMetadata {
    duration?: number;
    artist?: string;
    title?: string;
}

class ApiError extends Error {
    public path: string;
    public status: number;

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

function getFfmpegParams(hasVideo: boolean, backgroundColor: string, audioDelayMs: number, metadata: VideoMetadata) {
    let videoInputArgs, filterArgs;
    if (hasVideo) {
        videoInputArgs = [
            "-i",
            "video.mp4"
        ];
        // When there's a background video we use filter_complex to combine the video and audio
        filterArgs = [
            '-filter_complex',
            [
                // Prepend audioDelay secs of the video's first frame
                `[0:v]tpad=start_duration=${audioDelayMs / 1000}:start_mode=clone[padded]`,
                // Add subtitles over that
                "[padded]ass=subtitles.ass:fontsdir=/tmp[vout]",
                // Add audioDelay to audio
                `[1:a]adelay=delays=${audioDelayMs}:all=1[aout]`,
            ].join(";"),
            "-map",
            "[vout]",
            "-map",
            "[aout]"
        ];
    } else {
        videoInputArgs = [
            "-f",
            "lavfi",
            "-i",
            `color=c=${backgroundColor}:s=1280x720:r=20`,
        ];
        // When there's no video, things are simpler
        filterArgs = [
            // Add audioDelay to audio
            "-af",
            `adelay=delays=${audioDelayMs}:all=1`,
            '-vf',
            `ass=subtitles.ass:fontsdir=/tmp`
        ];
    }
    const videoMetadata = ffmpegMetadataArgs(metadata);

    return [
        ...videoInputArgs,
        "-i",
        "audio.mp4",
        ...filterArgs,
        "-shortest",
        "-y",
        "-threads",
        "3",
        ...videoMetadata,
        "karaoke.mp4"
    ]
}

type ProgressCallback = (progress: number) => void;

function getProgressParser(fps: number, videoDuration: number, onProgress?: ProgressCallback): (message: Log) => void {
    // Return a message handler function that can parse logs and call the progress callback
    let totalFrames = fps * videoDuration;
    var framesFinished = 0;

    return ({ message }) => {
        console.log("ffmpeg output", message);
        if (!onProgress || totalFrames === 0) return;

        if (typeof message === 'string' && message.startsWith("frame=")) {
            const match = message.match(/frame=\s*(\d+)/);
            if (match && match.length > 0) {
                framesFinished = parseFloat(match[1]);
                const progress = Math.min(framesFinished / totalFrames, 1);
                onProgress(progress);
            }
        }
    };
}

async function createVideo(
    accompanimentDataUrl: string,
    videoBlob: Blob = null,
    subtitles: string,
    audioDelay: number = 0,
    videoOptions: KaraokeOptions,
    metadata: VideoMetadata,
    fontMap: Record<string, string>,
    onProgress?: ProgressCallback
): Promise<Uint8Array> {
    // Create the video using ffmpeg.wasm v0.12
    const songFileName = "audio.mp4";
    const backgroundColor =
        "0x" + videoOptions.color.background.toString().substring(1);
    const audioDelayMs = audioDelay * 1000;

    // Create FFmpeg instance and load multithread core

    // Most assets can be pulled from any origin, so let's use a CDN
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.9/dist/esm'
    // The root worker needs to be served from the same origin as the page to enable SharedArrayBuffer
    const workerBaseUrl = window.location.origin + '/static/ffmpeg';
    const ffmpeg = new FFmpeg();

    // Download most ffmpeg files to local blobs
    const [coreURL, wasmURL, workerURL] = await Promise.all([
        toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
    ]);
    await ffmpeg.load({ coreURL, wasmURL, workerURL, classWorkerURL: `${workerBaseUrl}/worker.js` });

    // Configure progress handler if needed
    const fps = 20; // Using default fps from color generator
    const videoDuration = metadata.duration || 300; // Default to 5 minutes, could be calculated from metadata
    if (onProgress) {
        ffmpeg.on('log', getProgressParser(fps, videoDuration, onProgress));
    }

    // Write audio to ffmpeg filesystem
    await ffmpeg.writeFile(
        songFileName,
        await fetchFile(accompanimentDataUrl)
    );

    // Write the subtitle font to the filesystem
    await ffmpeg.writeFile(
        `/tmp/${videoOptions.font.name}.ttf`,
        await fetchFile(fontMap[videoOptions.font.name])
    );

    await ffmpeg.writeFile("subtitles.ass", subtitles);

    if (videoBlob) {
        await ffmpeg.writeFile(
            "video.mp4",
            await fetchFile(videoBlob)
        );
    }

    const ffmpegParams = getFfmpegParams(Boolean(videoBlob), backgroundColor, audioDelayMs, metadata);
    await ffmpeg.exec(ffmpegParams);

    const videoData = (await ffmpeg.readFile("karaoke.mp4")) as Uint8Array;
    return videoData;
}

interface DownloadPollResponse {
    finishedDownloadURL: string;
}

async function pollForVideoResult(url: string): Promise<Blob> {
    const POLL_INTERVAL = 10000; // 10 seconds
    while (true) {
        let response: Response;
        try {
            response = await fetch(url, {
                cache: 'no-cache'
            });
        } catch (error) {
            console.error('pollForVideoResult fetch failed:', {
                url,
                error: error.message,
                errorType: error.constructor.name,
                stack: error.stack
            });
            throw error;
        }

        // For video downloads, a 404 means it's still processing
        if (response.status === 404) {
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
            continue;
        }

        if (response.status !== 200) {
            const errMsg = await response.text();
            throw new ApiError(url, errMsg, response.status);
        }

        return await response.blob();
    }
}

export async function fetchYouTubeVideo(url: string): Promise<[Blob, Blob, Object]> {
    const apiPath = "/download_video?url=" + url;
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
    const [audio, video, metadata] = await Promise.all([
        zip.file("audio.mp4").async("blob"),
        zip.file("video.mp4").async("blob"),
        zip.file("metadata.json").async("string").then(md => JSON.parse(md))
    ]);

    // TODO return blob URLs instead
    return [audio, video, metadata];
}

// Parse a YouTube video title into song artist and title
export function parseYouTubeTitle(videoMetadata: any): [string, string] {
    if (videoMetadata.author && videoMetadata.title) {
        return [videoMetadata.author, videoMetadata.title];
    }
    return ['', videoMetadata.title];
}

function ffmpegMetadataArgs(metadata: VideoMetadata): string[] {
    let ffmpegArgs = []
    if (metadata.artist) {
        ffmpegArgs.push('-metadata', `artist=${metadata.artist}`);
    }
    if (metadata.title) {
        ffmpegArgs.push('-metadata', `title=${metadata.title}`);
    }
    ffmpegArgs.push('-metadata', `description=Karaoke version created by the-tuul.com`);
    return ffmpegArgs;
}

export default { createVideo, fetchYouTubeVideo, parseYouTubeTitle, getProgressParser };