import { beforeEach, vi } from 'vitest';

// happy-dom doesn't provide a working localStorage here, so supply one. Tests
// use both the Storage API (setItem/getItem) and direct property access
// (localStorage.videoOptions = ...), so back it with a Proxy that supports both.
function createLocalStorage(): Storage {
    let store: Record<string, string> = {};
    const api = {
        getItem: (key: string) => (key in store ? store[key] : null),
        setItem: (key: string, value: string) => { store[key] = String(value); },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
        key: (index: number) => Object.keys(store)[index] ?? null,
        get length() { return Object.keys(store).length; },
    };

    return new Proxy(api, {
        get: (target, prop: string) =>
            prop in target ? target[prop] : store[prop],
        set: (target, prop: string, value) => {
            store[prop] = String(value);
            return true;
        },
        deleteProperty: (target, prop: string) => {
            delete store[prop];
            return true;
        },
        has: (target, prop: string) => prop in target || prop in store,
    }) as unknown as Storage;
}

Object.defineProperty(window, 'localStorage', {
    value: createLocalStorage(),
    writable: true,
    configurable: true,
});

// Keep stored settings from leaking between tests.
beforeEach(() => {
    window.localStorage.clear();
});

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
        default: vi.fn().mockImplementation(function (options) {
            console.log('Mock constructor called in test');
            return {
                setTrack: vi.fn(),
                setCurrentTime: vi.fn(),
                setIsPaused: vi.fn()
            };
        })
    };
});