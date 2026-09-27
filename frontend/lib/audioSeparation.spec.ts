import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The local runner drives web-audio-separation; stub it so dispatch tests
// never load a model.
vi.mock('./localSeparation', () => ({
    mainThreadRunner: { run: vi.fn() },
}));

// separateTrack's local/remote choice reads this constant at call time, so
// tests toggle it directly rather than depending on the build-time env var.
vi.mock('@/constants', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/constants')>()),
    USE_REMOTE_SEPARATION: false,
}));

// Device detection reads window.screen; stub it so tests pick the device.
vi.mock('./device', () => ({
    isMobile: vi.fn().mockReturnValue(false),
}));

import {
    chooseSeparationMethod,
    SeparationMethod,
    separateTrack,
    separateTrackRemotely,
} from './audioSeparation';
import { isMobile } from './device';
import { mainThreadRunner } from './localSeparation';
import {
    BACKING_VOCALS_SEPARATOR_MODEL,
    NO_VOCALS_SEPARATOR_MODEL,
} from './separationModels';
import { SeparationPhase } from '@/types';
import * as constants from '@/constants';

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
            ok: true,
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
            ok: true,
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
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({
                finishedTrackURL: 'http://example.com/poll-url'
            })
        });

        // Mock polling responses: first JSON (still processing), then zip (finished)
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({ status: 'processing', startTime: 0 })
        });

        (fetch as any).mockResolvedValueOnce({
            ok: true,
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
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({
                finishedTrackURL: 'http://example.com/poll-url'
            })
        });

        // Mock multiple JSON responses before final zip
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({ status: 'processing', startTime: 0 })
        });

        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({ status: 'processing', startTime: 0 })
        });

        (fetch as any).mockResolvedValueOnce({
            ok: true,
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
    it('fails when the server reports the separation failed', async () => {
        const mockFile = new File(['audio data'], 'test.mp3', { type: 'audio/mp3' });

        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: { get: vi.fn().mockReturnValue('application/json') },
            json: vi.fn().mockResolvedValue({ finishedTrackURL: 'http://example.com/poll-url' })
        });
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: { get: vi.fn().mockReturnValue('application/json') },
            json: vi.fn().mockResolvedValue({ status: 'failed', error: 'Separation failed on the server.' })
        });

        await expect(separateTrackRemotely(mockFile, NO_VOCALS_SEPARATOR_MODEL))
            .rejects.toThrow('Separation failed on the server.');
        expect(fetch).toHaveBeenCalledTimes(2); // Initial + 1 poll, then no more
    });

    it('fails when the poll URL returns an error status', async () => {
        const mockFile = new File(['audio data'], 'test.mp3', { type: 'audio/mp3' });

        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: { get: vi.fn().mockReturnValue('application/json') },
            json: vi.fn().mockResolvedValue({ finishedTrackURL: 'http://example.com/poll-url' })
        });
        (fetch as any).mockResolvedValueOnce({
            ok: false,
            status: 404,
            headers: { get: vi.fn().mockReturnValue('application/xml') }
        });

        await expect(separateTrackRemotely(mockFile, NO_VOCALS_SEPARATOR_MODEL))
            .rejects.toThrow('404');
    });

    it('fails without polling when the server is busy', async () => {
        const mockFile = new File(['audio data'], 'test.mp3', { type: 'audio/mp3' });

        (fetch as any).mockResolvedValueOnce({
            ok: false,
            status: 503,
            headers: { get: vi.fn().mockReturnValue('application/json') },
            json: vi.fn().mockResolvedValue({ detail: 'The server is busy. Try again later.' })
        });

        await expect(separateTrackRemotely(mockFile, NO_VOCALS_SEPARATOR_MODEL))
            .rejects.toThrow('503');
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});

describe('chooseSeparationMethod', () => {
    beforeEach(() => {
        vi.mocked(constants).USE_REMOTE_SEPARATION = false;
        vi.mocked(isMobile).mockReturnValue(false);
    });

    it('separates in the browser on desktop by default', () => {
        expect(chooseSeparationMethod()).toBe(SeparationMethod.Local);
    });

    it('uses the API on mobile', () => {
        vi.mocked(isMobile).mockReturnValue(true);
        expect(chooseSeparationMethod()).toBe(SeparationMethod.Api);
    });

    it('uses the API on desktop when remote separation is forced', () => {
        vi.mocked(constants).USE_REMOTE_SEPARATION = true;
        expect(chooseSeparationMethod()).toBe(SeparationMethod.Api);
    });

    it('uses the API on mobile when remote separation is forced', () => {
        vi.mocked(constants).USE_REMOTE_SEPARATION = true;
        vi.mocked(isMobile).mockReturnValue(true);
        expect(chooseSeparationMethod()).toBe(SeparationMethod.Api);
    });
});

describe('separateTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(constants).USE_REMOTE_SEPARATION = false;
        vi.mocked(isMobile).mockReturnValue(false);
    });

    it('runs in the browser and never calls the server on desktop', async () => {
        const songFile = new File(['song'], 'song.mp3', { type: 'audio/mpeg' });
        const result = { backing: new Blob(['b']), vocals: new Blob(['v']) };
        vi.mocked(mainThreadRunner.run).mockResolvedValue(result);
        const onProgress = vi.fn();

        const returned = await separateTrack(songFile, BACKING_VOCALS_SEPARATOR_MODEL, onProgress);

        expect(returned).toBe(result);
        expect(mainThreadRunner.run).toHaveBeenCalledWith(
            { songFile, localModelName: BACKING_VOCALS_SEPARATOR_MODEL.modelName },
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

    it('sends to the server on mobile', async () => {
        vi.mocked(isMobile).mockReturnValue(true);
        const songFile = new File(['song'], 'song.mp3', { type: 'audio/mpeg' });
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: { get: vi.fn().mockReturnValue('application/zip') },
            blob: vi.fn().mockResolvedValue(new Blob([new ArrayBuffer(8)], { type: 'application/zip' }))
        });
        await mockZipResponse();

        await separateTrack(songFile, BACKING_VOCALS_SEPARATOR_MODEL);

        expect(mainThreadRunner.run).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('sends to the server when remote separation is forced', async () => {
        vi.mocked(constants).USE_REMOTE_SEPARATION = true;
        const songFile = new File(['song'], 'song.mp3', { type: 'audio/mpeg' });
        (fetch as any).mockResolvedValueOnce({
            ok: true,
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
});
