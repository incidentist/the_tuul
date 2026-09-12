import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The local runner drives web-audio-separation; stub it so dispatch tests
// never load a model.
vi.mock('./localSeparation', () => ({
    mainThreadRunner: { run: vi.fn() },
}));

import { separateTrack, separateTrackRemotely } from './audioSeparation';
import { mainThreadRunner } from './localSeparation';
import {
    BACKING_VOCALS_SEPARATOR_MODEL,
    NO_VOCALS_SEPARATOR_MODEL,
} from './separationModels';
import { SeparationBackend, SeparationModel, SeparationPhase } from '@/types';

// Mock fetch globally
global.fetch = vi.fn();

function mockZipResponse() {
    const mockZip = {
        file: vi.fn().mockReturnValue({
            async: vi.fn().mockResolvedValue(new Blob(['mock audio'], { type: 'audio/wav' }))
        })
    };
    return import('jszip').then((jszip) => {
        vi.spyOn(jszip.default, 'loadAsync').mockResolvedValue(mockZip as any);
    });
}

describe('separateTrackRemotely', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('handles zip response directly', async () => {
        const mockFile = new File(['audio data'], 'test.mp3', { type: 'audio/mp3' });
        const mockZipData = new ArrayBuffer(8);
        const mockBlob = new Blob([mockZipData], { type: 'application/zip' });

        // Mock the initial response as zip
        (fetch as any).mockResolvedValueOnce({
            headers: {
                get: vi.fn().mockReturnValue('application/zip')
            },
            blob: vi.fn().mockResolvedValue(mockBlob)
        });
        await mockZipResponse();

        const result = await separateTrackRemotely(mockFile, NO_VOCALS_SEPARATOR_MODEL);

        expect(result.backing).toBeInstanceOf(Blob);
        expect(result.vocals).toBeInstanceOf(Blob);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("sends the model's id as the modelName form field", async () => {
        const mockFile = new File(['audio data'], 'test.mp3', { type: 'audio/mp3' });
        (fetch as any).mockResolvedValueOnce({
            headers: { get: vi.fn().mockReturnValue('application/zip') },
            blob: vi.fn().mockResolvedValue(new Blob([new ArrayBuffer(8)], { type: 'application/zip' }))
        });
        await mockZipResponse();

        await separateTrackRemotely(mockFile, NO_VOCALS_SEPARATOR_MODEL);

        const [url, options] = (fetch as any).mock.calls[0];
        expect(url).toMatch(/\/separate_track$/);
        expect(options.method).toBe('POST');
        expect((options.body as FormData).get('modelName')).toBe(NO_VOCALS_SEPARATOR_MODEL.id);
    });

    it('handles JSON response with polling until zip is ready', async () => {
        const mockFile = new File(['audio data'], 'test.mp3', { type: 'audio/mp3' });
        const mockZipData = new ArrayBuffer(8);
        const mockZipBlob = new Blob([mockZipData], { type: 'application/zip' });

        // Mock the initial response as JSON
        (fetch as any).mockResolvedValueOnce({
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({
                finishedTrackURL: 'http://example.com/poll-url'
            })
        });

        // Mock polling responses: first JSON (still processing), then zip (finished)
        (fetch as any).mockResolvedValueOnce({
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            }
        });

        (fetch as any).mockResolvedValueOnce({
            headers: {
                get: vi.fn().mockReturnValue('application/zip')
            },
            blob: vi.fn().mockResolvedValue(mockZipBlob)
        });
        await mockZipResponse();

        // Start the operation
        const resultPromise = separateTrackRemotely(mockFile, NO_VOCALS_SEPARATOR_MODEL);

        // Fast-forward time to trigger the polling timeout
        await vi.advanceTimersByTimeAsync(30000);

        const result = await resultPromise;

        expect(result.backing).toBeInstanceOf(Blob);
        expect(result.vocals).toBeInstanceOf(Blob);
        expect(fetch).toHaveBeenCalledTimes(3); // Initial + 2 polls
        expect(fetch).toHaveBeenCalledWith('http://example.com/poll-url', {
            cache: 'no-cache'
        });
    });

    it('continues polling until zip response is received', async () => {
        const mockFile = new File(['audio data'], 'test.mp3', { type: 'audio/mp3' });
        const mockZipData = new ArrayBuffer(8);
        const mockZipBlob = new Blob([mockZipData], { type: 'application/zip' });

        // Mock the initial response as JSON
        (fetch as any).mockResolvedValueOnce({
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({
                finishedTrackURL: 'http://example.com/poll-url'
            })
        });

        // Mock multiple JSON responses before final zip
        (fetch as any).mockResolvedValueOnce({
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            }
        });

        (fetch as any).mockResolvedValueOnce({
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            }
        });

        (fetch as any).mockResolvedValueOnce({
            headers: {
                get: vi.fn().mockReturnValue('application/zip')
            },
            blob: vi.fn().mockResolvedValue(mockZipBlob)
        });
        await mockZipResponse();

        // Start the operation
        const resultPromise = separateTrackRemotely(mockFile, NO_VOCALS_SEPARATOR_MODEL);

        // Fast-forward time to trigger multiple polling timeouts
        await vi.advanceTimersByTimeAsync(60000); // 2 * 30 seconds

        const result = await resultPromise;

        expect(result.backing).toBeInstanceOf(Blob);
        expect(result.vocals).toBeInstanceOf(Blob);
        expect(fetch).toHaveBeenCalledTimes(4); // Initial + 3 polls
    });
});

describe('separateTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('runs a local model in the browser and never calls the server', async () => {
        const songFile = new File(['song'], 'song.mp3', { type: 'audio/mpeg' });
        const result = { backing: new Blob(['b']), vocals: new Blob(['v']) };
        vi.mocked(mainThreadRunner.run).mockResolvedValue(result);
        const onProgress = vi.fn();

        const returned = await separateTrack(songFile, BACKING_VOCALS_SEPARATOR_MODEL, onProgress);

        expect(returned).toBe(result);
        expect(mainThreadRunner.run).toHaveBeenCalledWith(
            { songFile, localModelName: BACKING_VOCALS_SEPARATOR_MODEL.localModelName },
            onProgress
        );
        expect(fetch).not.toHaveBeenCalled();
    });

    it('forwards progress from the local runner', async () => {
        const songFile = new File(['song'], 'song.mp3', { type: 'audio/mpeg' });
        vi.mocked(mainThreadRunner.run).mockImplementation(async (_request, onProgress) => {
            onProgress?.({ phase: SeparationPhase.Separating, fraction: 0.5 });
            return { backing: new Blob(), vocals: new Blob() };
        });
        const onProgress = vi.fn();

        await separateTrack(songFile, BACKING_VOCALS_SEPARATOR_MODEL, onProgress);

        expect(onProgress).toHaveBeenCalledWith({ phase: SeparationPhase.Separating, fraction: 0.5 });
    });

    it('sends a remote model to the server', async () => {
        const songFile = new File(['song'], 'song.mp3', { type: 'audio/mpeg' });
        (fetch as any).mockResolvedValueOnce({
            headers: { get: vi.fn().mockReturnValue('application/zip') },
            blob: vi.fn().mockResolvedValue(new Blob([new ArrayBuffer(8)], { type: 'application/zip' }))
        });
        await mockZipResponse();

        await separateTrack(songFile, NO_VOCALS_SEPARATOR_MODEL);

        expect(mainThreadRunner.run).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(1);
        const [, options] = (fetch as any).mock.calls[0];
        expect((options.body as FormData).get('modelName')).toBe(NO_VOCALS_SEPARATOR_MODEL.id);
    });

    it('rejects a local model that has no library model name', async () => {
        const broken: SeparationModel = {
            ...BACKING_VOCALS_SEPARATOR_MODEL,
            backend: SeparationBackend.Local,
            localModelName: undefined,
        };

        await expect(
            separateTrack(new File(['song'], 'song.mp3'), broken)
        ).rejects.toThrow(/not available in the browser/);
        expect(mainThreadRunner.run).not.toHaveBeenCalled();
    });
});
