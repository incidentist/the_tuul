import { describe, expect, it } from 'vitest';
import { MODEL_REGISTRY } from 'web-audio-separation';
import {
    BACKING_VOCALS_SEPARATOR_MODEL,
    NO_VOCALS_SEPARATOR_MODEL,
    SEPARATION_MODELS,
    findSeparationModel,
} from './separationModels';
import { SeparationBackend, SeparationModelId } from '@/types';

describe('separationModels', () => {
    it('runs the backing-vocals model in the browser', () => {
        expect(BACKING_VOCALS_SEPARATOR_MODEL.backend).toBe(SeparationBackend.Local);
        expect(BACKING_VOCALS_SEPARATOR_MODEL.keepsBackingVocals).toBe(true);
    });

    it('runs the no-vocals model on the server', () => {
        expect(NO_VOCALS_SEPARATOR_MODEL.backend).toBe(SeparationBackend.Remote);
        expect(NO_VOCALS_SEPARATOR_MODEL.keepsBackingVocals).toBe(false);
    });

    it('names a model web-audio-separation actually ships for every local model', () => {
        const localModels = SEPARATION_MODELS.filter((model) => model.backend === SeparationBackend.Local);
        expect(localModels.length).toBeGreaterThan(0);
        for (const model of localModels) {
            expect(model.localModelName).toBeDefined();
            expect(MODEL_REGISTRY).toHaveProperty(model.localModelName!);
        }
    });

    it('finds a model by its backend id', () => {
        expect(findSeparationModel('UVR_MDXNET_KARA_2.onnx')).toBe(BACKING_VOCALS_SEPARATOR_MODEL);
        expect(findSeparationModel('UVR-MDX-NET-Inst_HQ_3.onnx')).toBe(NO_VOCALS_SEPARATOR_MODEL);
    });

    it('rejects an unknown id', () => {
        expect(() => findSeparationModel('nope.onnx' as SeparationModelId)).toThrow(/Unknown separation model/);
    });
});
