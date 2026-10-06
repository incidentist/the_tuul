// ffmpeg.wasm downloads its core from a CDN; stub it with a fake that encodes instantly.
const ffmpegExec = vi.fn();
vi.mock('@ffmpeg/ffmpeg', () => ({
    FFmpeg: class {
        load = vi.fn().mockResolvedValue(undefined);
        on = vi.fn();
        writeFile = vi.fn().mockResolvedValue(undefined);
        exec = ffmpegExec;
        readFile = vi.fn().mockResolvedValue(new Uint8Array(1234));
    },
}));
vi.mock('@ffmpeg/util', () => ({
    fetchFile: vi.fn().mockResolvedValue(new Uint8Array(1)),
    toBlobURL: vi.fn().mockResolvedValue('blob:ffmpeg'),
}));
// Timing is reported to the backend; capture it instead.
vi.mock('./util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./util')>()),
    logInfo: vi.fn(),
}));

import { createPinia, setActivePinia } from 'pinia';
import { parseYouTubeTitle, fetchYouTubeVideo, createVideo, VideoCreationStep } from './video';
import { logInfo } from './util';
import { PerformanceLogTag } from './telemetry';
import { useMediaStore } from '@/stores/media';

// Mock fetch globally
global.fetch = vi.fn();

describe('Video Library', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('parseYouTubeTitle handles titles without author info', () => {
        expect(parseYouTubeTitle({ title: 'The Bolks singing Squibble Doo Dah' })).toEqual(['', 'The Bolks singing Squibble Doo Dah']);
    });

    it('parseYouTubeTitle parses author and title correctly', () => {
        const expected = ['The Bolks', 'Squibble Doo Dah'];
        expect(parseYouTubeTitle({ author: 'The Bolks', title: 'Squibble Doo Dah' })).toEqual(expected);
    });

    it('fetchYouTubeVideo throws error when polling endpoint returns error JSON', async () => {
        const mockFetch = fetch as any;
        
        // Mock initial response with polling URL
        const initialResponse = {
            status: 200,
            headers: {
                get: vi.fn().mockReturnValue('application/json'),
            },
            json: vi.fn().mockResolvedValue({
                finishedDownloadURL: 'http://example.com/poll-url'
            }),
        };

        // Mock polling response with error JSON
        const errorResponse = {
            status: 200,
            headers: {
                get: vi.fn().mockReturnValue('application/json'),
            },
            blob: vi.fn().mockResolvedValue(new Blob([JSON.stringify({
                success: false,
                error: 'No route to host - unable to reach: YouTube servers'
            })], { type: 'application/json' })),
        };

        mockFetch
            .mockResolvedValueOnce(initialResponse as any)
            .mockResolvedValueOnce(errorResponse as any);

        await expect(fetchYouTubeVideo('https://www.youtube.com/watch?v=test'))
            .rejects
            .toThrow('No route to host - unable to reach: YouTube servers');
    });
});
describe('createVideo', () => {
    const videoOptions = { color: { background: '#000000' }, font: { name: 'Arial' } } as any;
    const fonts = { Arial: 'arial.ttf' };

    beforeEach(() => {
        vi.clearAllMocks();
        setActivePinia(createPinia());
        useMediaStore().songDuration = 180;
    });

    it('logs how long video creation took, step by step', async () => {
        ffmpegExec.mockResolvedValue(0);

        await createVideo('blob:audio', new Blob(['video']), 'subs', 5, videoOptions, { duration: 180 }, fonts);

        await vi.waitFor(() => expect(logInfo).toHaveBeenCalledTimes(1));
        const [tag, message, details] = vi.mocked(logInfo).mock.calls[0];
        expect(tag).toBe(PerformanceLogTag.VideoCreation);
        expect(message).toMatch(/^Video creation succeeded in [\d.]+s$/);
        expect(details).toMatchObject({
            outcome: 'succeeded',
            songDurationSeconds: 180,
            audioDelaySeconds: 5,
            hasBackgroundVideo: true,
            backgroundVideoBytes: 5,
            ffmpegExitCode: 0,
            outputBytes: 1234,
        });
        expect(Object.keys(details.phaseSeconds as object)).toEqual([
            VideoCreationStep.LoadingFfmpeg,
            VideoCreationStep.WritingInputs,
            VideoCreationStep.Encoding,
            VideoCreationStep.ReadingOutput,
        ]);
    });

    it('logs a failed video creation and still rejects', async () => {
        ffmpegExec.mockRejectedValue(new Error('encoder crashed'));

        await expect(createVideo('blob:audio', null, 'subs', 0, videoOptions, {}, fonts)).rejects.toThrow('encoder crashed');

        await vi.waitFor(() => expect(logInfo).toHaveBeenCalledTimes(1));
        const [, , details] = vi.mocked(logInfo).mock.calls[0];
        expect(details).toMatchObject({
            outcome: 'failed',
            error: 'encoder crashed',
            hasBackgroundVideo: false,
            ffmpegExitCode: null,
            outputBytes: null,
        });
    });
});
