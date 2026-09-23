import { SeparationModel, SeparationModelId } from "@/types";

// The catalogue of separation models the app offers. Whether a given
// separation runs in the browser or on the server is decided at dispatch time
// by chooseSeparationMethod (see lib/audioSeparation.ts), not per model.

export const BACKING_VOCALS_SEPARATOR_MODEL: SeparationModel = {
    id: "UVR_MDXNET_KARA_2.onnx",
    label: "Keep backing vocals",
    modelName: "UVR_MDXNET_KARA_2",
    keepsBackingVocals: true,
};

export const NO_VOCALS_SEPARATOR_MODEL: SeparationModel = {
    id: "UVR-MDX-NET-Inst_HQ_3.onnx",
    label: "Remove all vocals",
    modelName: "UVR-MDX-NET-Inst_HQ_3",
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
