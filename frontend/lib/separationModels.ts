import { SeparationBackend, SeparationModel, SeparationModelId } from "@/types";

// The catalogue of separation models the app offers. Each entry declares
// whether it runs in the browser (web-audio-separation) or on the server.

export const BACKING_VOCALS_SEPARATOR_MODEL: SeparationModel = {
    id: "UVR_MDXNET_KARA_2.onnx",
    label: "Keep backing vocals",
    backend: SeparationBackend.Local,
    localModelName: "UVR_MDXNET_KARA_2",
    keepsBackingVocals: true,
};

export const NO_VOCALS_SEPARATOR_MODEL: SeparationModel = {
    id: "UVR-MDX-NET-Inst_HQ_3.onnx",
    label: "Remove all vocals",
    backend: SeparationBackend.Remote,
    keepsBackingVocals: false,
};

export const SEPARATION_MODELS: readonly SeparationModel[] = [
    BACKING_VOCALS_SEPARATOR_MODEL,
    NO_VOCALS_SEPARATOR_MODEL,
];

export function findSeparationModel(id: SeparationModelId): SeparationModel {
    const model = SEPARATION_MODELS.find((candidate) => candidate.id === id);
    if (!model) {
        throw new Error(`Unknown separation model: ${id}`);
    }
    return model;
}
