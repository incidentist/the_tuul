import { createFFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { KaraokeOptions } from "@/lib/timing";
import jszip from "jszip";
// Functions related to video file creation

function getFfmpegParams(hasVideo: boolean, backgroundColor: string, audioDelayMs: number, metadata: Object) {
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
        ...videoMetadata,
        "karaoke.mp4"
    ]
}

async function createVideo(
    accompanimentDataUrl: string,
    videoBlob: Blob = null,
    subtitles: string,
    audioDelay: number = 0,
    videoOptions: KaraokeOptions,
    metadata: Object,
    fontMap: Record<string, string>
): Promise<Uint8Array> {
    // Create the video using ffmpeg.wasm v0.11
    const songFileName = "audio.mp4";
    const backgroundColor =
        "0x" + videoOptions.color.background.toString().substring(1);
    const audioDelayMs = audioDelay * 1000;
    const ffmpeg = createFFmpeg({ log: true });
    await ffmpeg.load();
    // Write audio to ffmpeg-wasm's filesystem
    await ffmpeg.FS(
        "writeFile",
        songFileName,
        new Uint8Array(await fetchFile(accompanimentDataUrl))
    );
    // Write the subtitle font to the filesystem
    await ffmpeg.FS(
        "writeFile",
        `/tmp/${videoOptions.font.name}.ttf`,
        await fetchFile(fontMap[videoOptions.font.name])
    );
    await ffmpeg.FS("writeFile", "subtitles.ass", subtitles);
    if (videoBlob) {
        await ffmpeg.FS(
            "writeFile",
            "video.mp4",
            new Uint8Array(await videoBlob.arrayBuffer())
        );
    }
    const ffmpegParams = getFfmpegParams(Boolean(videoBlob), backgroundColor, audioDelayMs, metadata);
    await ffmpeg.run(
        ...ffmpegParams
    );
    const video = await ffmpeg.FS("readFile", "karaoke.mp4");
    return video;
}

export async function fetchYouTubeVideo(url: string): Promise<[Blob, Blob, Object]> {
    const apiPath = "/download_video?url=" + url;
    const response = await fetch(apiPath);
    const zipContents = await response.blob();
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

function ffmpegMetadataArgs(metadata: any) {
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

export default { createVideo, fetchYouTubeVideo, parseYouTubeTitle }