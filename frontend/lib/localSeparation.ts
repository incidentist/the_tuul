// In-browser separation via web-audio-separation.
//
// The engine (`runLocalSeparation`) speaks a small message protocol so that it
// can later move into a Web Worker unchanged: a worker script would be
// `onmessage = (e) => runLocalSeparation(e.data, postMessage)`, and a
// `workerRunner` would implement `LocalSeparationRunner` by posting the
// request and forwarding the events. Today the library needs the main thread
// (it uses OfflineAudioContext and window), so only `mainThreadRunner` exists.
import { createSeparator, MODEL_REGISTRY, RegisteredModelName, SeparationStage } from "web-audio-separation";
import type { SeparationProgress as LibraryProgress } from "web-audio-separation";
import { SeparationPhase, SeparationProgress, SeparationProgressCallback } from "@/types";
import type { TrackSeparationResult } from "./audioSeparation";

// Structured-clone-safe request: exactly what a worker would receive.
export interface LocalSeparationRequest {
    songFile: File;
    localModelName: RegisteredModelName;
}

// Structured-clone-safe events: exactly what a worker would post back.
export type LocalSeparationEvent =
    | { type: "progress"; progress: SeparationProgress }
    | { type: "result"; backing: Blob; vocals: Blob }
    | { type: "error"; message: string };

export interface LocalSeparationRunner {
    run(request: LocalSeparationRequest, onProgress?: SeparationProgressCallback): Promise<TrackSeparationResult>;
}

type PrimaryStem = "Vocals" | "Instrumental";

/**
 * web-audio-separation returns stem URLs as [secondary, primary]. Which of
 * those is the backing track depends on the model's primary stem.
 */
export function stemUrlsToResult(urls: string[], primaryStem: PrimaryStem): { backingUrl: string; vocalsUrl: string } {
    if (urls.length !== 2) {
        throw new Error(`Expected two separated stems, got ${urls.length}`);
    }
    const [secondaryUrl, primaryUrl] = urls;
    if (primaryStem === "Instrumental") {
        return { backingUrl: primaryUrl, vocalsUrl: secondaryUrl };
    }
    return { backingUrl: secondaryUrl, vocalsUrl: primaryUrl };
}

const LIBRARY_STAGES: Record<SeparationStage, SeparationPhase> = {
    [SeparationStage.LoadingModel]: SeparationPhase.LoadingModel,
    [SeparationStage.Demixing]: SeparationPhase.Separating,
    [SeparationStage.WritingOutput]: SeparationPhase.WritingOutput,
};

export function toAppProgress(progress: LibraryProgress): SeparationProgress {
    return { phase: LIBRARY_STAGES[progress.stage], fraction: progress.fraction };
}

async function wavBlobFromUrl(url: string): Promise<Blob> {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Blob([blob], { type: "audio/wav" });
}

/**
 * Separate a song in the browser, reporting progress, the result, or an error
 * through `emit`. Never throws: failures are emitted as an error event.
 */
export async function runLocalSeparation(
    request: LocalSeparationRequest,
    emit: (event: LocalSeparationEvent) => void
): Promise<void> {
    let inputUrl: string | null = null;
    const stemUrls: string[] = [];

    try {
        const separator = createSeparator(request.localModelName, {
            common: {
                logLevel: "warning",
                onProgress: (progress) => emit({ type: "progress", progress: toAppProgress(progress) }),
            },
        });

        await separator.loadModel();

        inputUrl = URL.createObjectURL(request.songFile);
        stemUrls.push(...(await separator.separate(inputUrl)));

        const primaryStem = MODEL_REGISTRY[request.localModelName].modelData.primary_stem;
        const { backingUrl, vocalsUrl } = stemUrlsToResult(stemUrls, primaryStem);
        const [backing, vocals] = await Promise.all([wavBlobFromUrl(backingUrl), wavBlobFromUrl(vocalsUrl)]);

        emit({ type: "result", backing, vocals });
    } catch (error) {
        emit({ type: "error", message: (error as Error)?.message ?? String(error) });
    } finally {
        if (inputUrl) {
            URL.revokeObjectURL(inputUrl);
        }
        stemUrls.forEach((url) => URL.revokeObjectURL(url));
    }
}

export const mainThreadRunner: LocalSeparationRunner = {
    run(request, onProgress) {
        return new Promise<TrackSeparationResult>((resolve, reject) => {
            runLocalSeparation(request, (event) => {
                switch (event.type) {
                    case "progress":
                        onProgress?.(event.progress);
                        break;
                    case "result":
                        resolve({ backing: event.backing, vocals: event.vocals });
                        break;
                    case "error":
                        reject(new Error(event.message));
                        break;
                }
            });
        });
    },
};
