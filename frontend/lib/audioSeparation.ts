import jszip from "jszip";
import { API_HOSTNAME } from "@/constants";
import { SeparationBackend, SeparationModel, SeparationProgressCallback } from "@/types";
import { LocalSeparationRunner, mainThreadRunner } from "./localSeparation";

// Splitting a song into a backing track and a vocals track, either on the
// server or in the browser depending on the model.

export interface TrackSeparationResult {
    backing: Blob; // Blob of backing track
    vocals: Blob; // Blob of vocals track
}

interface PollResponse {
    finishedTrackURL: string;
}

async function pollForResult(url: string): Promise<Blob> {
    while (true) {
        try {
            const response = await fetch(url, {
                cache: 'no-cache'
            });
            const contentType = response.headers.get("content-type");

            if (contentType?.includes("application/json")) {
                await new Promise(resolve => setTimeout(resolve, 30000));
                continue;
            }

            return await response.blob();
        } catch (error) {
            console.error(`Failed to fetch audio separation result from URL: ${url}`, error);
            throw error;
        }
    }
}

async function processZipResponse(zipBlob: Blob): Promise<TrackSeparationResult> {
    console.log("Received separated audio. Unzipping...");
    const zip = await jszip.loadAsync(zipBlob);
    const accompaniment = await zip.file("accompaniment.wav").async("blob").then((blob) => {
        return new Blob([blob], { type: "audio/wav" });
    });

    const vocals = await zip.file("vocals.wav").async("blob").then((blob) => {
        return new Blob([blob], { type: "audio/wav" });
    });

    return { backing: accompaniment, vocals: vocals };
}

/** Separate on the server via POST /separate_track. Reports no progress. */
export async function separateTrackRemotely(songFile: File, model: SeparationModel): Promise<TrackSeparationResult> {
    const formData = new FormData();
    formData.append("songFile", songFile);
    formData.append("modelName", model.id);
    const url = `${API_HOSTNAME}/separate_track`;

    try {
        const response = await fetch(url, {
            method: "POST",
            body: formData,
        });

        const contentType = response.headers.get("content-type");

        // The endpoint can return either a JSON response with a URL to poll for results or a direct ZIP file response
        if (contentType?.includes("application/json")) {
            const jsonResponse: PollResponse = await response.json();
            const zipBlob = await pollForResult(jsonResponse.finishedTrackURL);
            return await processZipResponse(zipBlob);
        } else {
            const zipBlob = await response.blob();
            return await processZipResponse(zipBlob);
        }
    } catch (error) {
        console.error(`Failed to fetch from separateTrack URL: ${url}`, error);
        throw error;
    }
}

/** Separate in the browser with web-audio-separation. */
export async function separateTrackLocally(
    songFile: File,
    model: SeparationModel,
    onProgress?: SeparationProgressCallback,
    runner: LocalSeparationRunner = mainThreadRunner
): Promise<TrackSeparationResult> {
    if (!model.localModelName) {
        throw new Error(`Separation model ${model.id} is not available in the browser`);
    }
    return runner.run({ songFile, localModelName: model.localModelName }, onProgress);
}

/** Separate wherever the model says it runs. */
export async function separateTrack(
    songFile: File,
    model: SeparationModel,
    onProgress?: SeparationProgressCallback
): Promise<TrackSeparationResult> {
    switch (model.backend) {
        case SeparationBackend.Local:
            return separateTrackLocally(songFile, model, onProgress);
        case SeparationBackend.Remote:
            return separateTrackRemotely(songFile, model);
        default: {
            const unhandled: never = model.backend;
            throw new Error(`Unknown separation backend: ${unhandled}`);
        }
    }
}

export default { separateTrack }
