import { afterEach, describe, expect, it, vi } from 'vitest';
import { supportsInBrowserSeparation } from './device';

describe('supportsInBrowserSeparation', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function stubDeviceMemory(deviceMemory: number | undefined) {
        vi.stubGlobal('navigator', { ...navigator, deviceMemory });
    }

    it('allows machines that report 8 GB', () => {
        stubDeviceMemory(8);
        expect(supportsInBrowserSeparation()).toBe(true);
    });

    it('rejects machines that report 4 GB or less', () => {
        stubDeviceMemory(4);
        expect(supportsInBrowserSeparation()).toBe(false);
        stubDeviceMemory(2);
        expect(supportsInBrowserSeparation()).toBe(false);
    });

    it('allows browsers that do not report memory', () => {
        stubDeviceMemory(undefined);
        expect(supportsInBrowserSeparation()).toBe(true);
    });
});
