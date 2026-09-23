import { describe, expect, it } from 'vitest';
import { MODEL_REGISTRY } from 'web-audio-separation';
import {
    BACKING_VOCALS_SEPARATOR_MODEL,
    NO_VOCALS_SEPARATOR_MODEL,
    SEPARATION_MODELS,
    findSeparationModel,
} from './separationModels';
import { SeparationModelId } from '@/types';

describe('separationModels', () => {
    it('names a backing-vocals model', () => {
        expect(BACKING_VOCALS_SEPARATOR_MODEL.keepsBackingVocals).toBe(true);
    });

    it('names a no-vocals model', () => {
        expect(NO_VOCALS_SEPARATOR_MODEL.keepsBackingVocals).toBe(false);
    });

    it('names a model web-audio-separation actually ships for every model', () => {
        expect(SEPARATION_MODELS.length).toBeGreaterThan(0);
        for (const model of SEPARATION_MODELS) {
            expect(model.modelName).toBeDefined();
            expect(MODEL_REGISTRY).toHaveProperty(model.modelName);
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
