import jszip from "jszip";
import { API_HOSTNAME, USE_REMOTE_SEPARATION } from "@/constants";
import { SeparationModel, SeparationProgressCallback } from "@/types";
import { isMobile } from "./device";
import { LocalSeparationRunner, mainThreadRunner } from "./localSeparation";
import { createSeparationTimer, logLocalSeparation, Outcome } from "./telemetry";

// Splitting a song into a backing track and a vocals track, either on the
// server or in the browser depending on the device and deployment.

export interface TrackSeparationResult {
    backing: Blob; // Blob of backing track
    vocals: Blob; // Blob of vocals track
}

interface PollResponse {
    finishedTrackURL: string;
}

/** The JSON placeholder the server keeps at the poll URL until the zip is ready. */
interface SeparationPlaceholder {
    status: "processing" | "failed";
    error?: string;
}

async function pollForResult(url: string): Promise<Blob> {
    while (true) {
        try {
            const response = await fetch(url, {
                cache: 'no-cache'
            });
            if (!response.ok) {
                throw new Error(`Separation result request failed with status ${response.status}`);
            }
            const contentType = response.headers.get("content-type");

            if (contentType?.includes("application/json")) {
                const placeholder: SeparationPlaceholder = await response.json();
                if (placeholder.status === "failed") {
                    throw new Error(placeholder.error ?? "Separation failed on the server.");
                }
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
        if (!response.ok) {
            // e.g. 503 when the server's separation queue is full
            throw new Error(`Separation request failed with status ${response.status}`);
        }

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

/** Separate in the browser with web-audio-separation, logging how long it took. */
export async function separateTrackLocally(
    songFile: File,
    model: SeparationModel,
    onProgress?: SeparationProgressCallback,
    runner: LocalSeparationRunner = mainThreadRunner
): Promise<TrackSeparationResult> {
    const timer = createSeparationTimer(onProgress);
    let outcome: Outcome = "failed";
    let error: string | undefined;
    try {
        const result = await runner.run({ songFile, localModelName: model.modelName }, timer.onProgress);
        outcome = "succeeded";
        return result;
    } catch (e) {
        error = (e as Error)?.message ?? String(e);
        throw e;
    } finally {
        void logLocalSeparation({ outcome, error, model, songFile, timing: timer.finish() });
    }
}

/** Where a separation runs. */
export enum SeparationMethod {
    /** On the server, via POST /separate_track. */
    Api = "api",
    /** In the browser, via web-audio-separation. */
    Local = "local",
}

/**
 * In-browser separation is too heavy for phones, tablets and small (likely
 * old) computers, so those always use the API, as does any deployment that
 * sets USE_REMOTE_SEPARATION.
 */
export function chooseSeparationMethod(): SeparationMethod {
    if (USE_REMOTE_SEPARATION || isMobile()) {
        return SeparationMethod.Api;
    }
    return SeparationMethod.Local;
}

export async function separateTrack(
    songFile: File,
    model: SeparationModel,
    onProgress?: SeparationProgressCallback
): Promise<TrackSeparationResult> {
    const method = chooseSeparationMethod();
    switch (method) {
        case SeparationMethod.Api:
            return separateTrackRemotely(songFile, model);
        case SeparationMethod.Local:
            return separateTrackLocally(songFile, model, onProgress);
        default: {
            const unhandled: never = method;
            throw new Error(`Unknown separation method: ${unhandled}`);
        }
    }
}

export default { separateTrack }
