// Timing reports for in-browser separation, so we can see how long it takes
// on real users' machines and what makes it slow.
import { SeparationModel, SeparationPhase, SeparationProgressCallback } from "@/types";
import { useMediaStore } from "@/stores/media";
import { logInfo } from "./util";

export const LOCAL_SEPARATION_LOG_TAG = "performance:local-separation";

export type SeparationOutcome = "succeeded" | "failed";

function toSeconds(ms: number): number {
    return Math.round(ms) / 1000;
}

/**
 * Times a separation and each phase it reports through progress events.
 * Wrap the caller's progress callback with `onProgress`, then call `finish`.
 */
export function createSeparationTimer(onProgress?: SeparationProgressCallback, now = () => performance.now()) {
    const start = now();
    const phaseSeconds: Partial<Record<SeparationPhase, number>> = {};
    let currentPhase: SeparationPhase | null = null;
    let phaseStart = start;
    // Browsers throttle background tabs, which skews the timing
    let wasHidden = document.hidden;
    const noteVisibility = () => {
        wasHidden ||= document.hidden;
    };
    document.addEventListener("visibilitychange", noteVisibility);

    function endCurrentPhase(at: number) {
        if (currentPhase) {
            phaseSeconds[currentPhase] = toSeconds(at - phaseStart);
        }
    }

    return {
        onProgress: ((progress) => {
            if (progress.phase !== currentPhase) {
                const at = now();
                endCurrentPhase(at);
                currentPhase = progress.phase;
                phaseStart = at;
            }
            onProgress?.(progress);
        }) as SeparationProgressCallback,

        finish() {
            const end = now();
            endCurrentPhase(end);
            document.removeEventListener("visibilitychange", noteVisibility);
            return { durationSeconds: toSeconds(end - start), phaseSeconds, wasHidden };
        },
    };
}

/**
 * The GPU web-audio-separation would run on. Null means no WebGPU, so it fell
 * back to wasm on the CPU.
 */
async function describeGpu(): Promise<Record<string, string> | null> {
    try {
        const adapter = await (navigator as any).gpu?.requestAdapter();
        if (!adapter) {
            return null;
        }
        const { vendor, architecture, device, description } = adapter.info ?? {};
        return { vendor, architecture, device, description };
    } catch {
        return null;
    }
}

/** OS and hardware details. Most of these are only available in Chromium. */
async function describeMachine(): Promise<Record<string, unknown>> {
    const nav = navigator as any;
    let platform: Record<string, unknown> | null = null;
    try {
        platform = await nav.userAgentData?.getHighEntropyValues(
            ["platform", "platformVersion", "architecture", "bitness", "model"]
        ) ?? null;
    } catch {
        platform = null;
    }
    const heap = (performance as any).memory;
    return {
        platform,
        cpuCores: nav.hardwareConcurrency ?? null,
        // Rounded down to a power of two and capped at 8 GB by the browser
        deviceMemoryGB: nav.deviceMemory ?? null,
        jsHeap: heap ? { usedMB: Math.round(heap.usedJSHeapSize / 2 ** 20), limitMB: Math.round(heap.jsHeapSizeLimit / 2 ** 20) } : null,
        gpu: await describeGpu(),
        // Without cross-origin isolation, wasm inference runs single-threaded
        crossOriginIsolated: self.crossOriginIsolated ?? false,
    };
}

export interface LocalSeparationReport {
    outcome: SeparationOutcome;
    error?: string;
    model: SeparationModel;
    songFile: File;
    timing: ReturnType<ReturnType<typeof createSeparationTimer>["finish"]>;
}

/** Never throws: a failure to report must not fail the separation. */
export async function logLocalSeparation({ outcome, error, model, songFile, timing }: LocalSeparationReport) {
    const { durationSeconds } = timing;
    const songDurationSeconds = useMediaStore().songDuration;
    let machine: Record<string, unknown> | null = null;
    try {
        machine = await describeMachine();
    } catch {
        machine = null;
    }
    logInfo(LOCAL_SEPARATION_LOG_TAG, `Local separation ${outcome} in ${durationSeconds}s`, {
        outcome,
        error,
        ...timing,
        songDurationSeconds,
        // Seconds of processing per second of audio; lower is faster
        secondsPerSongSecond: songDurationSeconds ? Math.round((durationSeconds / songDurationSeconds) * 1000) / 1000 : null,
        model: { id: model.id, modelName: model.modelName },
        songFile: { sizeBytes: songFile.size, type: songFile.type },
        machine,
    });
}
