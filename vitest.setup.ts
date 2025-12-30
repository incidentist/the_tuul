import { vi } from 'vitest';

// Global mocks for web APIs can go here
// Define interface for SubtitlesOctopus
interface SubtitlesOctopus {
    setTrack: (subtitles: string) => void;
    setCurrentTime: (time: number) => void;
    setIsPaused: (isPaused: boolean, currentTime: number) => void;
}

vi.mock('libass-wasm', () => {
    console.log('Mocking libass-wasm in test file');
    return {
        __esModule: true,
        default: vi.fn().mockImplementation((options) => {
            console.log('Mock constructor called in test');
            return {
                setTrack: vi.fn(),
                setCurrentTime: vi.fn(),
                setIsPaused: vi.fn()
            };
        })
    };
});

// Mock AudioContext for tests
global.AudioContext = vi.fn().mockImplementation(() => ({
    createBuffer: vi.fn(),
    createBufferSource: vi.fn(),
    decodeAudioData: vi.fn().mockResolvedValue({
        duration: 180,
        numberOfChannels: 2,
        sampleRate: 44100,
    }),
    destination: {},
})) as any;