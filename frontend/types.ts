import type { RegisteredModelName } from "web-audio-separation";

export enum CreationPhase {
    NotStarted,
    SeparatingVocals,
    CreatingVideo,
}

/**
 * The model name the backend accepts (see AVAILABLE_MODELS in
 * api/karaoke/music_separation.py). This is the wire and storage format;
 * everywhere else, pass a SeparationModel around instead.
 */
export type SeparationModelId = "UVR_MDXNET_KARA_2.onnx" | "UVR-MDX-NET-Inst_HQ_3.onnx";

/** Where a separation model runs. */
export enum SeparationBackend {
    /** In the browser, via web-audio-separation. */
    Local = "local",
    /** On the server, via POST /separate_track. */
    Remote = "remote",
}

export interface SeparationModel {
    id: SeparationModelId;
    label: string;
    backend: SeparationBackend;
    /** The web-audio-separation registry key. Required when backend is Local. */
    localModelName?: RegisteredModelName;
    keepsBackingVocals: boolean;
}

export enum SeparationPhase {
    LoadingModel = "loading-model",
    Separating = "separating",
    WritingOutput = "writing-output",
}

export interface SeparationProgress {
    phase: SeparationPhase;
    /** 0 to 1, or null when the phase's progress is unknown (indeterminate). */
    fraction: number | null;
}

export type SeparationProgressCallback = (progress: SeparationProgress) => void;
