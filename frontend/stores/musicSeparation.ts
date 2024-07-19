import { defineStore } from 'pinia';
import { ref } from 'vue';

import { separateTrack } from '@/lib/audio';
import { SeparationModel } from '@/types';

interface SeparationResult {
    // Blob URL of the separated instrumental track
    instrumental: string;
}

export const useMusicSeparationStore = defineStore('musicSeparation', () => {
    const isProcessing = ref(false);
    const result = ref<Promise<string> | null>(null);
    const error = ref<string | null>(null);
    var resolveResult: (string) => void = null;

    async function startSeparation(inputData: any, modelName: SeparationModel) {
        isProcessing.value = true;
        result.value = null;
        error.value = null;

        result.value = new Promise((resolve, reject) => {
            resolveResult = resolve;
            try {
                const result = separateTrack(inputData, modelName);
                resolve(result);
            } catch (err) {
                console.error(err);
                error.value = (err as Error).message;
                reject(err);
            } finally {
                isProcessing.value = false;
            }
        });
        await result.value;
    }

    async function setBackingTrack(file: File) {
        if (result.value == null) {
            result.value = Promise.resolve(URL.createObjectURL(file));
        } else if (resolveResult) {
            resolveResult(URL.createObjectURL(file));
        } else {
            console.error("Cannot set backing track: separation started but no resolve function found");
        }
    }

    return {
        isProcessing,
        result,
        error,
        startSeparation,
        setBackingTrack,
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