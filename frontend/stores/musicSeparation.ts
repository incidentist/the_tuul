import { defineStore } from 'pinia';
import { ref } from 'vue';

import { separateTrack } from '@/lib/audio';

interface SeparationResult {
    // Blob URL of the separated instrumental track
    instrumental: string;
}

export const useMusicSeparationStore = defineStore('musicSeparation', () => {
    const isProcessing = ref(false);
    const result = ref<Promise<string> | null>(null);
    const error = ref<string | null>(null);

    async function startSeparation(inputData: any) {
        isProcessing.value = true;
        result.value = null;
        error.value = null;

        try {
            result.value = separateTrack(inputData);
            console.log("Separation started", result.value);
            await result.value;
        } catch (err) {
            console.error(err);
            error.value = (err as Error).message;
        } finally {
            isProcessing.value = false;
        }
    }

    return {
        isProcessing,
        result,
        error,
        startSeparation,
    };
});

// Fake API call to demonstrate functionality
async function fakeMusicSeparationAPI(inputData: any) {
    return new Promise<string>((resolve) => {
        setTimeout(() => {
            resolve('instrumental.wav');
        }, 2000);
    });
}