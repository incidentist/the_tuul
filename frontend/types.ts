export enum CreationPhase {
    NotStarted,
    SeparatingVocals,
    CreatingVideo,
}

export type SeparationModel = "UVR_MDXNET_KARA_2.onnx" | "model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt";