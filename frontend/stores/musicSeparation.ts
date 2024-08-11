import { defineStore } from 'pinia';
import { ref } from 'vue';

import { separateTrack } from '@/lib/audio';
import { SeparationModel } from '@/types';

interface SeparationResult {
    // Blob URL of the separated instrumental track
    instrumental: string;
}

export const BACKING_VOCALS_SEPARATOR_MODEL = "UVR_MDXNET_KARA_2.onnx";
export const NO_VOCALS_SEPARATOR_MODEL = "UVR-MDX-NET-Inst_HQ_3.onnx";

export const useMusicSeparationStore = defineStore('musicSeparation', () => {
    const isProcessing = ref(false);
    const result = ref<Promise<string> | null>(null);
    const error = ref<string | null>(null);
    const separationStartTime = ref<Date | null>(null);
    var resolveResult: (string) => void = null;

    async function startSeparation(inputData: any, modelName: SeparationModel) {
        isProcessing.value = true;
        result.value = null;
        error.value = null;
        separationStartTime.value = new Date();

        result.value = new Promise((resolve, reject) => {
            resolveResult = resolve;
            try {
                const result = separateTrack(inputData, modelName);
                result.then((_) => {
                    isProcessing.value = false;
                });
                resolve(result);
            } catch (err) {
                console.error(err);
                error.value = (err as Error).message;
                reject(err);
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
        separationStartTime,
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