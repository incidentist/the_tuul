// Timing reports for slow in-browser work (separation, video creation), so we
// can see how long it takes on real users' machines and what makes it slow.
import { SeparationModel, SeparationPhase, SeparationProgressCallback } from "@/types";
import { useMediaStore } from "@/stores/media";
import { logInfo } from "./util";

export enum PerformanceLogTag {
    LocalSeparation = "performance:local-separation",
    VideoCreation = "performance:video-creation",
}

export type Outcome = "succeeded" | "failed";

function toSeconds(ms: number): number {
    return Math.round(ms) / 1000;
}

function roundTo3(n: number): number {
    return Math.round(n * 1000) / 1000;
}

/**
 * Times a piece of work and each phase of it. Call `startPhase` as each phase
 * begins (repeats of the current phase are ignored), then `finish`.
 */
export function createPhaseTimer<Phase extends string>(now = () => performance.now()) {
    const start = now();
    const phaseSeconds: Partial<Record<Phase, number>> = {};
    let currentPhase: Phase | null = null;
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
        startPhase(phase: Phase) {
            if (phase === currentPhase) {
                return;
            }
            const at = now();
            endCurrentPhase(at);
            currentPhase = phase;
            phaseStart = at;
        },

        finish() {
            const end = now();
            endCurrentPhase(end);
            document.removeEventListener("visibilitychange", noteVisibility);
            return { durationSeconds: toSeconds(end - start), phaseSeconds, wasHidden };
        },
    };
}

export type PhaseTiming = ReturnType<ReturnType<typeof createPhaseTimer>["finish"]>;

/** A phase timer driven by separation progress events, which it passes on to `onProgress`. */
export function createSeparationTimer(onProgress?: SeparationProgressCallback, now?: () => number) {
    const timer = createPhaseTimer<SeparationPhase>(now);
    return {
        onProgress: ((progress) => {
            timer.startPhase(progress.phase);
            onProgress?.(progress);
        }) as SeparationProgressCallback,
        finish: timer.finish,
    };
}

/**
 * The GPU WebGPU work would run on. Null means no WebGPU, so web-audio-separation
 * fell back to wasm on the CPU.
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
        // Without cross-origin isolation, wasm (inference and ffmpeg) runs single-threaded
        crossOriginIsolated: self.crossOriginIsolated ?? false,
    };
}

interface PerformanceReport {
    outcome: Outcome;
    error?: string;
    timing: PhaseTiming;
}

/** Never throws: a failure to report must not fail the work being reported. */
async function logPerformance(
    tag: PerformanceLogTag,
    what: string,
    { outcome, error, timing }: PerformanceReport,
    details: Record<string, unknown>
) {
    const songDurationSeconds = useMediaStore().songDuration;
    let machine: Record<string, unknown> | null = null;
    try {
        machine = await describeMachine();
    } catch {
        machine = null;
    }
    logInfo(tag, `${what} ${outcome} in ${timing.durationSeconds}s`, {
        outcome,
        error,
        ...timing,
        songDurationSeconds,
        // Seconds of processing per second of audio; lower is faster
        secondsPerSongSecond: songDurationSeconds ? roundTo3(timing.durationSeconds / songDurationSeconds) : null,
        ...details,
        machine,
    });
}

export interface LocalSeparationReport extends PerformanceReport {
    model: SeparationModel;
    songFile: File;
}

export function logLocalSeparation({ model, songFile, ...report }: LocalSeparationReport) {
    return logPerformance(PerformanceLogTag.LocalSeparation, "Local separation", report, {
        model: { id: model.id, modelName: model.modelName },
        songFile: { sizeBytes: songFile.size, type: songFile.type },
    });
}

export interface VideoCreationReport extends PerformanceReport {
    /** Size of the background video, or null when there is none. */
    backgroundVideoBytes: number | null;
    /** Seconds of title screens etc. added before the song starts. */
    audioDelaySeconds: number;
    /** Null when ffmpeg never ran. */
    ffmpegExitCode: number | null;
    outputBytes: number | null;
}

export function logVideoCreation(report: VideoCreationReport) {
    const { outcome, error, timing, ...details } = report;
    return logPerformance(PerformanceLogTag.VideoCreation, "Video creation", { outcome, error, timing }, {
        ...details,
        hasBackgroundVideo: details.backgroundVideoBytes !== null,
    });
}
