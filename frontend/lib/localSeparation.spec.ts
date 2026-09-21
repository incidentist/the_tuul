import { beforeEach, describe, expect, it, vi } from 'vitest';

// web-audio-separation downloads models and runs ONNX inference, so stand in
// for it entirely. The registry entries mirror the real ones' primary stems.
vi.mock('web-audio-separation', () => ({
    createSeparator: vi.fn(),
    MODEL_REGISTRY: {
        UVR_MDXNET_KARA_2: { modelData: { primary_stem: 'Instrumental' } },
        Kim_Vocal_2: { modelData: { primary_stem: 'Vocals' } },
    },
    SeparationStage: {
        LoadingModel: 'loading-model',
        Demixing: 'demixing',
        WritingOutput: 'writing-output',
    },
}));

import { createSeparator, SeparationStage } from 'web-audio-separation';
import {
    LocalSeparationEvent,
    mainThreadRunner,
    runLocalSeparation,
    stemUrlsToResult,
    toAppProgress,
} from './localSeparation';
import { SeparationPhase } from '@/types';

const VOCALS_URL = 'blob:vocals';
const INSTRUMENTAL_URL = 'blob:instrumental';

function fakeSeparator(overrides: Partial<{ loadModel: () => Promise<void>; separate: () => Promise<string[]> }> = {}) {
    return {
        loadModel: vi.fn().mockResolvedValue(undefined),
        // KARA_2's primary stem is Instrumental, so the library returns [vocals, instrumental]
        separate: vi.fn().mockResolvedValue([VOCALS_URL, INSTRUMENTAL_URL]),
        ...overrides,
    };
}

// Captures the onProgress callback passed to createSeparator so tests can
// simulate the library reporting progress mid-separation.
function fakeSeparatorCapturingProgress(overrides: Parameters<typeof fakeSeparator>[0] = {}) {
    const separator = fakeSeparator(overrides);
    vi.mocked(createSeparator).mockImplementation((_name, config) => {
        config?.common?.onProgress?.({ stage: SeparationStage.LoadingModel, fraction: 0.5 });
        config?.common?.onProgress?.({ stage: SeparationStage.Demixing, fraction: 0.5, chunk: 1, totalChunks: 2 });
        return separator as any;
    });
    return separator;
}

const songFile = new File(['song'], 'song.mp3', { type: 'audio/mpeg' });
const request = { songFile, localModelName: 'UVR_MDXNET_KARA_2' as const };

describe('localSeparation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // happy-dom has no blob URLs; fetch of a stem URL yields a blob named after it
        URL.createObjectURL = vi.fn().mockReturnValue('blob:input');
        URL.revokeObjectURL = vi.fn();
        global.fetch = vi.fn(async (url: string) => ({
            blob: async () => new Blob([`payload of ${url}`], { type: 'application/octet-stream' }),
        })) as any;
    });

    describe('stemUrlsToResult', () => {
        it('takes the primary stem as the backing track for instrumental-primary models', () => {
            expect(stemUrlsToResult(['secondary', 'primary'], 'Instrumental')).toEqual({
                backingUrl: 'primary',
                vocalsUrl: 'secondary',
            });
        });

        it('takes the secondary stem as the backing track for vocals-primary models', () => {
            expect(stemUrlsToResult(['secondary', 'primary'], 'Vocals')).toEqual({
                backingUrl: 'secondary',
                vocalsUrl: 'primary',
            });
        });

        it('rejects anything other than two stems', () => {
            expect(() => stemUrlsToResult(['only'], 'Vocals')).toThrow(/two separated stems/);
        });
    });

    describe('toAppProgress', () => {
        it('maps library stages onto app phases and keeps the fraction', () => {
            expect(toAppProgress({ stage: SeparationStage.LoadingModel, fraction: 0.25 })).toEqual({
                phase: SeparationPhase.LoadingModel,
                fraction: 0.25,
            });
            expect(toAppProgress({ stage: SeparationStage.Demixing, fraction: 0.5 })).toEqual({
                phase: SeparationPhase.Separating,
                fraction: 0.5,
            });
            expect(toAppProgress({ stage: SeparationStage.WritingOutput, fraction: 1 })).toEqual({
                phase: SeparationPhase.WritingOutput,
                fraction: 1,
            });
        });
    });

    describe('runLocalSeparation', () => {
        it('forwards progress from the library and then emits the wav stems', async () => {
            const separator = fakeSeparatorCapturingProgress();
            const events: LocalSeparationEvent[] = [];

            await runLocalSeparation(request, (event) => events.push(event));

            expect(createSeparator).toHaveBeenCalledWith('UVR_MDXNET_KARA_2', expect.anything());
            expect(separator.separate).toHaveBeenCalledWith('blob:input');
            expect(events.map((event) => event.type)).toEqual(['progress', 'progress', 'result']);
            expect(events[0]).toEqual({
                type: 'progress',
                progress: { phase: SeparationPhase.LoadingModel, fraction: 0.5 },
            });
            expect(events[1]).toEqual({
                type: 'progress',
                progress: { phase: SeparationPhase.Separating, fraction: 0.5 },
            });

            const result = events[2] as Extract<LocalSeparationEvent, { type: 'result' }>;
            expect(result.backing.type).toBe('audio/wav');
            expect(result.vocals.type).toBe('audio/wav');
            expect(await result.backing.text()).toBe(`payload of ${INSTRUMENTAL_URL}`);
            expect(await result.vocals.text()).toBe(`payload of ${VOCALS_URL}`);
        });

        it('honours a vocals-primary model when picking the backing stem', async () => {
            vi.mocked(createSeparator).mockReturnValue(
                fakeSeparator({ separate: vi.fn().mockResolvedValue([INSTRUMENTAL_URL, VOCALS_URL]) }) as any
            );
            const events: LocalSeparationEvent[] = [];

            await runLocalSeparation({ songFile, localModelName: 'Kim_Vocal_2' }, (event) => events.push(event));

            const result = events.at(-1) as Extract<LocalSeparationEvent, { type: 'result' }>;
            expect(await result.backing.text()).toBe(`payload of ${INSTRUMENTAL_URL}`);
            expect(await result.vocals.text()).toBe(`payload of ${VOCALS_URL}`);
        });

        it('revokes the input and stem object URLs when done', async () => {
            vi.mocked(createSeparator).mockReturnValue(fakeSeparator() as any);

            await runLocalSeparation(request, () => { });

            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:input');
            expect(URL.revokeObjectURL).toHaveBeenCalledWith(VOCALS_URL);
            expect(URL.revokeObjectURL).toHaveBeenCalledWith(INSTRUMENTAL_URL);
        });

        it('emits an error event instead of throwing when the library fails', async () => {
            vi.mocked(createSeparator).mockReturnValue(
                fakeSeparator({ separate: vi.fn().mockRejectedValue(new Error('no WebGPU for you')) }) as any
            );
            const events: LocalSeparationEvent[] = [];

            await expect(runLocalSeparation(request, (event) => events.push(event))).resolves.toBeUndefined();

            expect(events.at(-1)).toEqual({ type: 'error', message: 'no WebGPU for you' });
            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:input');
        });
    });

    describe('mainThreadRunner', () => {
        it('resolves with the result and forwards progress', async () => {
            fakeSeparatorCapturingProgress();
            const onProgress = vi.fn();

            const result = await mainThreadRunner.run(request, onProgress);

            expect(result.backing).toBeInstanceOf(Blob);
            expect(result.vocals).toBeInstanceOf(Blob);
            expect(onProgress).toHaveBeenCalledTimes(2);
            expect(onProgress).toHaveBeenLastCalledWith({ phase: SeparationPhase.Separating, fraction: 0.5 });
        });

        it('rejects when the engine reports an error', async () => {
            vi.mocked(createSeparator).mockReturnValue(
                fakeSeparator({ loadModel: vi.fn().mockRejectedValue(new Error('download blocked')) }) as any
            );

            await expect(mainThreadRunner.run(request)).rejects.toThrow('download blocked');
        });
    });
});
