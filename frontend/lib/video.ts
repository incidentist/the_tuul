import { createFFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { KaraokeOptions } from "@/lib/timing";
import jszip from "jszip";
// Functions related to video file creation

async function createVideo(
    accompanimentDataUrl: string,
    subtitles: string,
    audioDelay: number = 0,
    videoOptions: KaraokeOptions,
    fontMap: Record<string, string>
): Promise<Uint8Array> {
    // Create the video using ffmpeg.wasm v0.11
    const songFileName = "stuff.mp3";
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
    await ffmpeg.run(
        "-f",
        "lavfi",
        "-i",
        `color=c=${backgroundColor}:s=1280x720:r=20`,
        "-i",
        songFileName,
        // Set audio delay if needed
        // https://ffmpeg.org/ffmpeg-filters.html#adelay
        "-af",
        `adelay=delays=${audioDelayMs}:all=1`,
        // Add subtitles
        "-vf",
        "ass=subtitles.ass:fontsdir=/tmp",
        "-shortest",
        "-y",
        "karaoke.mp4"
    );
    const video = await ffmpeg.FS("readFile", "karaoke.mp4");
    return video;
}

export async function fetchYouTubeVideo(url: string): Promise<[Blob, Blob, string]> {
    const apiPath = "/download_video?url=" + url;
    const response = await fetch(apiPath);
    const zipContents = await response.blob();
    const zip = await jszip.loadAsync(zipContents);
    const [audio, video, metadata] = await Promise.all([
        zip.file("audio.mp4").async("blob"),
        zip.file("video.mp4").async("blob"),
        zip.file("metadata.txt").async("string")
    ]);

    // TODO return blob URLs instead
    return [audio, video, metadata];
}

export default { createVideo, fetchYouTubeVideo }